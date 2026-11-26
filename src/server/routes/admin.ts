import { Hono } from "hono";
import { z } from "zod";
import { OFFER_TYPES } from "../../shared/offers-schema";
import { validateCustomCss } from "../../shared/css-validate";
import { sql } from "../db";
import { encrypt, pseudo } from "../lib/crypto";
import { errMsg, log } from "../lib/log";
import { searchProducts } from "../services/catalog";
import * as forms from "../services/forms";
import { ipPrefix, normalizeEmail, normalizePhone } from "../services/fraud";
import { processDueJobs, retryJob, enqueue } from "../services/jobs";
import { maskPhone, sendMessage } from "../services/messaging";
import { testPixel, type PixelRow } from "../services/meta";
import { publicSettings, shopSettingsSchema, type ShopSettings } from "../services/settings";
import * as sheets from "../services/sheets";
import {
  audit,
  exchangeToken,
  getShopByDomain,
  saveToken,
  shopClient,
  shopSettings,
  syncShopInfo,
  updateShopSettings,
  type ShopRow,
} from "../services/shops";
import { statsSummary } from "../services/stats";
import { verifySessionToken } from "../shopify/session-token";
import { ShopifyApiError } from "../shopify/graphql";
import type { AppEnv } from "./util";

export const admin = new Hono<AppEnv>();

/** Authentification : jeton de session App Bridge + échange de jeton à la première visite. */
admin.use("*", async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return c.json({ error: "Non authentifié" }, 401);
  let verified;
  try {
    verified = verifySessionToken(token);
  } catch (e) {
    return c.json({ error: errMsg(e) }, 401);
  }
  let shop = await getShopByDomain(verified.shop);
  if (!shop || !shop.access_token_enc || shop.uninstalled_at || shop.app_client_id !== verified.app.clientId) {
    try {
      const t = await exchangeToken(verified.shop, verified.app.clientId, token);
      shop = await saveToken(verified.shop, verified.app.clientId, t);
      shop = await syncShopInfo(shop);
      await forms.ensureDefaultForm(shop.id);
      await audit(shop.id, "install");
      await forms.publishConfig(shop).catch((e) => log("warn", "publish.initial_failed", { error: errMsg(e) }));
    } catch (e) {
      log("error", "auth.token_exchange_failed", { shop: verified.shop, error: errMsg(e) });
      return c.json({ error: "Connexion à Shopify impossible. Rechargez l'application." }, 502);
    }
  } else if (!shop.app_installation_gid) {
    shop = await syncShopInfo(shop);
  }
  c.set("shop", shop);
  try {
    await next();
  } catch (e) {
    if (e instanceof forms.ValidationError) return c.json({ error: e.message, errors: e.errors }, 422);
    if (e instanceof z.ZodError) return c.json({ error: "Données invalides", errors: e.issues.map((i) => `${i.path.join(".")} : ${i.message}`) }, 422);
    if (e instanceof ShopifyApiError && e.kind === "auth") {
      await sql()`UPDATE shops SET access_token_enc = NULL WHERE id = ${shop.id}`;
      return c.json({ error: "Accès Shopify expiré, rechargez la page." }, 401);
    }
    log("error", "admin.error", { path: c.req.path, error: errMsg(e) });
    return c.json({ error: errMsg(e) }, 500);
  }
});

const S = (c: { get: (k: "shop") => ShopRow }) => c.get("shop");

async function republish(shop: ShopRow) {
  try {
    return await forms.publishConfig(shop);
  } catch (e) {
    log("warn", "publish.failed", { error: errMsg(e) });
    return { error: errMsg(e) };
  }
}

// ---------- Tableau de bord ----------

admin.get("/bootstrap", async (c) => {
  const shop = S(c);
  const [g] = await sql()`SELECT status, google_email, spreadsheet_title, sheet_title, enabled, last_error FROM google_connections WHERE shop_id = ${shop.id}`;
  const [alerts] = await sql()<{ sheets: number; meta: number; dead: number; uncertain: number }[]>`SELECT
    (SELECT count(*)::int FROM sheet_syncs WHERE shop_id = ${shop.id} AND status IN ('action_required','retrying')) AS sheets,
    (SELECT count(*)::int FROM tracking_events WHERE shop_id = ${shop.id} AND status IN ('failed','retrying') AND created_at > now() - interval '7 days') AS meta,
    (SELECT count(*)::int FROM jobs WHERE shop_id = ${shop.id} AND status = 'dead' AND updated_at > now() - interval '7 days') AS dead,
    (SELECT count(*)::int FROM submissions WHERE shop_id = ${shop.id} AND status = 'uncertain') AS uncertain`;
  return c.json({
    shop: {
      domain: shop.shop_domain,
      name: shop.name,
      currency: shop.currency,
      moneyFormat: shop.money_format,
      appClientId: shop.app_client_id,
    },
    settings: publicSettings(shopSettings(shop)),
    google: g ?? null,
    alerts,
  });
});

admin.get("/stats", async (c) => {
  const days = Math.min(Math.max(Number(c.req.query("days") ?? 30), 1), 365);
  return c.json(await statsSummary(S(c).id, days));
});

// ---------- Formulaires ----------

admin.get("/forms", async (c) => c.json(await forms.listForms(S(c).id)));

admin.post("/forms", async (c) => {
  const body = z.object({ name: z.string().min(1).max(120), config: z.unknown().optional() }).parse(await c.req.json());
  const f = await forms.createForm(S(c).id, body.name, body.config);
  await republish(S(c));
  return c.json(f);
});

admin.get("/forms/:id", async (c) => {
  const f = await forms.getForm(S(c).id, c.req.param("id"));
  return f ? c.json(f) : c.json({ error: "Introuvable" }, 404);
});

admin.put("/forms/:id", async (c) => {
  const body = z
    .object({ name: z.string().min(1).max(120).optional(), active: z.boolean().optional(), config: z.unknown().optional(), expectedVersion: z.number().int().optional() })
    .parse(await c.req.json());
  const f = await forms.saveForm(S(c).id, c.req.param("id"), body);
  const published = await republish(S(c));
  return c.json({ form: f, published });
});

admin.delete("/forms/:id", async (c) => {
  await forms.deleteForm(S(c).id, c.req.param("id"));
  await republish(S(c));
  return c.json({ ok: true });
});

admin.post("/forms/:id/duplicate", async (c) => {
  const f = await forms.duplicateForm(S(c).id, c.req.param("id"));
  await republish(S(c));
  return c.json(f);
});

admin.post("/forms/:id/default", async (c) => {
  await forms.setDefaultForm(S(c).id, c.req.param("id"));
  await republish(S(c));
  return c.json({ ok: true });
});

admin.put("/forms/:id/products", async (c) => {
  const body = z.object({ products: z.array(z.object({ id: z.string(), title: z.string().max(300).optional() })).max(1000) }).parse(await c.req.json());
  await forms.assignProducts(S(c).id, c.req.param("id"), body.products);
  await republish(S(c));
  return c.json({ ok: true });
});

admin.get("/forms/:id/versions", async (c) => c.json(await forms.listVersions(S(c).id, c.req.param("id"))));

admin.post("/forms/:id/restore", async (c) => {
  const { version } = z.object({ version: z.number().int().min(1) }).parse(await c.req.json());
  const f = await forms.restoreVersion(S(c).id, c.req.param("id"), version);
  await republish(S(c));
  return c.json(f);
});

admin.post("/css/validate", async (c) => {
  const { css } = z.object({ css: z.string().max(50_000) }).parse(await c.req.json());
  return c.json(validateCustomCss(css));
});

admin.post("/publish", async (c) => c.json(await forms.publishConfig(S(c))));

admin.get("/products", async (c) => c.json(await searchProducts(await shopClient(S(c)), c.req.query("q") ?? "")));

// ---------- Offres ----------

admin.get("/offers", async (c) => c.json(await forms.listOffers(S(c).id)));

const offerBody = z.object({
  id: z.string().uuid().optional(),
  type: z.enum(OFFER_TYPES),
  name: z.string().min(1).max(120),
  active: z.boolean(),
  priority: z.number().int().min(-1000).max(1000).optional(),
  config: z.unknown(),
});

admin.post("/offers", async (c) => {
  const parsed = offerBody.parse(await c.req.json());
  const o = await forms.upsertOffer(S(c).id, { ...parsed, config: parsed.config ?? {} });
  await republish(S(c));
  return c.json(o);
});

admin.delete("/offers/:id", async (c) => {
  await forms.deleteOffer(S(c).id, c.req.param("id"));
  await republish(S(c));
  return c.json({ ok: true });
});

// ---------- Paramètres ----------

const SECTIONS = ["fraud", "otp", "providers", "notifications", "orders", "abandoned", "tracking", "dataRetentionDays"] as const;

admin.put("/settings", async (c) => {
  const shop = S(c);
  const body = (await c.req.json()) as Partial<Record<(typeof SECTIONS)[number], unknown>>;
  const current = shopSettings(shop);
  const merged: Record<string, unknown> = { ...current };
  for (const k of SECTIONS) {
    if (body[k] === undefined) continue;
    if (k === "providers") {
      // Les secrets ne passent jamais par cette route.
      const { smsSecretEnc: _a, whatsappTokenEnc: _b, ...rest } = body.providers as Record<string, unknown>;
      merged.providers = { ...current.providers, ...rest };
    } else merged[k] = body[k];
  }
  const settings = shopSettingsSchema.parse(merged);
  await updateShopSettings(shop.id, settings);
  await audit(shop.id, "settings.update", { sections: Object.keys(body) });
  const fresh = { ...shop, settings };
  await republish(fresh);
  return c.json(publicSettings(settings));
});

admin.put("/settings/secrets", async (c) => {
  const shop = S(c);
  const body = z.object({ smsSecret: z.string().max(500).optional(), whatsappToken: z.string().max(1000).optional() }).parse(await c.req.json());
  const s: ShopSettings = shopSettings(shop);
  if (body.smsSecret !== undefined) s.providers.smsSecretEnc = body.smsSecret ? encrypt(body.smsSecret) : "";
  if (body.whatsappToken !== undefined) s.providers.whatsappTokenEnc = body.whatsappToken ? encrypt(body.whatsappToken) : "";
  await updateShopSettings(shop.id, s);
  await audit(shop.id, "settings.secrets");
  return c.json(publicSettings(s));
});

admin.post("/messages/test", async (c) => {
  const shop = S(c);
  const body = z.object({ phone: z.string().max(30), channel: z.enum(["sms", "whatsapp"]) }).parse(await c.req.json());
  const p = normalizePhone(body.phone, "CI");
  if (!p) return c.json({ error: "Numéro invalide" }, 422);
  try {
    await sendMessage(shop.id, shopSettings(shop), body.channel, p.e164, `Test KB COD Manager (${shop.name ?? shop.shop_domain})`, "test");
    return c.json({ ok: true, to: maskPhone(p.e164) });
  } catch (e) {
    return c.json({ error: errMsg(e) }, 422);
  }
});

admin.get("/messages", async (c) =>
  c.json(await sql()`SELECT channel, template, to_masked, status, error, created_at FROM message_logs WHERE shop_id = ${S(c).id} ORDER BY id DESC LIMIT 100`),
);

// ---------- Antifraude : listes ----------

admin.get("/lists", async (c) =>
  c.json(await sql()`SELECT id, list, kind, display, reason, expires_at, created_at FROM list_entries WHERE shop_id = ${S(c).id} ORDER BY created_at DESC LIMIT 1000`),
);

admin.post("/lists", async (c) => {
  const shop = S(c);
  const body = z
    .object({
      list: z.enum(["block", "allow"]),
      kind: z.enum(["phone", "ip", "email", "phone_prefix", "ip_prefix"]),
      value: z.string().min(1).max(200),
      reason: z.string().max(300).optional(),
      expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
    })
    .parse(await c.req.json());
  let hash: string | null = null;
  let pattern: string | null = null;
  let display = body.value.trim();
  if (body.kind === "phone") {
    const p = normalizePhone(body.value, "CI");
    if (!p) return c.json({ error: "Numéro invalide" }, 422);
    hash = pseudo("phone", p.e164);
    display = maskPhone(p.e164);
  } else if (body.kind === "email") {
    const e = normalizeEmail(body.value);
    if (!e) return c.json({ error: "E-mail invalide" }, 422);
    hash = pseudo("email", e);
    display = e.replace(/^(.{2}).*(@.*)$/, "$1•••$2");
  } else if (body.kind === "ip") {
    if (!/^[0-9a-fA-F:.]{3,45}$/.test(display)) return c.json({ error: "IP invalide" }, 422);
    hash = pseudo("ip", display);
  } else if (body.kind === "phone_prefix") {
    if (!/^\+\d{1,14}$/.test(display)) return c.json({ error: "Préfixe attendu au format +225…" }, 422);
    pattern = display;
  } else {
    const pre = ipPrefix(display.replace(/\.$/, "") + (display.split(".").length === 3 ? ".0" : ""));
    if (!pre) return c.json({ error: "Préfixe IP invalide" }, 422);
    pattern = display.endsWith(".") ? display : `${display}.`;
  }
  const expires = body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86_400_000) : null;
  const [row] = await sql()`INSERT INTO list_entries (shop_id, list, kind, value_hash, value_pattern, display, reason, expires_at)
    VALUES (${shop.id}, ${body.list}, ${body.kind}, ${hash}, ${pattern}, ${display}, ${body.reason ?? null}, ${expires}) RETURNING id, list, kind, display, reason, expires_at, created_at`;
  await audit(shop.id, "list.add", { list: body.list, kind: body.kind });
  return c.json(row);
});

admin.delete("/lists/:id", async (c) => {
  await sql()`DELETE FROM list_entries WHERE id = ${c.req.param("id")} AND shop_id = ${S(c).id}`;
  return c.json({ ok: true });
});

/** Bloque le téléphone/l'IP d'une soumission existante (sans exposer la valeur en clair). */
admin.post("/submissions/:id/block", async (c) => {
  const shop = S(c);
  const { kind } = z.object({ kind: z.enum(["phone", "ip"]) }).parse(await c.req.json());
  const [s] = await sql()<{ phone_hash: string | null; ip_hash: string | null; phone_e164: string | null }[]>`
    SELECT phone_hash, ip_hash, phone_e164 FROM submissions WHERE id = ${c.req.param("id")} AND shop_id = ${shop.id}`;
  const hash = kind === "phone" ? s?.phone_hash : s?.ip_hash;
  if (!s || !hash) return c.json({ error: "Identifiant indisponible" }, 404);
  await sql()`INSERT INTO list_entries (shop_id, list, kind, value_hash, display, reason)
    VALUES (${shop.id}, 'block', ${kind}, ${hash}, ${kind === "phone" && s.phone_e164 ? maskPhone(s.phone_e164) : "IP d'une commande"}, 'Ajout depuis une commande')`;
  return c.json({ ok: true });
});

admin.get("/fraud/events", async (c) =>
  c.json(await sql()`SELECT rule, action, detail, submission_id, created_at FROM fraud_events WHERE shop_id = ${S(c).id} ORDER BY id DESC LIMIT 200`),
);

// ---------- Commandes / soumissions ----------

admin.get("/submissions", async (c) => {
  const status = c.req.query("status");
  const rows = await sql()`SELECT s.id, s.status, s.shopify_order_name, s.shopify_order_gid, s.total_minor::float8 AS total, s.currency,
      s.customer->>'fullName' AS name, s.phone_e164, s.error, s.client->'reasons' AS reasons, s.created_at,
      (SELECT status FROM sheet_syncs ss WHERE ss.submission_id = s.id AND ss.shop_id = s.shop_id ORDER BY id DESC LIMIT 1) AS sheet_status,
      (SELECT string_agg(DISTINCT te.status, ',') FROM tracking_events te WHERE te.submission_id = s.id AND te.shop_id = s.shop_id) AS meta_status
    FROM submissions s WHERE s.shop_id = ${S(c).id} ${status ? sql()`AND s.status = ${status}` : sql()``}
    ORDER BY s.created_at DESC LIMIT 200`;
  return c.json(rows.map((r: any) => ({ ...r, phone: r.phone_e164 ? maskPhone(r.phone_e164) : null, phone_e164: undefined })));
});

admin.post("/submissions/:id/reconcile", async (c) => {
  const shop = S(c);
  const id = c.req.param("id");
  const [s] = await sql()<{ status: string }[]>`SELECT status FROM submissions WHERE id = ${id} AND shop_id = ${shop.id}`;
  if (!s) return c.json({ error: "Introuvable" }, 404);
  if (s.status !== "uncertain") return c.json({ error: "Seules les commandes au statut incertain peuvent être réconciliées" }, 422);
  await enqueue("order.reconcile", `reconcile:${id}:${Date.now()}`, { submissionId: id }, { shopId: shop.id });
  return c.json(await processDueJobs({ budgetMs: 15_000 }));
});

admin.get("/abandoned", async (c) => {
  const rows = await sql()`SELECT id, status, name, phone_e164, email, product_id, quantity, consent, notified_at, last_activity_at
    FROM abandoned WHERE shop_id = ${S(c).id} ORDER BY last_activity_at DESC LIMIT 200`;
  return c.json(rows);
});

admin.post("/abandoned/:id/status", async (c) => {
  const { status } = z.object({ status: z.enum(["recovered", "dismissed"]) }).parse(await c.req.json());
  await sql()`UPDATE abandoned SET status = ${status} WHERE id = ${c.req.param("id")} AND shop_id = ${S(c).id}`;
  return c.json({ ok: true });
});

// ---------- File de travaux ----------

admin.get("/jobs", async (c) => {
  const status = c.req.query("status");
  return c.json(
    await sql()`SELECT id::text, type, status, attempts, max_attempts, run_at, last_error, updated_at, payload FROM jobs
      WHERE shop_id = ${S(c).id} ${status ? sql()`AND status = ${status}` : sql()``} ORDER BY updated_at DESC LIMIT 200`,
  );
});

admin.post("/jobs/:id/retry", async (c) => {
  const ok = await retryJob(S(c).id, c.req.param("id"));
  if (!ok) return c.json({ error: "Travail introuvable ou non relançable" }, 404);
  return c.json(await processDueJobs({ ids: [c.req.param("id")], budgetMs: 15_000 }));
});

// ---------- Google Sheets ----------

admin.get("/google", async (c) => {
  const conn = await sheets.getConnection(S(c).id);
  const syncs = await sql()`SELECT ss.submission_id, ss.status, ss.attempts, ss.last_error, ss.synced_at, ss.updated_at, s.shopify_order_name
    FROM sheet_syncs ss LEFT JOIN submissions s ON s.id = ss.submission_id AND s.shop_id = ss.shop_id
    WHERE ss.shop_id = ${S(c).id} ORDER BY ss.updated_at DESC LIMIT 100`;
  return c.json({
    connection: conn
      ? {
          status: conn.status,
          email: conn.google_email,
          spreadsheetId: conn.spreadsheet_id,
          spreadsheetTitle: conn.spreadsheet_title,
          sheetTitle: conn.sheet_title,
          mapping: conn.mapping.length ? conn.mapping : sheets.defaultMapping(),
          rowMode: conn.row_mode,
          enabled: conn.enabled,
          includeBlocked: conn.include_blocked,
          lastError: conn.last_error,
        }
      : null,
    sources: sheets.BUILTIN_SOURCES,
    syncs,
    configured: Boolean(process.env.GOOGLE_CLIENT_ID),
  });
});

admin.post("/google/auth-url", async (c) => c.json({ url: sheets.googleAuthUrl(S(c).id) }));

admin.post("/google/spreadsheet", async (c) => {
  const { url } = z.object({ url: z.string().min(10).max(500) }).parse(await c.req.json());
  const id = sheets.parseSpreadsheetId(url);
  if (!id) return c.json({ error: "Lien Google Sheets invalide" }, 422);
  try {
    return c.json(await sheets.describeSpreadsheet(S(c).id, id));
  } catch (e) {
    return c.json({ error: `Impossible d'ouvrir ce fichier : ${errMsg(e)}` }, 422);
  }
});

admin.post("/google/create", async (c) => {
  const { title } = z.object({ title: z.string().min(1).max(100) }).parse(await c.req.json());
  return c.json(await sheets.createSpreadsheet(S(c).id, title));
});

admin.post("/google/headers", async (c) => {
  const shop = S(c);
  const conn = await sheets.getConnection(shop.id);
  if (!conn?.spreadsheet_id || !conn.sheet_title) return c.json({ error: "Choisissez un fichier et une feuille" }, 422);
  return c.json({ headers: await sheets.readHeaders(conn, conn.spreadsheet_id, conn.sheet_title) });
});

admin.post("/google/write-headers", async (c) => c.json(await sheets.writeHeadersIfEmpty(S(c).id)));

admin.put("/google/config", async (c) => {
  const shop = S(c);
  const body = z
    .object({
      spreadsheetId: z.string().max(200),
      spreadsheetTitle: z.string().max(300),
      sheetTitle: z.string().max(200),
      sheetId: z.string().max(30).nullable().optional(),
      mapping: sheets.mappingSchema,
      rowMode: z.enum(["order", "product"]),
      enabled: z.boolean(),
      includeBlocked: z.boolean().default(false),
    })
    .parse(await c.req.json());
  const updated = await sql()`UPDATE google_connections SET spreadsheet_id = ${body.spreadsheetId}, spreadsheet_title = ${body.spreadsheetTitle},
    sheet_title = ${body.sheetTitle}, sheet_id = ${body.sheetId ?? null}, mapping = ${sql().json(body.mapping)}, row_mode = ${body.rowMode},
    enabled = ${body.enabled}, include_blocked = ${body.includeBlocked}, updated_at = now() WHERE shop_id = ${shop.id} RETURNING shop_id`;
  if (!updated.length) return c.json({ error: "Connectez d'abord un compte Google" }, 422);
  await audit(shop.id, "google.config");
  return c.json({ ok: true });
});

admin.post("/google/retry-all", async (c) => {
  const n = await sheets.retryActionRequired(S(c).id);
  const stats = await processDueJobs({ budgetMs: 15_000 });
  return c.json({ requeued: n, ...stats });
});

admin.post("/google/disconnect", async (c) => {
  await sheets.disconnectGoogle(S(c).id);
  return c.json({ ok: true });
});

// ---------- Pixels ----------

admin.get("/pixels", async (c) => {
  const rows = await sql()<PixelRow[]>`SELECT * FROM pixels WHERE shop_id = ${S(c).id} ORDER BY created_at`;
  return c.json(rows.map(({ capi_token_enc, ...p }) => ({ ...p, hasToken: Boolean(capi_token_enc) })));
});

admin.post("/pixels", async (c) => {
  const shop = S(c);
  const body = z
    .object({
      id: z.string().uuid().optional(),
      provider: z.enum(["meta", "tiktok", "snapchat", "pinterest", "google_ads", "ga4"]),
      name: z.string().min(1).max(100),
      pixelId: z.string().regex(/^[A-Za-z0-9_\-/]{3,64}$/),
      capiToken: z.string().max(1000).optional(),
      testEventCode: z.string().max(50).nullable().optional(),
      enabled: z.boolean(),
    })
    .parse(await c.req.json());
  const tokenEnc = body.capiToken ? encrypt(body.capiToken) : undefined;
  if (body.id) {
    await sql()`UPDATE pixels SET name = ${body.name}, pixel_id = ${body.pixelId}, enabled = ${body.enabled}, test_event_code = ${body.testEventCode ?? null},
      capi_token_enc = ${tokenEnc === undefined ? sql()`capi_token_enc` : tokenEnc}, updated_at = now()
      WHERE id = ${body.id} AND shop_id = ${shop.id}`;
  } else {
    await sql()`INSERT INTO pixels (shop_id, provider, name, pixel_id, capi_token_enc, test_event_code, enabled)
      VALUES (${shop.id}, ${body.provider}, ${body.name}, ${body.pixelId}, ${tokenEnc ?? null}, ${body.testEventCode ?? null}, ${body.enabled})`;
  }
  await audit(shop.id, "pixel.save", { provider: body.provider });
  await republish(shop);
  return c.json({ ok: true });
});

admin.delete("/pixels/:id", async (c) => {
  await sql()`DELETE FROM pixels WHERE id = ${c.req.param("id")} AND shop_id = ${S(c).id}`;
  await republish(S(c));
  return c.json({ ok: true });
});

admin.post("/pixels/:id/test", async (c) => {
  const [p] = await sql()<PixelRow[]>`SELECT * FROM pixels WHERE id = ${c.req.param("id")} AND shop_id = ${S(c).id}`;
  if (!p) return c.json({ error: "Pixel introuvable" }, 404);
  try {
    return c.json({ ok: true, response: await testPixel(p) });
  } catch (e) {
    return c.json({ ok: false, error: errMsg(e) }, 422);
  }
});

admin.get("/tracking/events", async (c) =>
  c.json(
    await sql()`SELECT te.id::text, te.event_name, te.event_id, te.stage, te.status, te.attempts, te.last_error, te.response, te.sent_at, te.created_at,
        p.name AS pixel_name, s.shopify_order_name
      FROM tracking_events te JOIN pixels p ON p.id = te.pixel_row_id
      LEFT JOIN submissions s ON s.id = te.submission_id AND s.shop_id = te.shop_id
      WHERE te.shop_id = ${S(c).id} ORDER BY te.id DESC LIMIT 200`,
  ),
);

// ---------- Sauvegarde / restauration (sans secrets) ----------

admin.get("/export", async (c) => {
  const shop = S(c);
  const allForms = await forms.listForms(shop.id);
  const offers = await forms.listOffers(shop.id);
  const pixels = await sql()`SELECT provider, name, pixel_id, enabled FROM pixels WHERE shop_id = ${shop.id}`;
  const settings = publicSettings(shopSettings(shop));
  const g = await sheets.getConnection(shop.id);
  return c.json({
    format: "kbcod-config",
    version: 1,
    exportedAt: new Date().toISOString(),
    shop: shop.shop_domain,
    forms: allForms.map((f) => ({ name: f.name, is_default: f.is_default, active: f.active, config: f.config, products: f.products })),
    offers: offers.map((o) => ({ type: o.type, name: o.name, active: o.active, priority: o.priority, config: o.config })),
    pixels,
    settings,
    google: g ? { mapping: g.mapping, rowMode: g.row_mode, sheetTitle: g.sheet_title } : null,
    note: "Les jetons (Shopify, Google, Meta CAPI, SMS, WhatsApp) ne sont jamais exportés.",
  });
});

admin.post("/import", async (c) => {
  const shop = S(c);
  const body = z
    .object({
      format: z.literal("kbcod-config"),
      version: z.literal(1),
      forms: z.array(z.object({ name: z.string(), is_default: z.boolean(), active: z.boolean(), config: z.unknown(), products: z.array(z.object({ product_id: z.string(), product_title: z.string().nullable() })).default([]) })),
      offers: z.array(z.object({ type: z.enum(OFFER_TYPES), name: z.string(), active: z.boolean(), priority: z.number().default(0), config: z.unknown() })).default([]),
      settings: z.record(z.unknown()).optional(),
    })
    .parse(await c.req.json());
  // Validation complète avant toute écriture.
  for (const f of body.forms) forms.validateConfig(f.config);
  for (const o of body.offers) forms.validateOffer(o.type, o.config);
  const imported = { forms: 0, offers: 0 };
  for (const f of body.forms) {
    if (f.is_default) {
      const def = await forms.ensureDefaultForm(shop.id);
      await forms.saveForm(shop.id, def.id, { config: f.config, note: "Import" });
    } else {
      const created = await forms.createForm(shop.id, f.name, f.config);
      if (f.products.length) await forms.assignProducts(shop.id, created.id, f.products.map((p) => ({ id: p.product_id, title: p.product_title ?? undefined })));
    }
    imported.forms++;
  }
  for (const o of body.offers) {
    await forms.upsertOffer(shop.id, { ...o, config: o.config ?? {} });
    imported.offers++;
  }
  if (body.settings) {
    const current = shopSettings(shop);
    const { providers: _p, ...rest } = body.settings as Record<string, unknown>;
    const s = shopSettingsSchema.parse({ ...current, ...rest, providers: current.providers });
    await updateShopSettings(shop.id, s);
  }
  await audit(shop.id, "import", imported);
  await republish((await getShopByDomain(shop.shop_domain))!);
  return c.json({ ok: true, imported });
});

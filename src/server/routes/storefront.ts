import { Hono } from "hono";
import { cors } from "hono/cors";
import { partialSchema, quoteRequestSchema, submitSchema, trackSchema } from "../../shared/api-types";
import { computeQuote } from "../../shared/pricing";
import { sql } from "../db";
import { env } from "../env";
import { verifyToken } from "../lib/crypto";
import { errMsg, log } from "../lib/log";
import { savePartial } from "../services/abandoned";
import { loadVariants } from "../services/catalog";
import { activeOffers, buildStorefrontConfig, getForm } from "../services/forms";
import { normalizeEmail, normalizePhone } from "../services/fraud";
import { buildUserData, postToMeta, stageEventName, type PixelRow } from "../services/meta";
import { acceptPostPurchase, declinePostPurchase, handleSubmit } from "../services/orders";
import { getShopByDomain, shopClient, shopSettings } from "../services/shops";
import { bumpStat } from "../services/stats";
import { clientIp, type AppEnv } from "./util";

export const storefront = new Hono<AppEnv>();

storefront.use(
  "*",
  cors({
    origin: (origin) => origin || "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    maxAge: 86400,
  }),
);

async function readJson(c: { req: { json: () => Promise<unknown> } }) {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

async function verifyTurnstile(secret: string, token: string | null, ip: string | null): Promise<boolean> {
  if (!token) return false;
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!res?.ok) return false;
  const json = (await res.json()) as { success?: boolean };
  return json.success === true;
}

storefront.get("/config", async (c) => {
  const shop = await getShopByDomain(c.req.query("shop") ?? "");
  if (!shop || shop.uninstalled_at) return c.json({ error: "Boutique inconnue" }, 404);
  c.header("Cache-Control", "public, max-age=60");
  return c.json(await buildStorefrontConfig(shop));
});

storefront.post("/quote", async (c) => {
  const parsed = quoteRequestSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json({ ok: false, message: "Requête invalide" }, 400);
  const p = parsed.data;
  const shop = await getShopByDomain(p.shop);
  if (!shop || shop.uninstalled_at) return c.json({ ok: false, message: "Boutique inconnue" }, 404);
  const settings = shopSettings(shop);
  const offers = await activeOffers(shop.id);
  const upsellVariants = offers.filter((o) => o.type === "upsell" && p.upsellIds.includes(o.id)).map((o) => (o.config as { variantId: string }).variantId);
  const catalog = await loadVariants(await shopClient(shop), [p.variantId, ...upsellVariants]);
  const quote = computeQuote(
    { ...p, country: p.country },
    { catalog, offers, shippingRates: settings.orders.shippingRates, discountCodes: settings.orders.discountCodes, allowOutOfStock: settings.orders.allowOutOfStock },
  );
  return c.json({ ok: quote.errors.length === 0, quote });
});

storefront.post("/submit", async (c) => {
  const parsed = submitSchema.safeParse(await readJson(c));
  if (!parsed.success) {
    return c.json({ ok: false, status: "invalid", message: "Données du formulaire invalides" }, 400);
  }
  const ip = clientIp(c);
  const payload = parsed.data;
  const shop = await getShopByDomain(payload.shop);
  if (shop) {
    const s = shopSettings(shop);
    if (s.fraud.enabled && s.fraud.turnstile.enabled && env().TURNSTILE_SECRET) {
      const ok = await verifyTurnstile(env().TURNSTILE_SECRET, payload.captcha, ip);
      if (!ok) return c.json({ ok: false, status: "invalid", message: "Vérification anti-robot échouée. Réessayez." }, 400);
    }
  }
  try {
    const result = await handleSubmit(payload, {
      ip,
      userAgent: c.req.header("user-agent") ?? null,
      origin: c.req.header("origin") ?? null,
      defer: (p) => c.get("defer")(p),
    });
    return c.json(result, result.ok ? 200 : result.status === "error" ? 502 : 200);
  } catch (e) {
    log("error", "submit.crash", { error: errMsg(e) });
    return c.json({ ok: false, status: "error", message: "Une erreur est survenue. Veuillez réessayer." }, 500);
  }
});

storefront.post("/partial", async (c) => {
  const parsed = partialSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json({ ok: false }, 400);
  const p = parsed.data;
  const shop = await getShopByDomain(p.shop);
  if (!shop || shop.uninstalled_at) return c.json({ ok: false }, 404);
  const form = await getForm(shop.id, p.formId);
  if (!form) return c.json({ ok: false }, 404);
  const fields = form.config.elements.filter((e) => e.type === "field");
  const valueOf = (input: string) => {
    const f = fields.find((x) => x.type === "field" && x.input === input);
    const v = f && f.type === "field" ? p.fields[f.key] : undefined;
    return typeof v === "string" ? v : null;
  };
  const phoneRaw = valueOf("phone");
  const phone = phoneRaw ? normalizePhone(phoneRaw, form.config.settings.defaultCountry)?.e164 ?? null : null;
  const emailRaw = valueOf("email");
  const email = emailRaw ? normalizeEmail(emailRaw) : null;
  const name = valueOf("full_name") ?? ([valueOf("first_name"), valueOf("last_name")].filter(Boolean).join(" ") || null);
  await savePartial(shop, { ...p }, phone, email, name);
  return c.json({ ok: true });
});

storefront.post("/track", async (c) => {
  const parsed = trackSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json({ ok: false }, 400);
  const p = parsed.data;
  const shop = await getShopByDomain(p.shop);
  if (!shop || shop.uninstalled_at) return c.json({ ok: false }, 404);
  if (p.event === "form_view" || p.event === "form_open") {
    await bumpStat(shop.id, p.formId, p.event);
    return c.json({ ok: true });
  }
  // InitiateCheckout côté serveur, avec l'event_id généré par le navigateur (déduplication).
  const settings = shopSettings(shop);
  const name = stageEventName(settings, "ic");
  if (!name || !p.eventId || !/^kbcod\.[0-9a-f-]{36}\.ic$/.test(p.eventId)) return c.json({ ok: true, skipped: true });
  const pixels = await sql()<PixelRow[]>`SELECT * FROM pixels WHERE shop_id = ${shop.id} AND provider = 'meta' AND enabled AND capi_token_enc IS NOT NULL`;
  const ip = clientIp(c);
  const event = {
    event_name: name,
    event_time: Math.floor(Date.now() / 1000),
    event_id: p.eventId,
    action_source: "website",
    event_source_url: p.pageUrl ?? undefined,
    user_data: buildUserData({ id: "", phone_e164: null, customer: {} as any, client: { ip, ua: c.req.header("user-agent") ?? null, fbp: p.fbp, fbc: p.fbc } }),
    custom_data: {
      currency: shop.currency,
      value: p.value !== null ? p.value / 100 : undefined,
      content_type: "product",
      content_ids: p.productId ? [p.productId] : undefined,
    },
  };
  const work = Promise.all(
    pixels.map(async (px) => {
      const [row] = await sql()<{ id: string; status: string }[]>`INSERT INTO tracking_events (shop_id, pixel_row_id, event_name, event_id, stage, status, payload)
        VALUES (${shop.id}, ${px.id}, ${name}, ${p.eventId}, 'ic', 'pending', ${sql().json({ ...event, user_data: { fbp: Boolean(p.fbp), fbc: Boolean(p.fbc) } } as any)})
        ON CONFLICT (pixel_row_id, event_name, event_id) DO NOTHING RETURNING id, status`;
      if (!row) return;
      try {
        const resp = await postToMeta(px, [event]);
        await sql()`UPDATE tracking_events SET status = 'sent', attempts = 1, response = ${sql().json(resp)}, sent_at = now() WHERE id = ${row.id}`;
      } catch (e) {
        await sql()`UPDATE tracking_events SET status = 'failed', attempts = 1, last_error = ${errMsg(e).slice(0, 500)} WHERE id = ${row.id}`;
      }
    }),
  );
  c.get("defer")(work);
  return c.json({ ok: true });
});

storefront.post("/post-purchase", async (c) => {
  const body = (await readJson(c)) as { shop?: string; token?: string; accept?: boolean } | null;
  const data = body?.token ? verifyToken<{ sid: string; oid: string }>(body.token) : null;
  if (!body?.shop || !data) return c.json({ ok: false, message: "Offre expirée" }, 400);
  const shop = await getShopByDomain(body.shop);
  if (!shop) return c.json({ ok: false }, 404);
  try {
    if (body.accept) {
      const r = await acceptPostPurchase(shop, data.sid, data.oid);
      c.get("defer")(import("../services/jobs").then((m) => m.processDueJobs({ budgetMs: 8000 })));
      return c.json({ ok: true, ...r });
    }
    await declinePostPurchase(shop, data.sid);
    c.get("defer")(import("../services/jobs").then((m) => m.processDueJobs({ budgetMs: 8000 })));
    return c.json({ ok: true, added: false });
  } catch (e) {
    log("warn", "post_purchase.failed", { error: errMsg(e) });
    return c.json({ ok: false, message: "Impossible d'ajouter le produit. Votre commande initiale est conservée." }, 200);
  }
});

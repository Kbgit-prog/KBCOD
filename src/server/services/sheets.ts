import { z } from "zod";
import { formatMoney } from "../../shared/pricing";
import { sql } from "../db";
import { env } from "../env";
import { decryptOpt, encrypt, signToken } from "../lib/crypto";
import { errMsg, log } from "../lib/log";
import { PermanentJobError, enqueue } from "./jobs";
import type { SubmissionRow } from "./orders";
import type { ShopRow } from "./shops";
import { asText } from "./validation";

export const GOOGLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/spreadsheets"];

export const mappingSchema = z
  .array(z.object({ header: z.string().min(1).max(100), source: z.string().min(1).max(120) }))
  .max(60);
export type SheetMapping = z.infer<typeof mappingSchema>;

export const BUILTIN_SOURCES: Record<string, string> = {
  date: "Date",
  order_name: "N° commande",
  order_id: "ID commande Shopify",
  status: "Statut",
  full_name: "Nom complet",
  first_name: "Prénom",
  last_name: "Nom",
  phone: "Téléphone",
  email: "E-mail",
  address: "Adresse",
  address2: "Complément d'adresse",
  city: "Ville",
  province: "Région",
  zip: "Code postal",
  country: "Pays",
  note: "Note",
  products: "Produits (titre × qté)",
  product_title: "Produit",
  variant_title: "Variante",
  sku: "SKU",
  quantity: "Quantité",
  unit_price: "Prix unitaire",
  subtotal: "Sous-total",
  shipping: "Frais de livraison",
  shipping_method: "Mode de livraison",
  discount: "Réduction",
  discount_codes: "Offres / codes",
  total: "Total",
  currency: "Devise",
  page_url: "Page d'origine",
};

export function defaultMapping(): SheetMapping {
  return ["date", "order_name", "full_name", "phone", "address", "city", "products", "quantity", "total", "status"].map((s) => ({
    header: BUILTIN_SOURCES[s]!,
    source: s,
  }));
}

// ---------- OAuth ----------

export function googleAuthUrl(shopId: string): string {
  const e = env();
  if (!e.GOOGLE_CLIENT_ID) throw new Error("GOOGLE_CLIENT_ID non configuré sur le serveur");
  const p = new URLSearchParams({
    client_id: e.GOOGLE_CLIENT_ID,
    redirect_uri: `${e.APP_URL}/google/callback`,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
    state: signToken({ s: shopId }, 600),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as any;
  return { ok: res.ok, status: res.status, json };
}

export async function handleGoogleCallback(shopId: string, code: string): Promise<string> {
  const e = env();
  const r = await tokenRequest({
    code,
    client_id: e.GOOGLE_CLIENT_ID,
    client_secret: e.GOOGLE_CLIENT_SECRET,
    redirect_uri: `${e.APP_URL}/google/callback`,
    grant_type: "authorization_code",
  });
  if (!r.ok) throw new Error(`Google a refusé l'autorisation : ${r.json?.error_description ?? r.status}`);
  const { access_token, refresh_token, expires_in, scope, id_token } = r.json as Record<string, any>;
  if (!String(scope ?? "").includes("spreadsheets")) throw new Error("L'accès à Google Sheets n'a pas été accordé");
  let email: string | null = null;
  if (id_token) {
    try {
      email = JSON.parse(Buffer.from(String(id_token).split(".")[1]!, "base64url").toString()).email ?? null;
    } catch {
      email = null;
    }
  }
  await sql()`INSERT INTO google_connections (shop_id, google_email, refresh_token_enc, access_token_enc, access_expires_at, scope, status, last_error)
    VALUES (${shopId}, ${email}, ${refresh_token ? encrypt(refresh_token) : null}, ${encrypt(access_token)},
      ${new Date(Date.now() + (expires_in ?? 3600) * 1000)}, ${scope}, 'connected', NULL)
    ON CONFLICT (shop_id) DO UPDATE SET google_email = EXCLUDED.google_email,
      refresh_token_enc = coalesce(EXCLUDED.refresh_token_enc, google_connections.refresh_token_enc),
      access_token_enc = EXCLUDED.access_token_enc, access_expires_at = EXCLUDED.access_expires_at,
      scope = EXCLUDED.scope, status = 'connected', last_error = NULL, updated_at = now()`;
  // Reprend les synchronisations qui attendaient une reconnexion.
  await retryActionRequired(shopId);
  return email ?? "";
}

export interface GoogleConnection {
  shop_id: string;
  google_email: string | null;
  refresh_token_enc: string | null;
  access_token_enc: string | null;
  access_expires_at: Date | null;
  status: "connected" | "revoked" | "error";
  spreadsheet_id: string | null;
  spreadsheet_title: string | null;
  sheet_title: string | null;
  sheet_id: string | null;
  mapping: SheetMapping;
  row_mode: "order" | "product";
  enabled: boolean;
  include_blocked: boolean;
  last_error: string | null;
}

export async function getConnection(shopId: string): Promise<GoogleConnection | null> {
  const [c] = await sql()<GoogleConnection[]>`SELECT * FROM google_connections WHERE shop_id = ${shopId}`;
  return c ?? null;
}

export class GoogleAuthRevoked extends Error {}

async function googleAccessToken(c: GoogleConnection): Promise<string> {
  if (c.status === "revoked") throw new GoogleAuthRevoked("Connexion Google révoquée : reconnectez votre compte");
  if (c.access_token_enc && c.access_expires_at && c.access_expires_at.getTime() - Date.now() > 60_000) {
    return decryptOpt(c.access_token_enc)!;
  }
  const refresh = decryptOpt(c.refresh_token_enc);
  if (!refresh) throw new GoogleAuthRevoked("Aucun jeton de rafraîchissement Google : reconnectez votre compte");
  const r = await tokenRequest({
    client_id: env().GOOGLE_CLIENT_ID,
    client_secret: env().GOOGLE_CLIENT_SECRET,
    refresh_token: refresh,
    grant_type: "refresh_token",
  });
  if (!r.ok) {
    if (r.json?.error === "invalid_grant") {
      await sql()`UPDATE google_connections SET status = 'revoked', last_error = 'Jeton Google expiré ou révoqué', updated_at = now() WHERE shop_id = ${c.shop_id}`;
      throw new GoogleAuthRevoked("Jeton Google expiré ou révoqué : reconnectez votre compte");
    }
    throw new Error(`Rafraîchissement Google impossible (${r.status})`);
  }
  await sql()`UPDATE google_connections SET access_token_enc = ${encrypt(r.json.access_token)},
    access_expires_at = ${new Date(Date.now() + (r.json.expires_in ?? 3600) * 1000)}, updated_at = now() WHERE shop_id = ${c.shop_id}`;
  return r.json.access_token as string;
}

export class SheetsApiError extends Error {
  constructor(message: string, readonly status: number, readonly retryable: boolean) {
    super(message);
  }
}

async function sheetsFetch(c: GoogleConnection, path: string, init: RequestInit = {}): Promise<any> {
  const token = await googleAccessToken(c);
  let res: Response;
  try {
    res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new SheetsApiError(`Réseau Google indisponible : ${errMsg(e)}`, 0, true);
  }
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const msg = json?.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 401) {
      await sql()`UPDATE google_connections SET access_expires_at = now() WHERE shop_id = ${c.shop_id}`;
      throw new SheetsApiError(`Accès Google refusé : ${msg}`, 401, true);
    }
    const retryable = res.status === 429 || res.status >= 500;
    throw new SheetsApiError(msg, res.status, retryable);
  }
  return json;
}

export function quoteSheet(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

export function parseSpreadsheetId(input: string): string | null {
  const m = /\/spreadsheets\/d\/([a-zA-Z0-9-_]{20,})/.exec(input) ?? /^([a-zA-Z0-9-_]{20,})$/.exec(input.trim());
  return m?.[1] ?? null;
}

export async function describeSpreadsheet(shopId: string, spreadsheetId: string) {
  const c = await getConnection(shopId);
  if (!c) throw new Error("Compte Google non connecté");
  const json = await sheetsFetch(c, `${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties(sheetId,title)`);
  return {
    id: spreadsheetId,
    title: json.properties?.title as string,
    sheets: (json.sheets ?? []).map((s: any) => ({ id: String(s.properties.sheetId), title: s.properties.title as string })),
  };
}

export async function readHeaders(c: GoogleConnection, spreadsheetId: string, sheetTitle: string): Promise<string[]> {
  const json = await sheetsFetch(c, `${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${quoteSheet(sheetTitle)}!1:1`)}`);
  return ((json.values?.[0] ?? []) as string[]).map((h) => String(h ?? "").trim());
}

/** Écrit les en-têtes uniquement si la ligne 1 est vide (n'écrase jamais de données). */
export async function writeHeadersIfEmpty(shopId: string): Promise<{ written: boolean; headers: string[] }> {
  const c = await getConnection(shopId);
  if (!c?.spreadsheet_id || !c.sheet_title) throw new Error("Choisissez d'abord un fichier et une feuille");
  const existing = await readHeaders(c, c.spreadsheet_id, c.sheet_title);
  if (existing.some((h) => h !== "")) return { written: false, headers: existing };
  const headers = c.mapping.map((m) => m.header);
  await sheetsFetch(c, `${encodeURIComponent(c.spreadsheet_id)}/values/${encodeURIComponent(`${quoteSheet(c.sheet_title)}!A1`)}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ values: [headers] }),
  });
  return { written: true, headers };
}

export async function createSpreadsheet(shopId: string, title: string) {
  const c = await getConnection(shopId);
  if (!c) throw new Error("Compte Google non connecté");
  const json = await sheetsFetch(c, "", {
    method: "POST",
    body: JSON.stringify({ properties: { title }, sheets: [{ properties: { title: "Commandes" } }] }),
  });
  return { id: json.spreadsheetId as string, title, sheets: [{ id: String(json.sheets?.[0]?.properties?.sheetId ?? 0), title: "Commandes" }] };
}

// ---------- Construction des lignes ----------

function lineText(sub: SubmissionRow) {
  return (sub.quote?.lines ?? []).map((l) => `${l.title}${l.variantTitle && l.variantTitle !== "Default Title" ? ` (${l.variantTitle})` : ""} × ${l.quantity}`).join(" | ");
}

export function buildRows(sub: SubmissionRow, mapping: SheetMapping, headers: string[], mode: "order" | "product", shop: Pick<ShopRow, "money_format" | "timezone">): (string | number)[][] {
  const q = sub.quote;
  const fmt = (minor: number) => Number((minor / 100).toFixed(2));
  const c = sub.customer;
  const date = new Intl.DateTimeFormat("fr-FR", {
    timeZone: shop.timezone ?? "UTC",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(sub.created_at));
  const items = mode === "product" && q?.lines.length ? q.lines : [null];
  const colIndex = new Map<string, number>();
  headers.forEach((h, i) => colIndex.set(h.trim().toLowerCase(), i));
  const width = Math.max(headers.length, 1);
  return items.map((line) => {
    const row: (string | number)[] = new Array(width).fill("");
    for (const m of mapping) {
      const idx = colIndex.get(m.header.trim().toLowerCase());
      if (idx === undefined) continue;
      let value: string | number = "";
      const src = m.source;
      if (src.startsWith("field:")) value = asText(sub.fields[src.slice(6)] as any);
      else if (src.startsWith("const:")) value = src.slice(6);
      else
        switch (src) {
          case "date": value = date; break;
          case "order_name": value = sub.shopify_order_name ?? ""; break;
          case "order_id": value = sub.shopify_order_gid?.split("/").pop() ?? ""; break;
          case "status": value = sub.status === "created" ? "Nouvelle" : sub.status; break;
          case "full_name": value = c.fullName ?? ""; break;
          case "first_name": value = c.firstName ?? ""; break;
          case "last_name": value = c.lastName ?? ""; break;
          case "phone": value = c.phone ?? ""; break;
          case "email": value = c.email ?? ""; break;
          case "address": value = c.address1 ?? ""; break;
          case "address2": value = c.address2 ?? ""; break;
          case "city": value = c.city ?? ""; break;
          case "province": value = c.province ?? ""; break;
          case "zip": value = c.zip ?? ""; break;
          case "country": value = c.countryCode ?? ""; break;
          case "note": value = c.note ?? ""; break;
          case "products": value = line ? `${line.title} × ${line.quantity}` : lineText(sub); break;
          case "product_title": value = line ? line.title : (q?.lines ?? []).map((l) => l.title).join(" | "); break;
          case "variant_title": value = line ? line.variantTitle : (q?.lines ?? []).map((l) => l.variantTitle).join(" | "); break;
          case "sku": value = line ? (line.sku ?? "") : (q?.lines ?? []).map((l) => l.sku ?? "").join(" | "); break;
          case "quantity": value = line ? line.quantity : (q?.lines ?? []).reduce((s, l) => s + l.quantity, 0); break;
          case "unit_price": value = line ? fmt(line.unitPrice) : (q?.lines ?? []).map((l) => formatMoney(l.unitPrice, shop.money_format)).join(" | "); break;
          case "subtotal": value = fmt(q?.subtotal ?? 0); break;
          case "shipping": value = fmt(q?.shipping?.price ?? 0); break;
          case "shipping_method": value = q?.shipping?.name ?? ""; break;
          case "discount": value = fmt(q?.discountTotal ?? 0); break;
          case "discount_codes": value = (q?.discounts ?? []).map((d) => d.label).join(" | "); break;
          case "total": value = fmt(Number(sub.total_minor ?? q?.total ?? 0)); break;
          case "currency": value = sub.currency ?? ""; break;
          case "page_url": value = sub.client?.pageUrl ?? ""; break;
        }
      // Écriture en mode RAW : aucune formule n'est interprétée (pas d'injection), le « + » du téléphone est conservé.
      row[idx] = value;
    }
    return row;
  });
}

// ---------- Synchronisation (travail de file) ----------

export async function syncSubmissionToSheet(shopId: string, submissionId: string): Promise<string> {
  const c = await getConnection(shopId);
  if (!c || !c.enabled) return "désactivé";
  if (!c.spreadsheet_id || !c.sheet_title) throw new PermanentJobError("Aucun fichier/feuille sélectionné");
  const [sub] = await sql()<SubmissionRow[]>`SELECT * FROM submissions WHERE id = ${submissionId} AND shop_id = ${shopId}`;
  if (!sub) throw new PermanentJobError("Soumission introuvable");
  if (sub.status !== "created" && !(c.include_blocked && sub.status === "blocked")) return `ignorée (${sub.status})`;
  const [shop] = await sql()<ShopRow[]>`SELECT * FROM shops WHERE id = ${shopId}`;

  const [sync] = await sql()<{ id: string; status: string; attempts: number }[]>`
    INSERT INTO sheet_syncs (shop_id, submission_id, spreadsheet_id, sheet_title, status, attempts)
    VALUES (${shopId}, ${submissionId}, ${c.spreadsheet_id}, ${c.sheet_title}, 'running', 1)
    ON CONFLICT (shop_id, submission_id, spreadsheet_id, sheet_title)
    DO UPDATE SET status = CASE WHEN sheet_syncs.status = 'synced' THEN 'synced' ELSE 'running' END,
      attempts = sheet_syncs.attempts + 1, updated_at = now()
    RETURNING id, status, attempts`;
  if (sync!.status === "synced") return "déjà synchronisée";

  const fail = async (status: "retrying" | "action_required", e: unknown) => {
    await sql()`UPDATE sheet_syncs SET status = ${status}, last_error = ${errMsg(e).slice(0, 1000)}, updated_at = now() WHERE id = ${sync!.id}`;
    if (status === "action_required") {
      await sql()`UPDATE google_connections SET last_error = ${errMsg(e).slice(0, 500)}, updated_at = now() WHERE shop_id = ${shopId}`;
    }
  };

  try {
    const headers = await readHeaders(c, c.spreadsheet_id, c.sheet_title);
    const missing = c.mapping.filter((m) => !headers.some((h) => h.toLowerCase() === m.header.trim().toLowerCase()));
    if (missing.length) {
      throw new PermanentJobError(`Colonnes absentes dans la feuille : ${missing.map((m) => m.header).join(", ")}`);
    }
    // Après une tentative incertaine, vérifier que la commande n'a pas déjà été écrite (anti-doublon).
    if (sync!.attempts > 1 && sub.shopify_order_name) {
      const keyMap = c.mapping.find((m) => m.source === "order_name");
      const idx = keyMap ? headers.findIndex((h) => h.toLowerCase() === keyMap.header.toLowerCase()) : -1;
      if (idx >= 0) {
        const col = columnLetter(idx);
        const json = await sheetsFetch(c, `${encodeURIComponent(c.spreadsheet_id)}/values/${encodeURIComponent(`${quoteSheet(c.sheet_title)}!${col}:${col}`)}`);
        const found = ((json.values ?? []) as string[][]).some((r) => String(r[0] ?? "") === sub.shopify_order_name);
        if (found) {
          await sql()`UPDATE sheet_syncs SET status = 'synced', synced_at = now(), last_error = NULL, updated_at = now() WHERE id = ${sync!.id}`;
          return "déjà présente dans la feuille";
        }
      }
    }
    const rows = buildRows(sub, c.mapping, headers, c.row_mode, shop!);
    const json = await sheetsFetch(
      c,
      `${encodeURIComponent(c.spreadsheet_id)}/values/${encodeURIComponent(`${quoteSheet(c.sheet_title)}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: "POST", body: JSON.stringify({ values: rows, majorDimension: "ROWS" }) },
    );
    await sql()`UPDATE sheet_syncs SET status = 'synced', updated_range = ${json.updates?.updatedRange ?? null}, synced_at = now(),
      last_error = NULL, updated_at = now() WHERE id = ${sync!.id}`;
    await sql()`UPDATE google_connections SET last_error = NULL WHERE shop_id = ${shopId} AND last_error IS NOT NULL`;
    return json.updates?.updatedRange ?? "ok";
  } catch (e) {
    if (e instanceof GoogleAuthRevoked || e instanceof PermanentJobError) {
      await fail("action_required", e);
      throw new PermanentJobError(errMsg(e));
    }
    if (e instanceof SheetsApiError && !e.retryable) {
      const hint = e.status === 404 ? "Fichier introuvable (supprimé ?)" : e.status === 400 ? "Feuille introuvable (renommée ?)" : e.status === 403 ? "Accès refusé au fichier" : "";
      await fail("action_required", new Error(`${hint} ${e.message}`.trim()));
      throw new PermanentJobError(`${hint} ${e.message}`.trim());
    }
    await fail("retrying", e);
    throw e;
  }
}

export function columnLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Relance les synchronisations en attente d'intervention (après correction ou reconnexion). */
export async function retryActionRequired(shopId: string): Promise<number> {
  const rows = await sql()<{ submission_id: string }[]>`SELECT submission_id FROM sheet_syncs WHERE shop_id = ${shopId} AND status IN ('action_required','retrying')`;
  for (const r of rows) {
    const updated = await sql()`UPDATE jobs SET status = 'pending', attempts = 0, run_at = now(), last_error = NULL
      WHERE dedupe_key = ${`sheets:${r.submission_id}`} AND shop_id = ${shopId} AND status IN ('dead','failed') RETURNING id`;
    if (!updated.length) await enqueue("sheets.sync", `sheets:${r.submission_id}`, { submissionId: r.submission_id }, { shopId });
  }
  log("info", "sheets.retry_all", { count: rows.length });
  return rows.length;
}

export async function disconnectGoogle(shopId: string): Promise<void> {
  const c = await getConnection(shopId);
  const token = c ? decryptOpt(c.refresh_token_enc) : null;
  if (token) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => undefined);
  }
  await sql()`UPDATE google_connections SET status = 'revoked', refresh_token_enc = NULL, access_token_enc = NULL, enabled = false, updated_at = now()
    WHERE shop_id = ${shopId}`;
}

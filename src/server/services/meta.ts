import { sql } from "../db";
import { env } from "../env";
import { decryptOpt, sha256Hex } from "../lib/crypto";
import { errMsg } from "../lib/log";
import { PermanentJobError } from "./jobs";
import type { SubmissionRow } from "./orders";
import { eventId } from "./orders";
import type { ShopSettings } from "./settings";
import { shopSettings, type ShopRow } from "./shops";

export type Stage = "ic" | "submit" | "confirmed" | "shipped" | "paid";

export interface PixelRow {
  id: string;
  shop_id: string;
  provider: string;
  name: string;
  pixel_id: string;
  capi_token_enc: string | null;
  test_event_code: string | null;
  enabled: boolean;
}

export function stageEventName(settings: ShopSettings, stage: Stage): string | null {
  const t = settings.tracking;
  switch (stage) {
    case "ic":
      return t.initiateCheckout ? "InitiateCheckout" : null;
    case "submit":
      return t.submitEvent === "Custom" ? t.submitCustomName : t.submitEvent;
    case "confirmed":
      return t.confirmedEvent || null;
    case "shipped":
      return t.shippedEvent || null;
    case "paid":
      return t.paidEvent || null;
  }
}

// ---------- Normalisation (règles Meta : minuscules, sans espaces/ponctuation, puis SHA-256) ----------

const h = (v: string | null | undefined) => (v ? sha256Hex(v) : undefined);

export function normEmail(e: string | null | undefined) {
  return e ? e.trim().toLowerCase() : null;
}
/** Téléphone : chiffres uniquement, indicatif pays inclus, sans + ni 00. */
export function normPhone(p: string | null | undefined) {
  if (!p) return null;
  const d = p.replace(/\D/g, "").replace(/^00/, "");
  return d.length >= 6 ? d : null;
}
export function normName(n: string | null | undefined) {
  if (!n) return null;
  const v = n
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]/gu, "");
  return v || null;
}
export function normCity(c: string | null | undefined) {
  return normName(c);
}
export function normZip(z: string | null | undefined) {
  return z ? z.toLowerCase().replace(/\s/g, "") || null : null;
}

export function buildUserData(sub: Pick<SubmissionRow, "customer" | "client" | "id" | "phone_e164">) {
  const c = sub.customer ?? ({} as SubmissionRow["customer"]);
  const phone = normPhone(c.phone ?? sub.phone_e164);
  const ud: Record<string, unknown> = {
    em: c.email ? [h(normEmail(c.email))] : undefined,
    ph: phone ? [h(phone)] : undefined,
    fn: c.firstName ? [h(normName(c.firstName))] : undefined,
    ln: c.lastName ? [h(normName(c.lastName))] : undefined,
    ct: c.city ? [h(normCity(c.city))] : undefined,
    st: c.province ? [h(normName(c.province))] : undefined,
    zp: c.zip ? [h(normZip(c.zip))] : undefined,
    country: c.countryCode ? [h(c.countryCode.toLowerCase())] : undefined,
    external_id: phone ? [h(phone)] : undefined,
    client_ip_address: sub.client?.ip ?? undefined,
    client_user_agent: sub.client?.ua ?? undefined,
    fbp: sub.client?.fbp ?? undefined,
    fbc: sub.client?.fbc ?? undefined,
  };
  for (const k of Object.keys(ud)) {
    const v = ud[k];
    if (v === undefined || (Array.isArray(v) && v.every((x) => x === undefined))) delete ud[k];
  }
  return ud;
}

export function buildEvent(sub: SubmissionRow, eventName: string, stage: Stage, eventTime: Date) {
  const lines = sub.quote?.lines ?? [];
  const value = Number(sub.total_minor ?? sub.quote?.total ?? 0) / 100;
  return {
    event_name: eventName,
    event_time: Math.floor(eventTime.getTime() / 1000),
    event_id: eventId(sub.id, stage),
    action_source: "website",
    event_source_url: sub.client?.pageUrl ?? undefined,
    user_data: buildUserData(sub),
    custom_data: {
      currency: sub.currency ?? undefined,
      value,
      content_type: "product",
      content_ids: [...new Set(lines.map((l) => l.productId))],
      contents: lines.map((l) => ({ id: l.productId, quantity: l.quantity, item_price: l.unitPrice / 100 })),
      num_items: lines.reduce((s, l) => s + l.quantity, 0),
      order_id: sub.shopify_order_name ?? undefined,
      // Contexte COD explicite : la commande n'est pas payée à ce stade.
      payment_method: "cash_on_delivery",
      payment_status: stage === "paid" ? "paid" : "pending",
      cod_stage: stage,
    },
  };
}

export class MetaApiError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly response?: unknown) {
    super(message);
  }
}

export async function postToMeta(pixel: PixelRow, events: unknown[]): Promise<any> {
  const token = decryptOpt(pixel.capi_token_enc);
  if (!token) throw new MetaApiError("Jeton CAPI manquant", false);
  const body: Record<string, unknown> = { data: events };
  if (pixel.test_event_code) body.test_event_code = pixel.test_event_code;
  let res: Response;
  try {
    res = await fetch(`https://graph.facebook.com/${env().META_GRAPH_VERSION}/${encodeURIComponent(pixel.pixel_id)}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new MetaApiError(`Réseau Meta indisponible : ${errMsg(e)}`, true);
  }
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const err = json?.error ?? {};
    const retryable = res.status >= 500 || res.status === 429 || err.is_transient === true || [1, 2, 4, 17, 341].includes(err.code);
    throw new MetaApiError(`Meta ${res.status} (code ${err.code ?? "?"}${err.error_subcode ? `/${err.error_subcode}` : ""}) : ${err.message ?? "erreur"}`, retryable, json);
  }
  return json;
}

/**
 * Envoie l'événement d'une étape à chaque pixel Meta avec CAPI. L'event_id est déterministe
 * (kbcod.<soumission>.<étape>) : identique au navigateur et stable entre les tentatives.
 */
export async function sendStage(shopId: string, submissionId: string, stage: Stage, eventTime?: Date): Promise<string> {
  const [shop] = await sql()<ShopRow[]>`SELECT * FROM shops WHERE id = ${shopId}`;
  if (!shop) throw new PermanentJobError("Boutique introuvable");
  const settings = shopSettings(shop);
  const name = stageEventName(settings, stage);
  if (!name) return "étape désactivée";
  const [sub] = await sql()<SubmissionRow[]>`SELECT * FROM submissions WHERE id = ${submissionId} AND shop_id = ${shopId}`;
  if (!sub) throw new PermanentJobError("Soumission introuvable");
  if (stage !== "ic" && sub.status !== "created") return `ignorée (${sub.status})`;
  const pixels = await sql()<PixelRow[]>`SELECT * FROM pixels WHERE shop_id = ${shopId} AND provider = 'meta' AND enabled AND capi_token_enc IS NOT NULL`;
  if (!pixels.length) return "aucun pixel CAPI";
  const time = eventTime ?? (stage === "submit" ? new Date(sub.created_at) : new Date());
  const event = buildEvent(sub, name, stage, time);
  const failures: string[] = [];
  for (const p of pixels) {
    const [row] = await sql()<{ id: string; status: string }[]>`
      INSERT INTO tracking_events (shop_id, pixel_row_id, event_name, event_id, stage, submission_id, status, payload, attempts)
      VALUES (${shopId}, ${p.id}, ${name}, ${event.event_id}, ${stage}, ${submissionId}, 'pending', ${sql().json(redact(event) as any)}, 0)
      ON CONFLICT (pixel_row_id, event_name, event_id) DO UPDATE SET updated_at = now()
      RETURNING id, status`;
    if (row!.status === "sent") continue;
    try {
      const resp = await postToMeta(p, [event]);
      await sql()`UPDATE tracking_events SET status = 'sent', attempts = attempts + 1, response = ${sql().json(resp)}, last_error = NULL,
        sent_at = now(), updated_at = now() WHERE id = ${row!.id}`;
    } catch (e) {
      const retryable = e instanceof MetaApiError ? e.retryable : true;
      await sql()`UPDATE tracking_events SET status = ${retryable ? "retrying" : "failed"}, attempts = attempts + 1,
        response = ${e instanceof MetaApiError && e.response ? sql().json(e.response as any) : null}, last_error = ${errMsg(e).slice(0, 1000)}, updated_at = now()
        WHERE id = ${row!.id}`;
      if (!retryable) failures.push(`${p.name}: ${errMsg(e)}`);
      else throw e;
    }
  }
  if (failures.length) throw new PermanentJobError(failures.join(" ; "));
  return `${name} envoyé (${pixels.length} pixel(s))`;
}

/** Copie journalisable : données personnelles déjà hachées, IP et user-agent retirés. */
function redact(event: ReturnType<typeof buildEvent>) {
  const { client_ip_address, client_user_agent, ...ud } = event.user_data as Record<string, unknown>;
  return { ...event, user_data: { ...ud, client_ip_address: client_ip_address ? "[présente]" : undefined, client_user_agent: client_user_agent ? "[présent]" : undefined } };
}

/** Test de connexion depuis l'admin : envoie un événement de test (test_event_code obligatoire). */
export async function testPixel(pixel: PixelRow): Promise<unknown> {
  if (!pixel.test_event_code) throw new Error("Renseignez un code d'événement test (Gestionnaire d'événements > Tester les événements)");
  return postToMeta(pixel, [
    {
      event_name: "PageView",
      event_time: Math.floor(Date.now() / 1000),
      event_id: `kbcod.test.${Date.now()}`,
      action_source: "website",
      event_source_url: env().APP_URL,
      user_data: { client_ip_address: "127.0.0.1", client_user_agent: "KB COD Manager test" },
    },
  ]);
}

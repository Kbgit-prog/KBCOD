import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import { sql, type Sql } from "../db";
import { pseudo } from "../lib/crypto";
import type { FraudSettings, LimitRule } from "./settings";

export interface Identity {
  phoneE164: string | null;
  phoneHash: string | null;
  ipHash: string | null;
  deviceHash: string | null;
  emailHash: string | null;
  ipPrefix: string | null;
}

export type FraudAction = "allow" | "block" | "limit" | "otp" | "flag";

export interface FraudDecision {
  action: FraudAction;
  reasons: string[];
  message: string | null;
  allowlisted: boolean;
}

export function normalizePhone(raw: string, defaultCountry: string): { e164: string; callingCode: string } | null {
  const cleaned = raw.replace(/[^\d+]/g, "").replace(/^00/, "+");
  if (cleaned.replace(/\D/g, "").length < 6) return null;
  const p = parsePhoneNumberFromString(cleaned, defaultCountry.toUpperCase() as CountryCode);
  if (!p || !p.isPossible()) return null;
  return { e164: p.number, callingCode: p.countryCallingCode };
}

export function normalizeEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/** Préfixe réseau (IPv4 /24, IPv6 /48) : informatif, jamais utilisé seul pour bloquer. */
export function ipPrefix(ip: string): string | null {
  if (ip.includes(".")) return ip.split(".").slice(0, 3).join(".");
  if (ip.includes(":")) return ip.split(":").slice(0, 3).join(":");
  return null;
}

export function buildIdentity(input: { phone: string | null; ip: string | null; deviceId: string | null; email: string | null; country: string }): Identity {
  const phone = input.phone ? normalizePhone(input.phone, input.country) : null;
  const email = input.email ? normalizeEmail(input.email) : null;
  return {
    phoneE164: phone?.e164 ?? null,
    phoneHash: phone ? pseudo("phone", phone.e164) : null,
    ipHash: input.ip ? pseudo("ip", input.ip) : null,
    deviceHash: input.deviceId ? pseudo("device", input.deviceId) : null,
    emailHash: email ? pseudo("email", email) : null,
    ipPrefix: input.ip ? ipPrefix(input.ip) : null,
  };
}

interface ListRow {
  list: "block" | "allow";
  kind: string;
  value_hash: string | null;
  value_pattern: string | null;
}

async function matchLists(q: Sql, shopId: string, id: Identity): Promise<{ block: string[]; allow: boolean }> {
  const hashes = [id.phoneHash, id.ipHash, id.deviceHash, id.emailHash].filter(Boolean) as string[];
  const rows = await q<ListRow[]>`
    SELECT list, kind, value_hash, value_pattern FROM list_entries
    WHERE shop_id = ${shopId} AND (expires_at IS NULL OR expires_at > now())
      AND (value_hash = ANY(${hashes}) OR kind IN ('phone_prefix','ip_prefix'))`;
  const block: string[] = [];
  let allow = false;
  for (const r of rows) {
    let hit = false;
    if (r.kind === "phone_prefix") hit = Boolean(id.phoneE164 && r.value_pattern && id.phoneE164.startsWith(r.value_pattern));
    else if (r.kind === "ip_prefix") hit = Boolean(id.ipPrefix && r.value_pattern && `${id.ipPrefix}.`.startsWith(r.value_pattern));
    else hit = Boolean(r.value_hash && hashes.includes(r.value_hash));
    if (!hit) continue;
    if (r.list === "allow") allow = true;
    else block.push(`liste_noire:${r.kind}`);
  }
  return { block, allow };
}

/**
 * Nombre de commandes dans la fenêtre glissante [maintenant - fenêtre, maintenant].
 * Les soumissions en cours ou incertaines comptent aussi pour éviter les envois parallèles.
 */
export async function countInWindow(
  shopId: string,
  rule: Pick<LimitRule, "identifier" | "windowHours">,
  id: Identity,
  now: Date = new Date(),
  excludeSubmissionId?: string,
  q: Sql = sql(),
): Promise<number | null> {
  const since = new Date(now.getTime() - rule.windowHours * 3_600_000);
  const statuses = ["created", "processing", "uncertain"];
  const exclude = excludeSubmissionId ?? "00000000-0000-0000-0000-000000000000";
  let rows: { n: number }[];
  switch (rule.identifier) {
    case "phone":
      if (!id.phoneHash) return null;
      rows = await q`SELECT count(*)::int AS n FROM submissions WHERE shop_id = ${shopId} AND phone_hash = ${id.phoneHash}
        AND created_at > ${since} AND created_at <= ${now} AND status = ANY(${statuses}) AND id <> ${exclude}`;
      break;
    case "ip":
      if (!id.ipHash) return null;
      rows = await q`SELECT count(*)::int AS n FROM submissions WHERE shop_id = ${shopId} AND ip_hash = ${id.ipHash}
        AND created_at > ${since} AND created_at <= ${now} AND status = ANY(${statuses}) AND id <> ${exclude}`;
      break;
    case "device":
      if (!id.deviceHash) return null;
      rows = await q`SELECT count(*)::int AS n FROM submissions WHERE shop_id = ${shopId} AND device_hash = ${id.deviceHash}
        AND created_at > ${since} AND created_at <= ${now} AND status = ANY(${statuses}) AND id <> ${exclude}`;
      break;
    case "email":
      if (!id.emailHash) return null;
      rows = await q`SELECT count(*)::int AS n FROM submissions WHERE shop_id = ${shopId} AND email_hash = ${id.emailHash}
        AND created_at > ${since} AND created_at <= ${now} AND status = ANY(${statuses}) AND id <> ${exclude}`;
      break;
    case "ip_phone":
      if (!id.ipHash || !id.phoneHash) return null;
      rows = await q`SELECT count(*)::int AS n FROM submissions WHERE shop_id = ${shopId} AND ip_hash = ${id.ipHash}
        AND phone_hash = ${id.phoneHash} AND created_at > ${since} AND created_at <= ${now} AND status = ANY(${statuses}) AND id <> ${exclude}`;
      break;
  }
  return rows[0]?.n ?? 0;
}

export async function recordAttempt(shopId: string, id: Identity, outcome: string): Promise<void> {
  await sql()`INSERT INTO attempts (shop_id, ip_hash, phone_hash, outcome) VALUES (${shopId}, ${id.ipHash}, ${id.phoneHash}, ${outcome})`;
}

export async function recordFraudEvent(shopId: string, submissionId: string | null, rule: string, action: string, detail?: string): Promise<void> {
  await sql()`INSERT INTO fraud_events (shop_id, submission_id, rule, action, detail) VALUES (${shopId}, ${submissionId}, ${rule}, ${action}, ${detail ?? null})`;
}

const severity: Record<FraudAction, number> = { allow: 0, flag: 1, otp: 2, limit: 3, block: 4 };

export interface EvaluateInput {
  shopId: string;
  submissionId: string;
  identity: Identity;
  callingCode: string | null;
  honeypot: string;
  elapsedMs: number;
  quantity: number;
  now?: Date;
}

/** Évalue toutes les protections et retourne l'action la plus sévère. */
export async function evaluateFraud(
  settings: FraudSettings,
  input: EvaluateInput,
  messages: { blocked: string; limitReached: string },
  q: Sql = sql(),
): Promise<FraudDecision> {
  const reasons: string[] = [];
  let action: FraudAction = "allow";
  let message: string | null = null;
  const raise = (a: FraudAction, reason: string, msg?: string) => {
    reasons.push(reason);
    if (severity[a] > severity[action]) {
      action = a;
      message = msg || (a === "block" ? messages.blocked : a === "limit" ? messages.limitReached : null);
    }
  };
  if (!settings.enabled) return { action: "allow", reasons, message: null, allowlisted: false };

  const lists = await matchLists(q, input.shopId, input.identity);
  if (lists.allow) return { action: "allow", reasons: ["liste_blanche"], message: null, allowlisted: true };
  for (const b of lists.block) raise("block", b);

  if (settings.honeypot && input.honeypot.trim() !== "") raise("block", "robot:champ_piege");
  if (input.elapsedMs < settings.minFillMs) raise("block", "robot:envoi_trop_rapide");

  if (settings.allowedCallingCodes.length && input.callingCode && !settings.allowedCallingCodes.includes(input.callingCode)) {
    raise("block", "indicatif_non_autorise");
  }
  if (settings.maxQuantityPerOrder && input.quantity > settings.maxQuantityPerOrder) raise("block", "quantite_maximale");

  if (input.identity.ipHash) {
    const since = new Date((input.now ?? new Date()).getTime() - 10 * 60_000);
    const [r] = await q<{ n: number }[]>`SELECT count(*)::int AS n FROM attempts
      WHERE shop_id = ${input.shopId} AND ip_hash = ${input.identity.ipHash} AND created_at > ${since}`;
    if ((r?.n ?? 0) >= settings.attemptsPer10Min) raise("limit", "tentatives_repetees");
  }

  for (const rule of settings.rules) {
    if (!rule.enabled) continue;
    const n = await countInWindow(input.shopId, rule, input.identity, input.now, input.submissionId, q);
    if (n === null) continue;
    if (n >= rule.maxOrders) {
      raise(rule.action === "block" ? "limit" : rule.action, `limite:${rule.id}:${rule.identifier}:${n}/${rule.maxOrders}/${rule.windowHours}h`, rule.message);
    }
  }
  return { action, reasons, message, allowlisted: false };
}

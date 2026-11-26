import { createHash, randomInt } from "node:crypto";
import { sql } from "../db";
import { env } from "../env";
import { decryptOpt, hmacSha256, pseudo } from "../lib/crypto";
import { errMsg, log } from "../lib/log";
import type { ShopSettings } from "./settings";

export type Channel = "sms" | "whatsapp";

export function maskPhone(e164: string): string {
  return e164.length > 6 ? `${e164.slice(0, 4)}${"•".repeat(Math.max(0, e164.length - 6))}${e164.slice(-2)}` : "••••";
}

export function renderTemplate(tpl: string, vars: Record<string, string | number | null | undefined>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
}

export class MessagingNotConfigured extends Error {}

/** Envoi via le fournisseur configuré. Les fournisseurs sont interchangeables et désactivables. */
export async function sendMessage(
  shopId: string,
  settings: ShopSettings,
  channel: Channel,
  to: string,
  text: string,
  templateKey: string,
): Promise<{ providerId: string | null }> {
  const p = settings.providers;
  try {
    let providerId: string | null = null;
    if (channel === "whatsapp") {
      const token = decryptOpt(p.whatsappTokenEnc || null);
      if (!token || !p.whatsappPhoneNumberId) throw new MessagingNotConfigured("WhatsApp Cloud API non configuré");
      const tplName = settings.notifications.whatsappTemplateName;
      const body = tplName
        ? {
            messaging_product: "whatsapp",
            to: to.replace("+", ""),
            type: "template",
            template: { name: tplName, language: { code: p.whatsappLanguage }, components: [{ type: "body", parameters: [{ type: "text", text }] }] },
          }
        : { messaging_product: "whatsapp", to: to.replace("+", ""), type: "text", text: { body: text } };
      const res = await fetch(`https://graph.facebook.com/${env().META_GRAPH_VERSION}/${p.whatsappPhoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      const json = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(json?.error?.message ?? `WhatsApp ${res.status}`);
      providerId = json?.messages?.[0]?.id ?? null;
    } else if (p.smsProvider === "twilio") {
      const token = decryptOpt(p.smsSecretEnc || null);
      if (!token || !p.twilioAccountSid || !p.twilioFrom) throw new MessagingNotConfigured("Twilio non configuré");
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${p.twilioAccountSid}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${p.twilioAccountSid}:${token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, From: p.twilioFrom, Body: text }),
        signal: AbortSignal.timeout(15_000),
      });
      const json = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(json?.message ?? `Twilio ${res.status}`);
      providerId = json?.sid ?? null;
    } else if (p.smsProvider === "webhook") {
      const secret = decryptOpt(p.smsSecretEnc || null);
      if (!p.webhookUrl || !secret) throw new MessagingNotConfigured("Webhook SMS non configuré");
      const payload = JSON.stringify({ to, text, channel, template: templateKey, sentAt: new Date().toISOString() });
      const res = await fetch(p.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-KBCOD-Signature": hmacSha256(secret, payload) },
        body: payload,
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Webhook SMS ${res.status}`);
    } else {
      throw new MessagingNotConfigured("Aucun fournisseur SMS configuré");
    }
    await sql()`INSERT INTO message_logs (shop_id, channel, template, to_masked, status, provider_id)
      VALUES (${shopId}, ${channel}, ${templateKey}, ${maskPhone(to)}, 'sent', ${providerId})`;
    return { providerId };
  } catch (e) {
    await sql()`INSERT INTO message_logs (shop_id, channel, template, to_masked, status, error)
      VALUES (${shopId}, ${channel}, ${templateKey}, ${maskPhone(to)}, 'failed', ${errMsg(e).slice(0, 500)})`;
    log("warn", "message.failed", { channel, template: templateKey, error: errMsg(e) });
    throw e;
  }
}

// ---------- OTP ----------

function hashCode(challengeId: string, code: string): string {
  return createHash("sha256").update(`${challengeId}:${code}:${env().HASH_SALT}`).digest("hex");
}

export async function createOtpChallenge(
  shopId: string,
  shopName: string,
  settings: ShopSettings,
  submissionId: string,
  phoneE164: string,
): Promise<{ challengeId: string }> {
  const o = settings.otp;
  const phoneHash = pseudo("phone", phoneE164);
  const [recent] = await sql()<{ id: string; sends: number; created_at: Date }[]>`
    SELECT id, sends, created_at FROM otp_challenges WHERE shop_id = ${shopId} AND submission_id = ${submissionId}
      AND verified_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1`;
  if (recent && recent.sends >= o.maxSends) throw new Error("Nombre maximal d'envois de code atteint");
  const code = String(randomInt(0, 10 ** o.codeLength)).padStart(o.codeLength, "0");
  const expires = new Date(Date.now() + o.ttlMinutes * 60_000);
  let challengeId: string;
  if (recent) {
    challengeId = recent.id;
    await sql()`UPDATE otp_challenges SET code_hash = ${hashCode(recent.id, code)}, sends = sends + 1, attempts = 0, expires_at = ${expires}
      WHERE id = ${recent.id}`;
  } else {
    const [row] = await sql()<{ id: string }[]>`INSERT INTO otp_challenges (shop_id, submission_id, phone_hash, code_hash, expires_at)
      VALUES (${shopId}, ${submissionId}, ${phoneHash}, 'pending', ${expires}) RETURNING id`;
    challengeId = row!.id;
    await sql()`UPDATE otp_challenges SET code_hash = ${hashCode(challengeId, code)} WHERE id = ${challengeId}`;
  }
  await sendMessage(shopId, settings, o.channel, phoneE164, renderTemplate(o.template, { code, shop_name: shopName }), "otp");
  return { challengeId };
}

export async function verifyOtp(
  shopId: string,
  settings: ShopSettings,
  submissionId: string,
  phoneE164: string,
  challengeId: string,
  code: string,
): Promise<boolean> {
  const [c] = await sql()<{ id: string; code_hash: string; attempts: number; phone_hash: string; verified_at: Date | null }[]>`
    SELECT id, code_hash, attempts, phone_hash, verified_at FROM otp_challenges
    WHERE id = ${challengeId} AND shop_id = ${shopId} AND submission_id = ${submissionId} AND expires_at > now()`;
  if (!c || c.phone_hash !== pseudo("phone", phoneE164)) return false;
  if (c.verified_at) return true;
  if (c.attempts >= settings.otp.maxAttempts) return false;
  const ok = c.code_hash === hashCode(c.id, code);
  await sql()`UPDATE otp_challenges SET attempts = attempts + 1, verified_at = ${ok ? new Date() : null} WHERE id = ${c.id}`;
  return ok;
}

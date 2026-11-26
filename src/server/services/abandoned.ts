import { sql } from "../db";
import { log } from "../lib/log";
import { enqueue, PermanentJobError } from "./jobs";
import { MessagingNotConfigured, renderTemplate, sendMessage } from "./messaging";
import { shopSettings, type ShopRow } from "./shops";
import { bumpStat } from "./stats";

/** Enregistre un formulaire commencé (téléphone ou e-mail saisi). */
export async function savePartial(
  shop: ShopRow,
  p: { submissionId: string; formId: string; productId: string; variantId: string; quantity: number; fields: Record<string, unknown>; consent: boolean },
  phone: string | null,
  email: string | null,
  name: string | null,
): Promise<void> {
  const settings = shopSettings(shop);
  if (!settings.abandoned.enabled || (!phone && !email)) return;
  const [existing] = await sql()<{ status: string }[]>`SELECT status FROM submissions WHERE id = ${p.submissionId} AND shop_id = ${shop.id}`;
  if (existing?.status === "created") return;
  await sql()`INSERT INTO abandoned (id, shop_id, form_id, phone_e164, email, name, fields, product_id, variant_id, quantity, consent, last_activity_at)
    VALUES (${p.submissionId}, ${shop.id}, ${p.formId}, ${phone}, ${email}, ${name}, ${sql().json(p.fields as any)}, ${p.productId},
      ${p.variantId}, ${p.quantity}, ${p.consent}, now())
    ON CONFLICT (id) DO UPDATE SET phone_e164 = EXCLUDED.phone_e164, email = EXCLUDED.email, name = EXCLUDED.name,
      fields = EXCLUDED.fields, variant_id = EXCLUDED.variant_id, quantity = EXCLUDED.quantity, consent = EXCLUDED.consent,
      last_activity_at = now(), status = CASE WHEN abandoned.status = 'open' THEN 'open' ELSE abandoned.status END
    WHERE abandoned.shop_id = EXCLUDED.shop_id`;
  await enqueue("abandoned.check", `abandoned:${p.submissionId}`, { id: p.submissionId }, {
    shopId: shop.id,
    runAt: new Date(Date.now() + settings.abandoned.delayMinutes * 60_000),
  });
}

/** Passe en « abandonné » après le délai sans commande ; relance si le client a consenti et que la relance est activée. */
export async function checkAbandoned(shopId: string, id: string): Promise<string> {
  const [shop] = await sql()<ShopRow[]>`SELECT * FROM shops WHERE id = ${shopId}`;
  if (!shop) throw new PermanentJobError("Boutique introuvable");
  const settings = shopSettings(shop);
  const [row] = await sql()<{ status: string; last_activity_at: Date; phone_e164: string | null; name: string | null; consent: boolean; form_id: string | null }[]>`
    SELECT status, last_activity_at, phone_e164, name, consent, form_id FROM abandoned WHERE id = ${id} AND shop_id = ${shopId}`;
  if (!row || row.status !== "open") return "ignoré";
  const [sub] = await sql()<{ status: string }[]>`SELECT status FROM submissions WHERE id = ${id} AND shop_id = ${shopId}`;
  if (sub?.status === "created") {
    await sql()`UPDATE abandoned SET status = 'converted' WHERE id = ${id} AND shop_id = ${shopId}`;
    return "converti";
  }
  const due = row.last_activity_at.getTime() + settings.abandoned.delayMinutes * 60_000;
  if (Date.now() < due - 5000) {
    // Activité récente : on repousse la vérification.
    await enqueue("abandoned.check", `abandoned:${id}:${row.last_activity_at.getTime()}`, { id }, { shopId, runAt: new Date(due) });
    return "repoussé";
  }
  await sql()`UPDATE abandoned SET status = 'abandoned' WHERE id = ${id} AND shop_id = ${shopId}`;
  await bumpStat(shopId, row.form_id, "abandoned");
  const n = settings.notifications.abandoned;
  if (n.enabled && row.consent && row.phone_e164) {
    try {
      await sendMessage(shopId, settings, n.channel, row.phone_e164, renderTemplate(n.template, { name: row.name ?? "", shop_name: shop.name }), "abandoned");
      await sql()`UPDATE abandoned SET notified_at = now() WHERE id = ${id} AND shop_id = ${shopId}`;
    } catch (e) {
      if (!(e instanceof MessagingNotConfigured)) throw e;
      log("warn", "abandoned.no_provider", { shop: shop.shop_domain });
    }
  }
  return "abandonné";
}

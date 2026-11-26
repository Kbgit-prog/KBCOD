import { formatMoney } from "../../shared/pricing";
import { sql } from "../db";
import { PermanentJobError } from "./jobs";
import { MessagingNotConfigured, renderTemplate, sendMessage } from "./messaging";
import type { SubmissionRow } from "./orders";
import { shopSettings, type ShopRow } from "./shops";

export type NotifyKind = "orderConfirmation" | "shipping";

export async function notifyOrder(shopId: string, submissionId: string, kind: NotifyKind): Promise<string> {
  const [shop] = await sql()<ShopRow[]>`SELECT * FROM shops WHERE id = ${shopId}`;
  if (!shop) throw new PermanentJobError("Boutique introuvable");
  const settings = shopSettings(shop);
  const cfg = settings.notifications[kind];
  if (!cfg.enabled) return "désactivé";
  const [sub] = await sql()<SubmissionRow[]>`SELECT * FROM submissions WHERE id = ${submissionId} AND shop_id = ${shopId}`;
  if (!sub || sub.status !== "created" || !sub.phone_e164) return "ignoré";
  const text = renderTemplate(cfg.template, {
    name: sub.customer.firstName ?? sub.customer.fullName ?? "",
    order_name: sub.shopify_order_name,
    total: formatMoney(Number(sub.total_minor ?? 0), shop.money_format),
    shop_name: shop.name,
    order_status_url: sub.order_status_url,
  });
  try {
    await sendMessage(shopId, settings, cfg.channel, sub.phone_e164, text, kind);
  } catch (e) {
    if (e instanceof MessagingNotConfigured) throw new PermanentJobError(e.message);
    throw e;
  }
  return "envoyé";
}

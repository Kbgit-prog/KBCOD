import { sql } from "../db";
import { log } from "../lib/log";
import { enqueue } from "./jobs";
import { normalizePhone, normalizeEmail } from "./fraud";
import { pseudo } from "../lib/crypto";
import { getShopByDomain, markUninstalled, shopSettings, audit } from "./shops";

interface OrderPayload {
  admin_graphql_api_id?: string;
  id?: number;
  tags?: string;
  financial_status?: string;
  cancelled_at?: string | null;
  order_id?: number;
}

async function submissionForOrder(shopId: string, orderGid: string) {
  const [s] = await sql()<{ id: string }[]>`SELECT id FROM submissions WHERE shop_id = ${shopId} AND shopify_order_gid = ${orderGid} AND status = 'created'`;
  return s?.id ?? null;
}

/** Traite un webhook déjà authentifié (HMAC) et dédupliqué. */
export async function handleWebhook(topic: string, shopDomain: string, payload: any): Promise<void> {
  const t = topic.toLowerCase();
  if (t === "app/uninstalled") {
    await markUninstalled(shopDomain);
    log("info", "app.uninstalled", { shop: shopDomain });
    return;
  }
  const shop = await getShopByDomain(shopDomain);
  if (!shop) return;
  const settings = shopSettings(shop);

  if (t === "shop/redact") {
    // 48 h après désinstallation : suppression de toutes les données de la boutique.
    await sql()`DELETE FROM shops WHERE id = ${shop.id}`;
    log("info", "shop.redacted", { shop: shopDomain });
    return;
  }
  if (t === "customers/redact") {
    const phone = payload?.customer?.phone ? normalizePhone(String(payload.customer.phone), "CI")?.e164 : null;
    const email = payload?.customer?.email ? normalizeEmail(String(payload.customer.email)) : null;
    const orderGids: string[] = (payload?.orders_to_redact ?? []).map((id: number) => `gid://shopify/Order/${id}`);
    const phoneHash = phone ? pseudo("phone", phone) : "-";
    const emailHash = email ? pseudo("email", email) : "-";
    const n = await sql()`UPDATE submissions SET customer = '{}'::jsonb, fields = '{}'::jsonb, phone_e164 = NULL,
        client = client - 'ip' - 'ua' - 'fbp' - 'fbc', updated_at = now()
      WHERE shop_id = ${shop.id} AND (phone_hash = ${phoneHash} OR email_hash = ${emailHash} OR shopify_order_gid = ANY(${orderGids})) RETURNING id`;
    await sql()`DELETE FROM abandoned WHERE shop_id = ${shop.id} AND (phone_e164 = ${phone ?? "-"} OR email = ${email ?? "-"})`;
    await audit(shop.id, "customers/redact", { submissions: n.length });
    return;
  }
  if (t === "customers/data_request") {
    await audit(shop.id, "customers/data_request", { orders: (payload?.orders_requested ?? []).length });
    return;
  }

  const order = payload as OrderPayload;
  const orderGid = order.admin_graphql_api_id ?? (order.id ? `gid://shopify/Order/${order.id}` : null);
  if (t === "orders/updated" && orderGid) {
    const tags = String(order.tags ?? "").split(",").map((x) => x.trim().toLowerCase());
    if (settings.orders.confirmedTag && tags.includes(settings.orders.confirmedTag.toLowerCase())) {
      const sid = await submissionForOrder(shop.id, orderGid);
      if (sid) await enqueue("meta.stage", `meta:${sid}:confirmed`, { submissionId: sid, stage: "confirmed" }, { shopId: shop.id });
    }
    return;
  }
  if (t === "orders/paid" && orderGid) {
    const sid = await submissionForOrder(shop.id, orderGid);
    if (sid) await enqueue("meta.stage", `meta:${sid}:paid`, { submissionId: sid, stage: "paid" }, { shopId: shop.id });
    return;
  }
  if (t === "fulfillments/create") {
    const gid = order.order_id ? `gid://shopify/Order/${order.order_id}` : null;
    if (!gid) return;
    const sid = await submissionForOrder(shop.id, gid);
    if (sid) {
      await enqueue("meta.stage", `meta:${sid}:shipped`, { submissionId: sid, stage: "shipped" }, { shopId: shop.id });
      await enqueue("notify.order", `notify:${sid}:shipping`, { submissionId: sid, kind: "shipping" }, { shopId: shop.id });
    }
    return;
  }
}

/** Retourne false si le webhook a déjà été reçu (Shopify peut renvoyer le même). */
export async function firstReceipt(webhookId: string | null, shop: string, topic: string): Promise<boolean> {
  if (!webhookId) return true;
  const rows = await sql()`INSERT INTO webhook_receipts (webhook_id, shop_domain, topic) VALUES (${webhookId}, ${shop}, ${topic})
    ON CONFLICT DO NOTHING RETURNING webhook_id`;
  return rows.length > 0;
}

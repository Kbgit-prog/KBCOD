import type { SubmitPayload, SubmitResponse } from "../../shared/api-types";
import { computeQuote, fromMinor, type Quote } from "../../shared/pricing";
import { appliesToProduct, type PostPurchase } from "../../shared/offers-schema";
import { sql, type Sql } from "../db";
import { signToken } from "../lib/crypto";
import { errMsg, log } from "../lib/log";
import { gid, idFromGid, ShopifyApiError, type AdminClient } from "../shopify/graphql";
import { loadVariants } from "./catalog";
import { activeOffers, getForm, resolveForm, type FormRow } from "./forms";
import { buildIdentity, evaluateFraud, recordAttempt, recordFraudEvent } from "./fraud";
import { enqueue, processDueJobs } from "./jobs";
import { createOtpChallenge, maskPhone, MessagingNotConfigured, verifyOtp } from "./messaging";
import { shopClient, shopSettings, getShopByDomain, type ShopRow } from "./shops";
import type { ShopSettings } from "./settings";
import { bumpStat } from "./stats";
import { extractCustomer, validateFields, type CustomerInfo } from "./validation";

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
  origin: string | null;
  /** Permet de lancer les travaux en arrière-plan après la réponse (waitUntil). */
  defer?: (p: Promise<unknown>) => void;
}

export interface SubmissionRow {
  id: string;
  shop_id: string;
  form_id: string | null;
  status: "processing" | "created" | "failed" | "blocked" | "otp_pending" | "uncertain";
  phone_e164: string | null;
  customer: CustomerInfo;
  fields: Record<string, unknown>;
  quote: Quote | null;
  currency: string | null;
  total_minor: bigint | number | null;
  shopify_order_gid: string | null;
  shopify_order_name: string | null;
  order_status_url: string | null;
  client: Record<string, any>;
  error: string | null;
  verified_phone: boolean;
  created_at: Date;
}

export const ORDER_CREATE_MUTATION = `#graphql
  mutation KbOrderCreate($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
    orderCreate(order: $order, options: $options) {
      order { id name statusPageUrl displayFinancialStatus totalPriceSet { shopMoney { amount currencyCode } } }
      userErrors { field message code }
    }
  }`;

export const ORDER_LOOKUP_QUERY = `#graphql
  query KbOrderBySource($q: String!) {
    orders(first: 1, query: $q) { nodes { id name statusPageUrl } }
  }`;

export function sourceIdentifier(submissionId: string): string {
  return `kbcod-${submissionId}`;
}

export function eventId(submissionId: string, stage: string): string {
  return `kbcod.${submissionId}.${stage}`;
}

function money(minor: number, currency: string) {
  return { shopMoney: { amount: fromMinor(minor), currencyCode: currency } };
}

/** Construit l'entrée orderCreate. Statut financier toujours PENDING : rien n'est marqué payé. */
export function buildOrderInput(args: {
  submissionId: string;
  quote: Quote;
  customer: CustomerInfo;
  currency: string;
  settings: ShopSettings;
  tags: string[];
  formName: string;
  withCustomer: boolean;
  withTransaction: boolean;
}) {
  const { quote, customer: c, currency, settings: s } = args;
  const address = {
    firstName: c.firstName ?? undefined,
    lastName: c.lastName ?? c.firstName ?? undefined,
    address1: c.address1 ?? c.city ?? undefined,
    address2: c.address2 ?? undefined,
    city: c.city ?? undefined,
    province: c.province ?? undefined,
    zip: c.zip ?? undefined,
    countryCode: c.countryCode,
    phone: c.phone ?? undefined,
  };
  const attrs = [
    { key: "Formulaire", value: args.formName },
    ...c.extra.map((e) => ({ key: e.label.slice(0, 100), value: e.value.slice(0, 1000) })),
  ];
  const order: Record<string, unknown> = {
    lineItems: quote.lines.map((l) => ({
      variantId: gid("ProductVariant", l.variantId),
      quantity: l.quantity,
      priceSet: money(l.unitPrice, currency),
    })),
    financialStatus: "PENDING",
    currency,
    phone: c.phone ?? undefined,
    email: c.email ?? undefined,
    shippingAddress: address,
    billingAddress: address,
    note: c.note ?? undefined,
    tags: [...new Set(args.tags.filter(Boolean))],
    customAttributes: attrs,
    sourceIdentifier: sourceIdentifier(args.submissionId),
    buyerAcceptsMarketing: c.acceptsMarketing,
    taxesIncluded: s.orders.taxesIncluded,
  };
  if (quote.shipping) {
    order.shippingLines = [{ title: quote.shipping.name, code: quote.shipping.id, source: "kbcod", priceSet: money(quote.shipping.price, currency) }];
  }
  if (quote.discountTotal > 0) {
    const code = quote.discounts.map((d) => d.label).join(" + ").slice(0, 250) || "KBCOD";
    order.discountCode = { itemFixedDiscountCode: { code, amountSet: money(quote.discountTotal, currency) } };
  }
  if (args.withCustomer && (c.phone || c.email)) {
    order.customer = {
      toUpsert: {
        firstName: c.firstName ?? undefined,
        lastName: c.lastName ?? undefined,
        phone: c.phone ?? undefined,
        email: c.email ?? undefined,
      },
    };
  }
  if (args.withTransaction && s.orders.recordCodTransaction && quote.total > 0) {
    order.transactions = [{ kind: "SALE", status: "PENDING", gateway: s.orders.gatewayName, amountSet: money(quote.total, currency) }];
  }
  const options = { inventoryBehaviour: s.orders.inventoryBehaviour, sendReceipt: s.orders.sendReceipt, sendFulfillmentReceipt: false };
  return { order, options };
}

interface CreatedOrder {
  id: string;
  name: string;
  statusPageUrl: string | null;
}

/** Recherche une commande déjà créée pour cette soumission (réconciliation après incertitude). */
export async function findExistingOrder(client: AdminClient, submissionId: string): Promise<CreatedOrder | null> {
  const data = await client.request<{ orders: { nodes: CreatedOrder[] } }>(ORDER_LOOKUP_QUERY, {
    q: `source_identifier:"${sourceIdentifier(submissionId)}"`,
  });
  return data.orders.nodes[0] ?? null;
}

/**
 * Crée la commande Shopify. Les erreurs utilisateur (userErrors) garantissent qu'aucune commande n'a été créée :
 * on peut alors réessayer sans client ni transaction. Une erreur réseau rend le résultat incertain.
 */
export async function createShopifyOrder(
  client: AdminClient,
  args: Omit<Parameters<typeof buildOrderInput>[0], "withCustomer" | "withTransaction">,
): Promise<CreatedOrder> {
  const variants = [
    { withCustomer: true, withTransaction: true },
    { withCustomer: false, withTransaction: true },
    { withCustomer: false, withTransaction: false },
  ];
  let lastErrors: string[] = [];
  for (const v of variants) {
    const input = buildOrderInput({ ...args, ...v });
    const data = await client.request<{
      orderCreate: { order: CreatedOrder | null; userErrors: { field: string[] | null; message: string; code: string | null }[] };
    }>(ORDER_CREATE_MUTATION, input, { timeoutMs: 25_000 });
    const r = data.orderCreate;
    if (r.order && !r.userErrors.length) return r.order;
    lastErrors = r.userErrors.map((e) => `${(e.field ?? []).join(".")}: ${e.message}`);
    const fields = r.userErrors.map((e) => (e.field ?? []).join(".").toLowerCase() + " " + e.message.toLowerCase()).join(" ");
    const customerIssue = /customer|phone|email/.test(fields);
    const txIssue = /transaction|gateway/.test(fields);
    if (v.withCustomer && customerIssue) continue;
    if (v.withTransaction && txIssue) continue;
    break;
  }
  throw new ShopifyApiError(`Commande refusée par Shopify : ${lastErrors.join(" ; ")}`, "user", false, lastErrors);
}

async function getSubmission(shopId: string, id: string): Promise<SubmissionRow | null> {
  const [r] = await sql()<SubmissionRow[]>`SELECT * FROM submissions WHERE id = ${id} AND shop_id = ${shopId}`;
  return r ?? null;
}

function successResponse(
  sub: SubmissionRow,
  shop: ShopRow,
  settings: ShopSettings,
  postPurchase: { offerId: string; token: string } | null,
): SubmitResponse {
  const total = Number(sub.total_minor ?? 0);
  const currency = sub.currency ?? shop.currency;
  const lines = sub.quote?.lines ?? [];
  const submitName = settings.tracking.submitEvent === "Custom" ? settings.tracking.submitCustomName : settings.tracking.submitEvent;
  return {
    ok: true,
    status: "created",
    orderName: sub.shopify_order_name ?? "",
    orderId: sub.shopify_order_gid ? idFromGid(sub.shopify_order_gid) : "",
    orderStatusUrl: sub.order_status_url,
    total,
    currency,
    events: [
      {
        name: submitName,
        eventId: eventId(sub.id, "submit"),
        value: total,
        currency,
        contentIds: [...new Set(lines.map((l) => l.productId))],
        numItems: lines.reduce((s, l) => s + l.quantity, 0),
      },
    ],
    postPurchase,
  };
}

function findPostPurchase(offers: Awaited<ReturnType<typeof activeOffers>>, productId: string, submissionId: string) {
  const o = offers.find((x) => x.type === "post_purchase" && appliesToProduct((x.config as PostPurchase).triggerProductIds, productId));
  if (!o) return null;
  return { offerId: o.id, token: signToken({ sid: submissionId, oid: o.id }, 15 * 60) };
}

/** Travaux consécutifs à la création : Sheets, Meta, notifications. Lancés une seule fois grâce aux clés de déduplication. */
export async function enqueueAfterOrder(shop: ShopRow, sub: { id: string }, delayMs = 0): Promise<void> {
  const runAt = new Date(Date.now() + delayMs);
  await enqueue("sheets.sync", `sheets:${sub.id}`, { submissionId: sub.id }, { shopId: shop.id, runAt });
  await enqueue("meta.stage", `meta:${sub.id}:submit`, { submissionId: sub.id, stage: "submit" }, { shopId: shop.id, runAt });
  await enqueue("notify.order", `notify:${sub.id}:confirmation`, { submissionId: sub.id, kind: "orderConfirmation" }, { shopId: shop.id, runAt });
}

export async function handleSubmit(payload: SubmitPayload, ctx: RequestContext): Promise<SubmitResponse> {
  const shop = await getShopByDomain(payload.shop);
  if (!shop || shop.uninstalled_at) return { ok: false, status: "error", message: "Boutique non configurée" };
  const settings = shopSettings(shop);

  let form: FormRow | null = await getForm(shop.id, payload.formId);
  if (!form || !form.active) form = await resolveForm(shop.id, payload.productId);
  if (!form) return { ok: false, status: "error", message: "Formulaire introuvable" };
  const m = form.config.messages;

  // 1. Idempotence : une soumission déjà traitée renvoie le même résultat.
  const existing = await getSubmission(shop.id, payload.submissionId);
  if (existing) {
    if (existing.status === "created") {
      return successResponse(existing, shop, settings, null);
    }
    if (existing.status === "processing" || existing.status === "uncertain") {
      return { ok: true, status: "processing", retryAfterMs: 2000 };
    }
    if (existing.status === "blocked") return { ok: false, status: "blocked", message: existing.error ?? m.blocked };
  }

  // 2. Validation serveur des champs.
  const v = validateFields(form.config, payload.fields as any, form.config.settings.defaultCountry);
  if (Object.keys(v.errors).length) return { ok: false, status: "invalid", message: m.required, fieldErrors: v.errors };
  const customer = extractCustomer(v, form.config.settings.defaultCountry);
  if (form.config.settings.countries.length && !form.config.settings.countries.includes(customer.countryCode)) {
    return { ok: false, status: "invalid", message: "Pays non desservi", fieldErrors: { country: "Pays non desservi" } };
  }

  const identity = buildIdentity({
    phone: customer.phone,
    ip: ctx.ip,
    deviceId: payload.deviceId,
    email: customer.email,
    country: form.config.settings.defaultCountry,
  });

  // 3. Prix et disponibilité faisant foi, relus depuis Shopify.
  const client = await shopClient(shop);
  const offers = await activeOffers(shop.id);
  const upsellVariantIds = offers
    .filter((o) => o.type === "upsell" && payload.upsellIds.includes(o.id))
    .map((o) => (o.config as { variantId: string }).variantId);
  const catalog = await loadVariants(client, [payload.variantId, ...upsellVariantIds]);
  const quote = computeQuote(
    {
      productId: payload.productId,
      variantId: payload.variantId,
      quantity: payload.quantity,
      tierId: payload.tierId,
      upsellIds: payload.upsellIds,
      downsellId: payload.downsellId,
      shippingRateId: payload.shippingRateId,
      discountCode: payload.discountCode,
      country: customer.countryCode,
    },
    {
      catalog,
      offers,
      shippingRates: settings.orders.shippingRates,
      discountCodes: settings.orders.discountCodes,
      allowOutOfStock: settings.orders.allowOutOfStock || form.config.settings.outOfStock === "allow",
    },
  );
  if (quote.errors.length) {
    const outOfStock = quote.errors.some((e) => e.includes("rupture"));
    return { ok: false, status: "invalid", message: outOfStock ? m.outOfStock : quote.errors.join(". ") };
  }
  const totalQty = quote.lines.reduce((s, l) => s + l.quantity, 0);

  // 4. Antifraude + réservation de la soumission dans une transaction verrouillée par téléphone
  //    (deux envois simultanés du même numéro ne peuvent pas contourner la limite).
  type Decision = Awaited<ReturnType<typeof evaluateFraud>>;
  const claim = await sql().begin(async (txRaw) => {
    const tx = txRaw as unknown as Sql;
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`${shop.id}:${identity.phoneHash ?? identity.ipHash ?? payload.submissionId}`}))`;
    const decision: Decision = await evaluateFraud(
      settings.fraud,
      {
        shopId: shop.id,
        submissionId: payload.submissionId,
        identity,
        callingCode: v.phone?.callingCode ?? null,
        honeypot: payload.hp,
        elapsedMs: payload.elapsedMs,
        quantity: totalQty,
      },
      { blocked: m.blocked, limitReached: m.limitReached },
      tx,
    );
    const needsOtp =
      !decision.allowlisted &&
      settings.otp.enabled &&
      (settings.otp.mode === "always" || decision.action === "otp") &&
      decision.action !== "block" &&
      decision.action !== "limit";
    const status = decision.action === "block" || decision.action === "limit" ? "blocked" : needsOtp ? "otp_pending" : "processing";
    const client = {
      ua: ctx.userAgent?.slice(0, 500) ?? null,
      fbp: payload.tracking.fbp,
      fbc: payload.tracking.fbc,
      ttclid: payload.tracking.ttclid,
      pageUrl: payload.tracking.pageUrl,
      ip: ctx.ip,
      flagged: decision.action === "flag",
      reasons: decision.reasons,
    };
    const rows = await tx<SubmissionRow[]>`
      INSERT INTO submissions (id, shop_id, form_id, status, phone_e164, phone_hash, ip_hash, device_hash, email_hash,
        customer, fields, quote, currency, total_minor, client, error, attempts)
      VALUES (${payload.submissionId}, ${shop.id}, ${form!.id}, ${status}, ${customer.phone}, ${identity.phoneHash}, ${identity.ipHash},
        ${identity.deviceHash}, ${identity.emailHash}, ${tx.json(customer as any)}, ${tx.json(v.values as any)}, ${tx.json(quote as any)},
        ${shop.currency}, ${quote.total}, ${tx.json(client as any)}, ${status === "blocked" ? decision.message : null}, 1)
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, customer = EXCLUDED.customer, fields = EXCLUDED.fields,
        quote = EXCLUDED.quote, total_minor = EXCLUDED.total_minor, client = EXCLUDED.client, error = EXCLUDED.error,
        phone_e164 = EXCLUDED.phone_e164, phone_hash = EXCLUDED.phone_hash, attempts = submissions.attempts + 1, updated_at = now()
      WHERE submissions.shop_id = EXCLUDED.shop_id AND submissions.status IN ('failed','otp_pending')
      RETURNING *`;
    return { decision, needsOtp, row: rows[0] ?? null };
  });

  if (!claim.row) {
    // Une autre requête traite déjà cette soumission (double clic) ou elle est terminée.
    const again = await getSubmission(shop.id, payload.submissionId);
    if (again?.status === "created") return successResponse(again, shop, settings, null);
    return { ok: true, status: "processing", retryAfterMs: 2000 };
  }
  const { decision } = claim;
  await recordAttempt(shop.id, identity, decision.action);
  for (const r of decision.reasons) await recordFraudEvent(shop.id, payload.submissionId, r, decision.action);

  if (decision.action === "block" || decision.action === "limit") {
    await bumpStat(shop.id, form.id, "blocked");
    log("info", "submit.blocked", { shop: shop.shop_domain, reasons: decision.reasons });
    return { ok: false, status: decision.action === "limit" ? "limited" : "blocked", message: decision.message ?? m.blocked };
  }

  // 5. OTP si exigé.
  let verified = false;
  if (claim.needsOtp) {
    if (!customer.phone) return { ok: false, status: "invalid", message: m.invalidPhone };
    if (payload.otp) {
      verified = await verifyOtp(shop.id, settings, payload.submissionId, customer.phone, payload.otp.challengeId, payload.otp.code);
      if (!verified) return { ok: false, status: "otp_required", challengeId: payload.otp.challengeId, phoneMasked: maskPhone(customer.phone), message: m.otpInvalid };
      await sql()`UPDATE submissions SET status = 'processing', verified_phone = true, updated_at = now() WHERE id = ${payload.submissionId} AND shop_id = ${shop.id}`;
    } else {
      try {
        const { challengeId } = await createOtpChallenge(shop.id, shop.name ?? "", settings, payload.submissionId, customer.phone);
        return { ok: false, status: "otp_required", challengeId, phoneMasked: maskPhone(customer.phone), message: m.otpText };
      } catch (e) {
        if (e instanceof MessagingNotConfigured) {
          // OTP activé mais aucun fournisseur : la commande est créée et signalée plutôt que perdue.
          log("warn", "otp.provider_missing", { shop: shop.shop_domain });
          await sql()`UPDATE submissions SET status = 'processing', updated_at = now() WHERE id = ${payload.submissionId} AND shop_id = ${shop.id}`;
          decision.action = "flag";
        } else {
          await sql()`UPDATE submissions SET status = 'failed', error = ${errMsg(e)} WHERE id = ${payload.submissionId} AND shop_id = ${shop.id}`;
          return { ok: false, status: "error", message: errMsg(e).includes("maximal") ? errMsg(e) : m.submitError };
        }
      }
    }
  }

  // 6. Création de la commande Shopify.
  const tags = [...settings.orders.tags];
  if (decision.action === "flag") tags.push(settings.fraud.flagTag);
  if (verified) tags.push(settings.otp.verifiedTag);
  try {
    const order = await createShopifyOrder(client, {
      submissionId: payload.submissionId,
      quote,
      customer,
      currency: shop.currency,
      settings,
      tags,
      formName: form.name,
    });
    const [sub] = await sql()<SubmissionRow[]>`UPDATE submissions SET status = 'created', shopify_order_gid = ${order.id},
      shopify_order_name = ${order.name}, order_status_url = ${order.statusPageUrl}, error = NULL, updated_at = now()
      WHERE id = ${payload.submissionId} AND shop_id = ${shop.id} RETURNING *`;
    const postPurchase = findPostPurchase(offers, payload.productId, payload.submissionId);
    await afterOrderCreated(shop, sub!, form.id, Boolean(postPurchase), ctx);
    log("info", "order.created", { shop: shop.shop_domain, order: order.name });
    return successResponse(sub!, shop, settings, postPurchase);
  } catch (e) {
    const uncertain = e instanceof ShopifyApiError ? e.kind === "network" || e.kind === "server" : true;
    const definitive = e instanceof ShopifyApiError && (e.kind === "user" || e.kind === "auth");
    const status = definitive ? "failed" : uncertain ? "uncertain" : "failed";
    await sql()`UPDATE submissions SET status = ${status}, error = ${errMsg(e).slice(0, 1000)}, updated_at = now()
      WHERE id = ${payload.submissionId} AND shop_id = ${shop.id}`;
    log("error", "order.create_failed", { shop: shop.shop_domain, status, error: errMsg(e) });
    if (status === "uncertain" || (e instanceof ShopifyApiError && e.kind === "throttled")) {
      // Réconciliation : retrouve la commande si elle a été créée, sinon la crée (jamais de doublon).
      await sql()`UPDATE submissions SET status = 'uncertain' WHERE id = ${payload.submissionId} AND shop_id = ${shop.id}`;
      await enqueue("order.reconcile", `reconcile:${payload.submissionId}`, { submissionId: payload.submissionId }, { shopId: shop.id, maxAttempts: 10 });
      return { ok: true, status: "processing", retryAfterMs: 4000 };
    }
    return { ok: false, status: "error", message: m.submitError };
  }
}

export async function afterOrderCreated(shop: ShopRow, sub: SubmissionRow, formId: string | null, hasPostPurchase: boolean, ctx?: RequestContext) {
  await bumpStat(shop.id, formId, "orders", Number(sub.total_minor ?? 0));
  await sql()`UPDATE abandoned SET status = 'converted' WHERE shop_id = ${shop.id} AND id = ${sub.id}`;
  // Avec un upsell 1-Click, on attend la décision du client (max 3 min) avant Sheets/Meta pour transmettre le montant final.
  await enqueueAfterOrder(shop, sub, hasPostPurchase ? 3 * 60_000 : 0);
  if (!hasPostPurchase && ctx?.defer) {
    ctx.defer(processDueJobs({ budgetMs: 8000 }).catch((e) => log("warn", "jobs.inline_failed", { error: errMsg(e) })));
  }
}

/** Travail de réconciliation d'une soumission au résultat incertain. */
export async function reconcileSubmission(shopId: string, submissionId: string): Promise<string> {
  const [sub] = await sql()<SubmissionRow[]>`SELECT * FROM submissions WHERE id = ${submissionId} AND shop_id = ${shopId}`;
  if (!sub) return "introuvable";
  if (sub.status === "created") return "déjà créée";
  if (sub.status !== "uncertain") return `ignorée (${sub.status})`;
  const [shop] = await sql()<ShopRow[]>`SELECT * FROM shops WHERE id = ${shopId}`;
  if (!shop) return "boutique introuvable";
  const settings = shopSettings(shop);
  const client = await shopClient(shop);
  let order = await findExistingOrder(client, submissionId);
  if (!order) {
    if (!sub.quote) throw new Error("Soumission sans devis");
    const form = sub.form_id ? await getForm(shopId, sub.form_id) : null;
    const tags = [...settings.orders.tags];
    if (sub.client?.flagged) tags.push(settings.fraud.flagTag);
    if (sub.verified_phone) tags.push(settings.otp.verifiedTag);
    order = await createShopifyOrder(client, {
      submissionId,
      quote: sub.quote,
      customer: sub.customer,
      currency: sub.currency ?? shop.currency,
      settings,
      tags,
      formName: form?.name ?? "KB COD",
    });
  }
  const [updated] = await sql()<SubmissionRow[]>`UPDATE submissions SET status = 'created', shopify_order_gid = ${order.id},
    shopify_order_name = ${order.name}, order_status_url = ${order.statusPageUrl}, error = NULL, updated_at = now()
    WHERE id = ${submissionId} AND shop_id = ${shopId} AND status = 'uncertain' RETURNING *`;
  if (updated) await afterOrderCreated(shop, updated, sub.form_id, false);
  return `commande ${order.name}`;
}

// ---------- Upsell 1-Click après commande ----------

const ORDER_EDIT_BEGIN = `#graphql
  mutation KbEditBegin($id: ID!) { orderEditBegin(id: $id) { calculatedOrder { id } userErrors { field message } } }`;
const ORDER_EDIT_ADD = `#graphql
  mutation KbEditAdd($id: ID!, $variantId: ID!, $quantity: Int!) {
    orderEditAddVariant(id: $id, variantId: $variantId, quantity: $quantity, allowDuplicates: true) {
      calculatedLineItem { id } userErrors { field message }
    }
  }`;
const ORDER_EDIT_DISCOUNT = `#graphql
  mutation KbEditDiscount($id: ID!, $lineItemId: ID!, $discount: OrderEditAppliedDiscountInput!) {
    orderEditAddLineItemDiscount(id: $id, lineItemId: $lineItemId, discount: $discount) { userErrors { field message } }
  }`;
const ORDER_EDIT_COMMIT = `#graphql
  mutation KbEditCommit($id: ID!) {
    orderEditCommit(id: $id, notifyCustomer: false, staffNote: "Upsell 1-Click KB COD") {
      order { id totalPriceSet { shopMoney { amount } } } userErrors { field message }
    }
  }`;

export const ORDER_EDIT_MUTATIONS = [ORDER_EDIT_BEGIN, ORDER_EDIT_ADD, ORDER_EDIT_DISCOUNT, ORDER_EDIT_COMMIT];

function assertNoErrors(r: { userErrors: { message: string }[] }, step: string) {
  if (r.userErrors.length) throw new Error(`${step} : ${r.userErrors.map((e) => e.message).join(", ")}`);
}

export async function acceptPostPurchase(shop: ShopRow, submissionId: string, offerId: string): Promise<{ added: boolean; total: number }> {
  const sub = await getSubmission(shop.id, submissionId);
  if (!sub || sub.status !== "created" || !sub.shopify_order_gid || !sub.quote) throw new Error("Commande introuvable");
  if (sub.client?.postPurchase) return { added: sub.client.postPurchase === "accepted", total: Number(sub.total_minor ?? 0) };
  const offers = await activeOffers(shop.id);
  const offer = offers.find((o) => o.id === offerId && o.type === "post_purchase");
  if (!offer) throw new Error("Offre indisponible");
  const cfg = offer.config as PostPurchase;
  const client = await shopClient(shop);
  const catalog = await loadVariants(client, [cfg.variantId]);
  const variant = catalog.get(cfg.variantId);
  if (!variant || !variant.available) throw new Error("Produit indisponible");
  // Marque la décision avant l'édition pour qu'un double clic ne l'applique pas deux fois.
  const claimed = await sql()`UPDATE submissions SET client = client || '{"postPurchase":"accepted"}'::jsonb, updated_at = now()
    WHERE id = ${submissionId} AND shop_id = ${shop.id} AND NOT (client ? 'postPurchase') RETURNING id`;
  if (!claimed.length) return { added: false, total: Number(sub.total_minor ?? 0) };

  const begin = await client.request<{ orderEditBegin: { calculatedOrder: { id: string } | null; userErrors: { message: string }[] } }>(ORDER_EDIT_BEGIN, { id: sub.shopify_order_gid });
  assertNoErrors(begin.orderEditBegin, "Début de modification");
  const calcId = begin.orderEditBegin.calculatedOrder!.id;
  const add = await client.request<{ orderEditAddVariant: { calculatedLineItem: { id: string } | null; userErrors: { message: string }[] } }>(ORDER_EDIT_ADD, {
    id: calcId,
    variantId: gid("ProductVariant", cfg.variantId),
    quantity: 1,
  });
  assertNoErrors(add.orderEditAddVariant, "Ajout du produit");
  let discount = 0;
  if (cfg.discountType !== "none" && cfg.value > 0) {
    discount = cfg.discountType === "percentage" ? Math.round((variant.price * Math.min(cfg.value, 100)) / 100) : Math.min(variant.price, Math.round(cfg.value * 100));
    const d = await client.request<{ orderEditAddLineItemDiscount: { userErrors: { message: string }[] } }>(ORDER_EDIT_DISCOUNT, {
      id: calcId,
      lineItemId: add.orderEditAddVariant.calculatedLineItem!.id,
      discount:
        cfg.discountType === "percentage"
          ? { percentValue: cfg.value, description: offer.name }
          : { fixedValue: { amount: fromMinor(discount), currencyCode: shop.currency }, description: offer.name },
    });
    assertNoErrors(d.orderEditAddLineItemDiscount, "Remise");
  }
  const commit = await client.request<{ orderEditCommit: { order: { totalPriceSet: { shopMoney: { amount: string } } } | null; userErrors: { message: string }[] } }>(
    ORDER_EDIT_COMMIT,
    { id: calcId },
  );
  assertNoErrors(commit.orderEditCommit, "Validation");
  const newTotal = Math.round(Number.parseFloat(commit.orderEditCommit.order!.totalPriceSet.shopMoney.amount) * 100);
  const quote = sub.quote;
  quote.lines.push({ variantId: variant.variantId, productId: variant.productId, title: variant.productTitle, variantTitle: variant.title, quantity: 1, unitPrice: variant.price, kind: "upsell", sku: variant.sku ?? null });
  quote.subtotal += variant.price;
  if (discount) {
    quote.discounts.push({ label: offer.name, amount: discount, source: `post_purchase:${offer.id}` });
    quote.discountTotal += discount;
  }
  quote.total = newTotal;
  await sql()`UPDATE submissions SET quote = ${sql().json(quote as any)}, total_minor = ${newTotal}, updated_at = now() WHERE id = ${submissionId} AND shop_id = ${shop.id}`;
  await bumpStat(shop.id, sub.form_id, "post_purchase_accepted", newTotal - Number(sub.total_minor ?? 0));
  await releaseDeferredJobs(shop.id, submissionId);
  return { added: true, total: newTotal };
}

export async function declinePostPurchase(shop: ShopRow, submissionId: string): Promise<void> {
  await sql()`UPDATE submissions SET client = client || '{"postPurchase":"declined"}'::jsonb, updated_at = now()
    WHERE id = ${submissionId} AND shop_id = ${shop.id} AND NOT (client ? 'postPurchase')`;
  await releaseDeferredJobs(shop.id, submissionId);
}

/** Avance l'exécution des travaux retardés en attendant la décision d'upsell. */
async function releaseDeferredJobs(shopId: string, submissionId: string) {
  await sql()`UPDATE jobs SET run_at = now() WHERE shop_id = ${shopId} AND status = 'pending'
    AND dedupe_key IN (${`sheets:${submissionId}`}, ${`meta:${submissionId}:submit`}, ${`notify:${submissionId}:confirmation`})`;
}

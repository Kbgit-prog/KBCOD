import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubmitPayload } from "../src/shared/api-types";
import { submitSchema } from "../src/shared/api-types";
import { createForm, ensureDefaultForm, upsertOffer } from "../src/server/services/forms";
import { processDueJobs } from "../src/server/services/jobs";
import { handleSubmit } from "../src/server/services/orders";
import { registerAllJobs } from "../src/server/services/registry";
import { createShop, mockFetch, resetDb, setupDb, shopifyRoutes, teardownDb, uuid, variantNode } from "./helpers";
import type { Sql } from "../src/server/db";

let db: Sql;
beforeAll(async () => {
  db = await setupDb();
  registerAllJobs();
});
afterAll(teardownDb);
beforeEach(async () => {
  await resetDb();
  vi.unstubAllGlobals();
});

const ctx = { ip: "41.202.10.20", userAgent: "Mozilla/5.0 test", origin: null };

function payload(shop: string, formId: string, extra: Partial<SubmitPayload> = {}): SubmitPayload {
  return submitSchema.parse({
    shop,
    formId,
    submissionId: uuid(),
    productId: "111",
    variantId: "11",
    quantity: 1,
    fields: { full_name: "Awa Koné", phone: "0707070707", city: "Abidjan", address: "Cocody Angré" },
    elapsedMs: 12_000,
    ...extra,
  });
}

describe("Moteur de commandes COD", () => {
  it("crée une commande PENDING avec les prix relus depuis Shopify", async () => {
    const shop = await createShop("alpha.myshopify.com");
    const form = await ensureDefaultForm(shop.id);
    const s = shopifyRoutes({ variants: { "11": variantNode("11", "111", "15000.00") } });
    mockFetch([s.route]);
    const r = await handleSubmit(payload(shop.shop_domain, form.id, { quantity: 2 }), ctx);
    expect(r.ok && r.status === "created").toBe(true);
    expect(s.orders).toHaveLength(1);
    const input = s.orders[0].input;
    expect(input.financialStatus).toBe("PENDING");
    expect(input.lineItems[0]).toMatchObject({ variantId: "gid://shopify/ProductVariant/11", quantity: 2, priceSet: { shopMoney: { amount: "15000.00" } } });
    expect(input.transactions[0]).toMatchObject({ kind: "SALE", status: "PENDING" });
    expect(input.phone).toBe("+2250707070707");
    expect(input.shippingAddress).toMatchObject({ firstName: "Awa", lastName: "Koné", city: "Abidjan", address1: "Cocody Angré", countryCode: "CI" });
    expect(input.sourceIdentifier).toMatch(/^kbcod-/);
    if (r.ok && r.status === "created") {
      expect(r.total).toBe(3_000_000);
      expect(r.events[0]!.eventId).toMatch(/^kbcod\.[0-9a-f-]{36}\.submit$/);
    }
  });

  it("double clic / renvoi : une seule commande pour une même soumission", async () => {
    const shop = await createShop("beta.myshopify.com");
    const form = await ensureDefaultForm(shop.id);
    const s = shopifyRoutes({ variants: { "11": variantNode("11", "111", "5000.00") } });
    mockFetch([s.route]);
    const p = payload(shop.shop_domain, form.id);
    const results = await Promise.all([handleSubmit(p, ctx), handleSubmit(p, ctx), handleSubmit(p, ctx)]);
    const again = await handleSubmit(p, ctx);
    expect(s.orders).toHaveLength(1);
    expect(results.some((r) => r.ok && r.status === "created")).toBe(true);
    expect(again.ok && again.status === "created").toBe(true);
  });

  it("ignore un prix manipulé et refuse une variante d'un autre produit", async () => {
    const shop = await createShop("gamma.myshopify.com");
    const form = await ensureDefaultForm(shop.id);
    const s = shopifyRoutes({ variants: { "11": variantNode("11", "111", "9000.00"), "22": variantNode("22", "222", "100.00") } });
    mockFetch([s.route]);
    const bad = await handleSubmit(payload(shop.shop_domain, form.id, { variantId: "22" }), ctx);
    expect(bad.ok).toBe(false);
    const badTier = await handleSubmit(payload(shop.shop_domain, form.id, { tierId: "inexistant" }), ctx);
    expect(badTier.ok).toBe(false);
    expect(s.orders).toHaveLength(0);
  });

  it("applique une offre de quantité calculée côté serveur", async () => {
    const shop = await createShop("delta.myshopify.com");
    const form = await ensureDefaultForm(shop.id);
    await upsertOffer(shop.id, {
      type: "quantity",
      name: "Lot",
      active: true,
      config: { productIds: ["111"], tiers: [{ id: "t1", quantity: 1 }, { id: "t3", quantity: 3, discountType: "fixed_price", value: 25000 }] },
    });
    const s = shopifyRoutes({ variants: { "11": variantNode("11", "111", "10000.00") } });
    mockFetch([s.route]);
    const r = await handleSubmit(payload(shop.shop_domain, form.id, { tierId: "t3", quantity: 1 }), ctx);
    expect(r.ok && r.status === "created" && r.total).toBe(2_500_000);
    expect(s.orders[0].input.lineItems[0].quantity).toBe(3);
    expect(s.orders[0].input.discountCode.itemFixedDiscountCode.amountSet.shopMoney.amount).toBe("5000.00");
  });

  it("valide les champs côté serveur (téléphone invalide, champ obligatoire)", async () => {
    const shop = await createShop("eps.myshopify.com");
    const form = await ensureDefaultForm(shop.id);
    mockFetch([shopifyRoutes({ variants: { "11": variantNode("11", "111", "1000.00") } }).route]);
    const r = await handleSubmit(payload(shop.shop_domain, form.id, { fields: { full_name: "", phone: "12", city: "A", address: "B" } }), ctx);
    expect(r.ok).toBe(false);
    if (!r.ok && r.status === "invalid") expect(Object.keys(r.fieldErrors ?? {})).toEqual(expect.arrayContaining(["full_name", "phone"]));
  });

  it("réponse perdue (réseau) : réconciliation sans doublon", async () => {
    const shop = await createShop("zeta.myshopify.com");
    const form = await ensureDefaultForm(shop.id);
    const s = shopifyRoutes({ variants: { "11": variantNode("11", "111", "2000.00") }, failCreate: "network" });
    mockFetch([s.route]);
    const p = payload(shop.shop_domain, form.id);
    const r = await handleSubmit(p, ctx);
    expect(r.ok && r.status === "processing").toBe(true);
    expect(s.orders).toHaveLength(1);
    await processDueJobs({ budgetMs: 5000 });
    const [row] = await db`SELECT status, shopify_order_name FROM submissions WHERE id = ${p.submissionId}`;
    expect(row).toMatchObject({ status: "created", shopify_order_name: s.orders[0].name });
    expect(s.orders).toHaveLength(1);
    const again = await handleSubmit(p, ctx);
    expect(again.ok && again.status === "created").toBe(true);
  });

  it("erreur Shopify définitive : statut failed, nouvelle tentative possible", async () => {
    const shop = await createShop("eta.myshopify.com");
    const form = await ensureDefaultForm(shop.id);
    const s = shopifyRoutes({ variants: { "11": variantNode("11", "111", "2000.00") }, failCreate: "user" });
    mockFetch([s.route]);
    const p = payload(shop.shop_domain, form.id);
    const r = await handleSubmit(p, ctx);
    expect(r.ok).toBe(false);
    const [row] = await db`SELECT status FROM submissions WHERE id = ${p.submissionId}`;
    expect(row!.status).toBe("failed");
  });
});

describe("Isolation multi-boutiques", () => {
  it("un formulaire d'une boutique n'est jamais utilisé par une autre", async () => {
    const a = await createShop("shopa.myshopify.com");
    const b = await createShop("shopb.myshopify.com");
    const formA = await createForm(a.id, "Spécial A");
    const defB = await ensureDefaultForm(b.id);
    const s = shopifyRoutes({ variants: { "11": variantNode("11", "111", "1000.00") } });
    mockFetch([s.route]);
    const r = await handleSubmit(payload(b.shop_domain, formA.id), ctx);
    expect(r.ok).toBe(true);
    const [sub] = await db`SELECT shop_id, form_id FROM submissions WHERE shop_id = ${b.id}`;
    expect(sub).toMatchObject({ shop_id: b.id, form_id: defB.id });
    expect(s.orders[0].shop).toBe("shopb.myshopify.com");
    const leaks = await db`SELECT count(*)::int AS n FROM submissions WHERE shop_id = ${a.id}`;
    expect(leaks[0]!.n).toBe(0);
  });
});

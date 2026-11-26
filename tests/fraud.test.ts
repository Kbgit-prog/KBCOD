import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { submitSchema } from "../src/shared/api-types";
import { pseudo } from "../src/server/lib/crypto";
import { ensureDefaultForm } from "../src/server/services/forms";
import { buildIdentity, countInWindow, evaluateFraud, normalizePhone } from "../src/server/services/fraud";
import { handleSubmit } from "../src/server/services/orders";
import { fraudSettingsSchema } from "../src/server/services/settings";
import type { Sql } from "../src/server/db";
import { createShop, mockFetch, resetDb, setupDb, shopifyRoutes, teardownDb, uuid, variantNode } from "./helpers";

let db: Sql;
beforeAll(async () => {
  db = await setupDb();
});
afterAll(teardownDb);
beforeEach(async () => {
  await resetDb();
  vi.unstubAllGlobals();
});

const H = 3_600_000;
const msgs = { blocked: "bloqué", limitReached: "limite" };

async function addSubmission(shopId: string, phone: string, ip: string, at: Date, status = "created") {
  await db`INSERT INTO submissions (id, shop_id, status, phone_hash, ip_hash, created_at)
    VALUES (${uuid()}, ${shopId}, ${status}, ${pseudo("phone", phone)}, ${pseudo("ip", ip)}, ${at})`;
}

describe("Normalisation", () => {
  it("normalise les numéros ivoiriens à 10 chiffres", () => {
    expect(normalizePhone("07 07 07 07 07", "CI")?.e164).toBe("+2250707070707");
    expect(normalizePhone("+225 0707070707", "CI")?.e164).toBe("+2250707070707");
    expect(normalizePhone("00225 07 07 07 07 07", "CI")?.e164).toBe("+2250707070707");
    expect(normalizePhone("123", "CI")).toBeNull();
  });
});

describe("Fenêtre glissante", () => {
  it("compte sur les 72 dernières heures exactes, pas par jour calendaire", async () => {
    const shop = await createShop("fw.myshopify.com");
    const now = new Date("2026-06-10T12:00:00Z");
    const id = buildIdentity({ phone: "0707070707", ip: "1.2.3.4", deviceId: null, email: null, country: "CI" });
    await addSubmission(shop.id, "+2250707070707", "1.2.3.4", new Date(now.getTime() - 71.9 * H));
    await addSubmission(shop.id, "+2250707070707", "1.2.3.4", new Date(now.getTime() - 72.1 * H));
    await addSubmission(shop.id, "+2250707070707", "1.2.3.4", new Date(now.getTime() - 1 * H), "blocked");
    const rule = { identifier: "phone" as const, windowHours: 72 };
    expect(await countInWindow(shop.id, rule, id, now)).toBe(1);
    // Deux heures plus tard, la commande de -71,9 h sort de la fenêtre.
    expect(await countInWindow(shop.id, rule, id, new Date(now.getTime() + 2 * H))).toBe(0);
  });

  it("bloque au-delà de 2 commandes / 72 h par téléphone", async () => {
    const shop = await createShop("fw2.myshopify.com");
    const now = new Date();
    await addSubmission(shop.id, "+2250707070707", "5.5.5.5", new Date(now.getTime() - 10 * H));
    await addSubmission(shop.id, "+2250707070707", "6.6.6.6", new Date(now.getTime() - 50 * H));
    const settings = fraudSettingsSchema.parse({});
    const identity = buildIdentity({ phone: "0707070707", ip: "9.9.9.9", deviceId: null, email: null, country: "CI" });
    const d = await evaluateFraud(settings, { shopId: shop.id, submissionId: uuid(), identity, callingCode: "225", honeypot: "", elapsedMs: 10_000, quantity: 1 }, msgs);
    expect(d.action).toBe("limit");
    const other = buildIdentity({ phone: "0505050505", ip: "9.9.9.9", deviceId: null, email: null, country: "CI" });
    const d2 = await evaluateFraud(settings, { shopId: shop.id, submissionId: uuid(), identity: other, callingCode: "225", honeypot: "", elapsedMs: 10_000, quantity: 1 }, msgs);
    expect(d2.action).toBe("allow");
  });

  it("IP partagée : signale sans bloquer (pas de faux positif)", async () => {
    const shop = await createShop("ip.myshopify.com");
    for (let i = 0; i < 6; i++) await addSubmission(shop.id, `+22507000000${i}0`, "41.0.0.1", new Date(Date.now() - H));
    const settings = fraudSettingsSchema.parse({});
    const identity = buildIdentity({ phone: "0101010101", ip: "41.0.0.1", deviceId: null, email: null, country: "CI" });
    const d = await evaluateFraud(settings, { shopId: shop.id, submissionId: uuid(), identity, callingCode: "225", honeypot: "", elapsedMs: 10_000, quantity: 1 }, msgs);
    expect(d.action).toBe("flag");
  });

  it("les limites d'une boutique n'affectent pas une autre", async () => {
    const a = await createShop("iso-a.myshopify.com");
    const b = await createShop("iso-b.myshopify.com");
    for (let i = 0; i < 3; i++) await addSubmission(a.id, "+2250707070707", "1.1.1.1", new Date(Date.now() - H));
    const identity = buildIdentity({ phone: "0707070707", ip: "2.2.2.2", deviceId: null, email: null, country: "CI" });
    const d = await evaluateFraud(fraudSettingsSchema.parse({}), { shopId: b.id, submissionId: uuid(), identity, callingCode: "225", honeypot: "", elapsedMs: 10_000, quantity: 1 }, msgs);
    expect(d.action).toBe("allow");
  });
});

describe("Robots et listes", () => {
  it("champ piège et envoi trop rapide", async () => {
    const shop = await createShop("bot.myshopify.com");
    const identity = buildIdentity({ phone: "0707070707", ip: "3.3.3.3", deviceId: null, email: null, country: "CI" });
    const s = fraudSettingsSchema.parse({});
    const base = { shopId: shop.id, submissionId: uuid(), identity, callingCode: "225", quantity: 1 };
    expect((await evaluateFraud(s, { ...base, honeypot: "spam", elapsedMs: 10_000 }, msgs)).action).toBe("block");
    expect((await evaluateFraud(s, { ...base, honeypot: "", elapsedMs: 300 }, msgs)).action).toBe("block");
  });

  it("liste blanche prioritaire sur les limites, liste noire bloquante", async () => {
    const shop = await createShop("list.myshopify.com");
    for (let i = 0; i < 5; i++) await addSubmission(shop.id, "+2250707070707", "1.1.1.1", new Date(Date.now() - H));
    await db`INSERT INTO list_entries (shop_id, list, kind, value_hash, display) VALUES (${shop.id}, 'allow', 'phone', ${pseudo("phone", "+2250707070707")}, 'x')`;
    await db`INSERT INTO list_entries (shop_id, list, kind, value_pattern, display) VALUES (${shop.id}, 'block', 'phone_prefix', '+22501', '+22501')`;
    const s = fraudSettingsSchema.parse({});
    const allowed = buildIdentity({ phone: "0707070707", ip: "1.1.1.1", deviceId: null, email: null, country: "CI" });
    expect((await evaluateFraud(s, { shopId: shop.id, submissionId: uuid(), identity: allowed, callingCode: "225", honeypot: "", elapsedMs: 9000, quantity: 1 }, msgs)).action).toBe("allow");
    const blocked = buildIdentity({ phone: "0102030405", ip: "8.8.8.8", deviceId: null, email: null, country: "CI" });
    expect((await evaluateFraud(s, { shopId: shop.id, submissionId: uuid(), identity: blocked, callingCode: "225", honeypot: "", elapsedMs: 9000, quantity: 1 }, msgs)).action).toBe("block");
  });
});

describe("Antifraude de bout en bout", () => {
  it("3e commande du même numéro en 72 h refusée, aucune commande Shopify créée", async () => {
    const shop = await createShop("e2e.myshopify.com");
    const form = await ensureDefaultForm(shop.id);
    const s = shopifyRoutes({ variants: { "11": variantNode("11", "111", "1000.00") } });
    mockFetch([s.route]);
    const mk = () =>
      submitSchema.parse({
        shop: shop.shop_domain,
        formId: form.id,
        submissionId: uuid(),
        productId: "111",
        variantId: "11",
        quantity: 1,
        fields: { full_name: "Test", phone: "0707070707", city: "Abidjan", address: "Plateau" },
        elapsedMs: 9000,
      });
    const ctx = { ip: "41.1.1.1", userAgent: "ua", origin: null };
    expect((await handleSubmit(mk(), ctx)).ok).toBe(true);
    expect((await handleSubmit(mk(), ctx)).ok).toBe(true);
    const third = await handleSubmit(mk(), ctx);
    expect(third.ok).toBe(false);
    expect(!third.ok && third.status).toBe("limited");
    expect(s.orders).toHaveLength(2);
  });
});

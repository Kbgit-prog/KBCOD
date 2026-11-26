import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { submitSchema } from "../src/shared/api-types";
import { createHmac } from "node:crypto";
import { encrypt } from "../src/server/lib/crypto";
import { ensureDefaultForm } from "../src/server/services/forms";
import { processDueJobs } from "../src/server/services/jobs";
import { buildUserData, normName, normPhone } from "../src/server/services/meta";
import { handleSubmit } from "../src/server/services/orders";
import { registerAllJobs } from "../src/server/services/registry";
import { buildRows, columnLetter, defaultMapping, parseSpreadsheetId } from "../src/server/services/sheets";
import { handleWebhook } from "../src/server/services/webhooks";
import { verifySessionToken } from "../src/server/shopify/session-token";
import { verifyWebhookHmac } from "../src/server/shopify/webhook";
import type { Sql } from "../src/server/db";
import { APP_A, APP_B, createShop, json, mockFetch, resetDb, setupDb, shopifyRoutes, teardownDb, uuid, variantNode, type Route } from "./helpers";

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

const ctx = { ip: "41.202.1.1", userAgent: "Mozilla/5.0", origin: null };

async function orderFor(shopDomain: string, shopId: string, routes: Route[]) {
  const form = await ensureDefaultForm(shopId);
  const s = shopifyRoutes({ variants: { "11": variantNode("11", "111", "12000.00") } });
  const mf = mockFetch([s.route, ...routes]);
  const p = submitSchema.parse({
    shop: shopDomain,
    formId: form.id,
    submissionId: uuid(),
    productId: "111",
    variantId: "11",
    quantity: 1,
    fields: { full_name: "Jean Kouassi", phone: "0707070707", city: "Bouaké", address: "Quartier Commerce" },
    tracking: { fbp: "fb.1.1700000000.123", fbc: "fb.1.1700000000.abc", pageUrl: "https://alpha.com/products/x" },
    elapsedMs: 9000,
  });
  const r = await handleSubmit(p, ctx);
  return { p, r, s, mf };
}

function jwt(secret: string, claims: Record<string, unknown>) {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = enc({ alg: "HS256", typ: "JWT" });
  const b = enc(claims);
  return `${h}.${b}.${createHmac("sha256", secret).update(`${h}.${b}`).digest("base64url")}`;
}

describe("Jetons de session et webhooks", () => {
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: "https://alpha.myshopify.com/admin", dest: "https://alpha.myshopify.com", aud: APP_A.clientId, exp: now + 60, nbf: now - 5, iat: now, jti: "x" };
  it("accepte un jeton valide et identifie l'app", () => {
    const r = verifySessionToken(jwt(APP_A.clientSecret, claims));
    expect(r.shop).toBe("alpha.myshopify.com");
    expect(r.app.clientId).toBe(APP_A.clientId);
    expect(verifySessionToken(jwt(APP_B.clientSecret, { ...claims, aud: APP_B.clientId })).app.clientId).toBe(APP_B.clientId);
  });
  it("refuse signature, expiration et app inconnue", () => {
    expect(() => verifySessionToken(jwt("mauvais", claims))).toThrow();
    expect(() => verifySessionToken(jwt(APP_A.clientSecret, { ...claims, exp: now - 100 }))).toThrow();
    expect(() => verifySessionToken(jwt(APP_A.clientSecret, { ...claims, aud: "inconnue" }))).toThrow();
  });
  it("vérifie le HMAC des webhooks pour chaque app", () => {
    const body = Buffer.from('{"id":1}');
    expect(verifyWebhookHmac(body, createHmac("sha256", APP_B.clientSecret).update(body).digest("base64"))).toBe(APP_B.clientId);
    expect(verifyWebhookHmac(body, "faux")).toBeNull();
  });
});

describe("Google Sheets", () => {
  it("analyse les liens et lettres de colonnes", () => {
    expect(parseSpreadsheetId("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit#gid=0")).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz012345");
    expect(columnLetter(0)).toBe("A");
    expect(columnLetter(27)).toBe("AB");
  });

  it("synchronise après création, respecte le mapping et ne duplique pas", async () => {
    const shop = await createShop("sheets.myshopify.com");
    await db`INSERT INTO google_connections (shop_id, refresh_token_enc, access_token_enc, access_expires_at, spreadsheet_id, sheet_title, mapping, enabled)
      VALUES (${shop.id}, ${encrypt("rt")}, ${encrypt("at")}, ${new Date(Date.now() + 3600_000)}, 'sheet123', 'Commandes', ${db.json(defaultMapping())}, true)`;
    const appended: any[] = [];
    let fail = 1;
    const google: Route = (url, init) => {
      if (url.hostname !== "sheets.googleapis.com") return undefined;
      if (url.pathname.includes("/values/") && url.pathname.includes("1%3A1") || decodeURIComponent(url.pathname).includes("!1:1")) {
        return json({ values: [defaultMapping().map((m) => m.header)] });
      }
      if (url.pathname.endsWith(":append")) {
        if (fail-- > 0) return json({ error: { message: "Backend Error" } }, 503);
        appended.push(init.json.values);
        return json({ updates: { updatedRange: "Commandes!A2:J2" } });
      }
      // Lecture de la colonne « N° commande » (contrôle anti-doublon) : contient ce qui a déjà été écrit.
      if (url.pathname.includes("/values/")) return json({ values: appended.map((v) => [v[0][1]]) });
      return undefined;
    };
    const { p, r } = await orderFor(shop.shop_domain, shop.id, [google]);
    expect(r.ok).toBe(true);
    await processDueJobs({ budgetMs: 3000 });
    let [sync] = await db`SELECT status, attempts FROM sheet_syncs WHERE submission_id = ${p.submissionId}`;
    expect(sync!.status).toBe("retrying");
    // Nouvelle tentative (délai écoulé) : écrite une seule fois, commande enregistrée dans Shopify dans tous les cas.
    await db`UPDATE jobs SET run_at = now() WHERE dedupe_key = ${`sheets:${p.submissionId}`}`;
    await processDueJobs({ budgetMs: 3000 });
    [sync] = await db`SELECT status FROM sheet_syncs WHERE submission_id = ${p.submissionId}`;
    expect(sync!.status).toBe("synced");
    expect(appended).toHaveLength(1);
    const row = appended[0][0];
    expect(row[3]).toBe("+2250707070707");
    expect(row[5]).toBe("Bouaké");
    expect(row[8]).toBe(12000);
    await db`UPDATE jobs SET status = 'pending', run_at = now() WHERE dedupe_key = ${`sheets:${p.submissionId}`}`;
    await processDueJobs({ budgetMs: 3000 });
    expect(appended).toHaveLength(1);
  });

  it("colonne absente ou jeton révoqué : intervention requise, commande conservée", async () => {
    const shop = await createShop("sheets2.myshopify.com");
    await db`INSERT INTO google_connections (shop_id, refresh_token_enc, access_token_enc, access_expires_at, spreadsheet_id, sheet_title, mapping, enabled)
      VALUES (${shop.id}, ${encrypt("rt")}, ${encrypt("at")}, ${new Date(Date.now() - 1000)}, 'sheet123', 'Commandes', ${db.json(defaultMapping())}, true)`;
    const google: Route = (url) => {
      if (url.hostname === "oauth2.googleapis.com") return json({ error: "invalid_grant" }, 400);
      return undefined;
    };
    const { p, r } = await orderFor(shop.shop_domain, shop.id, [google]);
    expect(r.ok).toBe(true);
    await processDueJobs({ budgetMs: 3000 });
    const [sync] = await db`SELECT status, last_error FROM sheet_syncs WHERE submission_id = ${p.submissionId}`;
    expect(sync!.status).toBe("action_required");
    const [conn] = await db`SELECT status FROM google_connections WHERE shop_id = ${shop.id}`;
    expect(conn!.status).toBe("revoked");
    const [sub] = await db`SELECT status FROM submissions WHERE id = ${p.submissionId}`;
    expect(sub!.status).toBe("created");
  });

  it("mode une ligne par produit", () => {
    const sub: any = {
      created_at: new Date(),
      customer: { fullName: "A B", phone: "+225", countryCode: "CI" },
      fields: {},
      client: {},
      quote: { lines: [{ title: "P1", variantTitle: "", quantity: 2, unitPrice: 1000 }, { title: "P2", variantTitle: "", quantity: 1, unitPrice: 500 }], subtotal: 2500, discounts: [], discountTotal: 0, shipping: null, total: 2500 },
      total_minor: 2500,
      shopify_order_name: "#1",
      status: "created",
    };
    const rows = buildRows(sub, [{ header: "Produit", source: "product_title" }, { header: "Qté", source: "quantity" }, { header: "N°", source: "order_name" }], ["N°", "Produit", "Qté"], "product", { money_format: "{{amount}}", timezone: "UTC" });
    expect(rows).toEqual([["#1", "P1", 2], ["#1", "P2", 1]]);
  });
});

describe("Meta Conversions API", () => {
  it("normalise et hache selon les règles Meta", () => {
    expect(normPhone("+225 07 07 07 07 07")).toBe("2250707070707");
    expect(normName(" Jean-Kouassi ")).toBe("jeankouassi");
    const ud = buildUserData({ id: "x", phone_e164: "+2250707070707", customer: { email: " A@B.CO ", firstName: "Jean", countryCode: "CI" } as any, client: { ip: "1.1.1.1", ua: "ua", fbp: "fbp" } });
    expect((ud.em as string[])[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(ud.client_ip_address).toBe("1.1.1.1");
    expect(ud.fbp).toBe("fbp");
  });

  it("même event_id navigateur/serveur, stable entre tentatives, aucun doublon", async () => {
    const shop = await createShop("meta.myshopify.com");
    await db`INSERT INTO pixels (shop_id, provider, name, pixel_id, capi_token_enc) VALUES (${shop.id}, 'meta', 'Principal', '1234567890', ${encrypt("EAAB-token")})`;
    const sent: any[] = [];
    let fail = 1;
    const meta: Route = (url, init) => {
      if (url.hostname !== "graph.facebook.com") return undefined;
      if (fail-- > 0) return json({ error: { message: "Service temporarily unavailable", code: 2, is_transient: true } }, 500);
      sent.push(init.json);
      return json({ events_received: 1, fbtrace_id: "trace" });
    };
    const { p, r } = await orderFor(shop.shop_domain, shop.id, [meta]);
    expect(r.ok && r.status === "created").toBe(true);
    const browserEventId = r.ok && r.status === "created" ? r.events[0]!.eventId : "";
    await processDueJobs({ budgetMs: 3000 });
    await db`UPDATE jobs SET run_at = now() WHERE dedupe_key = ${`meta:${p.submissionId}:submit`}`;
    await processDueJobs({ budgetMs: 3000 });
    expect(sent).toHaveLength(1);
    const ev = sent[0].data[0];
    expect(ev.event_id).toBe(browserEventId);
    expect(ev.event_name).toBe("Purchase");
    expect(ev.custom_data).toMatchObject({ currency: "XOF", value: 12000, payment_status: "pending", cod_stage: "submit" });
    expect(ev.user_data.ph[0]).toMatch(/^[a-f0-9]{64}$/);
    const [te] = await db`SELECT status, attempts FROM tracking_events WHERE event_id = ${browserEventId}`;
    expect(te).toMatchObject({ status: "sent", attempts: 2 });
    // Étapes COD suivantes via webhooks : confirmée, payée (livrée) — jamais un second « Purchase ».
    const [sub] = await db`SELECT shopify_order_gid FROM submissions WHERE id = ${p.submissionId}`;
    await handleWebhook("orders/updated", shop.shop_domain, { admin_graphql_api_id: sub!.shopify_order_gid, tags: "KBCOD, confirmed" });
    await handleWebhook("orders/updated", shop.shop_domain, { admin_graphql_api_id: sub!.shopify_order_gid, tags: "KBCOD, confirmed" });
    await handleWebhook("orders/paid", shop.shop_domain, { admin_graphql_api_id: sub!.shopify_order_gid });
    await processDueJobs({ budgetMs: 3000 });
    const names = sent.map((s) => s.data[0].event_name);
    expect(names[0]).toBe("Purchase");
    expect([...names].sort()).toEqual(["CODOrderConfirmed", "CODOrderDelivered", "Purchase"]);
    const paid = sent.find((s) => s.data[0].event_name === "CODOrderDelivered");
    expect(paid.data[0].custom_data.payment_status).toBe("paid");
    expect(paid.data[0].event_id).toBe(`kbcod.${p.submissionId}.paid`);
  });

  it("jeton invalide : échec définitif journalisé", async () => {
    const shop = await createShop("meta2.myshopify.com");
    await db`INSERT INTO pixels (shop_id, provider, name, pixel_id, capi_token_enc) VALUES (${shop.id}, 'meta', 'P', '999', ${encrypt("bad")})`;
    const meta: Route = (url) => (url.hostname === "graph.facebook.com" ? json({ error: { message: "Invalid OAuth access token", code: 190 } }, 400) : undefined);
    const { p } = await orderFor(shop.shop_domain, shop.id, [meta]);
    await processDueJobs({ budgetMs: 3000 });
    const [te] = await db`SELECT status, last_error FROM tracking_events WHERE submission_id = ${p.submissionId}`;
    expect(te!.status).toBe("failed");
    expect(String(te!.last_error)).toContain("190");
    const [job] = await db`SELECT status FROM jobs WHERE dedupe_key = ${`meta:${p.submissionId}:submit`}`;
    expect(job!.status).toBe("dead");
  });
});

describe("Confidentialité", () => {
  it("customers/redact efface les données personnelles des soumissions", async () => {
    const shop = await createShop("gdpr.myshopify.com");
    const { p } = await orderFor(shop.shop_domain, shop.id, []);
    await handleWebhook("customers/redact", shop.shop_domain, { customer: { phone: "+2250707070707" }, orders_to_redact: [] });
    const [s] = await db`SELECT customer, phone_e164 FROM submissions WHERE id = ${p.submissionId}`;
    expect(s!.phone_e164).toBeNull();
    expect(s!.customer).toEqual({});
  });
  it("shop/redact supprime toutes les données de la boutique", async () => {
    const shop = await createShop("gdpr2.myshopify.com");
    await orderFor(shop.shop_domain, shop.id, []);
    await handleWebhook("shop/redact", shop.shop_domain, {});
    const rows = await db`SELECT count(*)::int AS n FROM submissions WHERE shop_id = ${shop.id}`;
    expect(rows[0]!.n).toBe(0);
  });
});

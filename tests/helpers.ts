import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import { setSqlForTests, type Sql } from "../src/server/db";
import { loadEnv, setEnvForTests } from "../src/server/env";
import { encrypt } from "../src/server/lib/crypto";
import { migrate } from "../scripts/migrate";

export const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://kbtest:kbtest@localhost:5432/kbcod_test";

export const APP_A = { clientId: "client_aaaaaaaaaaaa", clientSecret: "secret_aaaaaaaaaaaaaaaa" };
export const APP_B = { clientId: "client_bbbbbbbbbbbb", clientSecret: "secret_bbbbbbbbbbbbbbbb" };

export function testEnv() {
  const e = loadEnv({
    APP_URL: "https://kbcod.test",
    DATABASE_URL: TEST_DB,
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    HASH_SALT: "sel-de-test-0123456789",
    CRON_SECRET: "cron-secret-0123456789",
    SHOPIFY_API_KEY: APP_A.clientId,
    SHOPIFY_API_SECRET: APP_A.clientSecret,
    SHOPIFY_EXTRA_APPS: JSON.stringify([{ ...APP_B, name: "B" }]),
    GOOGLE_CLIENT_ID: "google-client",
    GOOGLE_CLIENT_SECRET: "google-secret",
  });
  setEnvForTests(e);
  return e;
}

let client: Sql | null = null;
export async function setupDb(): Promise<Sql> {
  testEnv();
  await migrate(TEST_DB, () => undefined);
  client = postgres(TEST_DB, { max: 4, prepare: false, connection: { search_path: "kbcod" }, onnotice: () => undefined }) as unknown as Sql;
  setSqlForTests(client);
  return client;
}

export async function resetDb(): Promise<void> {
  await client!`TRUNCATE shops, jobs, webhook_receipts, audit_log CASCADE`;
}

export async function teardownDb(): Promise<void> {
  await client?.end();
  setSqlForTests(null);
}

export async function createShop(domain: string, app = APP_A, settings: Record<string, unknown> = {}) {
  const [row] = await client!`INSERT INTO shops (shop_domain, app_client_id, access_token_enc, scopes, name, currency, money_format,
      app_installation_gid, settings, timezone)
    VALUES (${domain}, ${app.clientId}, ${encrypt(`shpat_${domain}`)}, 'write_orders', ${domain.split(".")[0]!}, 'XOF',
      '{{amount_no_decimals_with_space_separator}} FCFA', ${`gid://shopify/AppInstallation/${Math.floor(Math.random() * 1e6)}`},
      ${client!.json(settings as any)}, 'Africa/Abidjan')
    RETURNING *`;
  return row as any;
}

export type Route = (url: URL, init: RequestInit & { json?: any }) => Response | Promise<Response> | undefined;

/** Remplace fetch par un routeur de réponses simulées (API Shopify, Google, Meta). */
export function mockFetch(routes: Route[]) {
  const calls: { url: string; body: any; headers: Record<string, string> }[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    let body: any = init.body;
    try {
      body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    } catch {
      body = init.body;
    }
    calls.push({ url: url.href, body, headers: Object.fromEntries(Object.entries((init.headers as Record<string, string>) ?? {})) });
    for (const r of routes) {
      const res = await r(url, { ...init, json: body });
      if (res) return res;
    }
    return new Response(JSON.stringify({ error: `route non simulée ${url.href}` }), { status: 599 });
  });
  vi.stubGlobal("fetch", fn);
  return { calls, fn };
}

export const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export function variantNode(id: string, productId: string, price: string, available = true) {
  return {
    id: `gid://shopify/ProductVariant/${id}`,
    title: "Default Title",
    sku: `SKU-${id}`,
    price,
    compareAtPrice: null,
    availableForSale: available,
    image: null,
    product: { id: `gid://shopify/Product/${productId}`, title: `Produit ${productId}`, featuredImage: null },
  };
}

/** Simule l'Admin API d'une boutique : variantes, orderCreate, recherche par source_identifier, métachamps. */
export function shopifyRoutes(opts: { variants: Record<string, ReturnType<typeof variantNode>>; orders?: any[]; failCreate?: "network" | "user" | null }) {
  const orders = opts.orders ?? [];
  let n = 1000;
  const route: Route = (url, init) => {
    if (!url.hostname.endsWith(".myshopify.com") || !url.pathname.endsWith("/graphql.json")) return undefined;
    const q: string = init.json?.query ?? "";
    const vars = init.json?.variables ?? {};
    if (q.includes("KbVariants")) return json({ data: { nodes: vars.ids.map((id: string) => opts.variants[id.split("/").pop()!] ?? null) } });
    if (q.includes("KbOrderCreate")) {
      if (opts.failCreate === "network") {
        // La commande est créée côté Shopify mais la réponse est perdue.
        orders.push({ id: `gid://shopify/Order/${++n}`, name: `#${n}`, statusPageUrl: null, input: vars.order, shop: url.hostname });
        opts.failCreate = null;
        throw new TypeError("fetch failed");
      }
      if (opts.failCreate === "user") return json({ data: { orderCreate: { order: null, userErrors: [{ field: ["lineItems"], message: "Invalid", code: "INVALID" }] } } });
      const o = { id: `gid://shopify/Order/${++n}`, name: `#${n}`, statusPageUrl: `https://${url.hostname}/s/${n}`, displayFinancialStatus: "PENDING", totalPriceSet: { shopMoney: { amount: "0", currencyCode: "XOF" } } };
      orders.push({ ...o, input: vars.order, options: vars.options, shop: url.hostname });
      return json({ data: { orderCreate: { order: o, userErrors: [] } } });
    }
    if (q.includes("KbOrderBySource")) {
      const sid = /"(kbcod-[^"]+)"/.exec(vars.q)?.[1];
      const found = orders.find((o) => o.input?.sourceIdentifier === sid && o.shop === url.hostname);
      return json({ data: { orders: { nodes: found ? [{ id: found.id, name: found.name, statusPageUrl: found.statusPageUrl }] : [] } } });
    }
    if (q.includes("KbPublish")) return json({ data: { metafieldsSet: { metafields: [{ id: "1" }], userErrors: [] } } });
    return undefined;
  };
  return { route, orders };
}

export const uuid = () => randomUUID();

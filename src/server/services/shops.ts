import { sql } from "../db";
import { decryptOpt, encrypt, encryptOpt } from "../lib/crypto";
import { log } from "../lib/log";
import { adminClient, type AdminClient } from "../shopify/graphql";
import { findApp } from "../shopify/session-token";
import { shopSettingsSchema, type ShopSettings } from "./settings";

export interface ShopRow {
  id: string;
  shop_domain: string;
  app_client_id: string;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: Date | null;
  scopes: string;
  name: string | null;
  email: string | null;
  currency: string;
  money_format: string;
  primary_domain: string | null;
  timezone: string | null;
  app_installation_gid: string | null;
  settings: unknown;
  installed_at: Date;
  uninstalled_at: Date | null;
}

export async function getShopByDomain(domain: string): Promise<ShopRow | null> {
  const [row] = await sql()<ShopRow[]>`SELECT * FROM shops WHERE shop_domain = ${domain}`;
  return row ?? null;
}

export async function getShopById(id: string): Promise<ShopRow | null> {
  const [row] = await sql()<ShopRow[]>`SELECT * FROM shops WHERE id = ${id}`;
  return row ?? null;
}

export function shopSettings(shop: ShopRow): ShopSettings {
  const r = shopSettingsSchema.safeParse(shop.settings ?? {});
  return r.success ? r.data : shopSettingsSchema.parse({});
}

interface TokenResponse {
  access_token: string;
  scope: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
}

/** Échange de jeton (installation gérée par Shopify) : jeton de session → jeton d'accès hors ligne. */
export async function exchangeToken(shop: string, clientId: string, sessionToken: string): Promise<TokenResponse> {
  const app = findApp(clientId);
  if (!app) throw new Error("Application inconnue");
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: sessionToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
      requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Échange de jeton refusé (${res.status})`);
  return (await res.json()) as TokenResponse;
}

async function refreshAccessToken(shop: ShopRow): Promise<string> {
  const app = findApp(shop.app_client_id);
  const refresh = decryptOpt(shop.refresh_token_enc);
  if (!app || !refresh) throw new Error("Jeton expiré sans jeton de rafraîchissement : rouvrez l'application dans Shopify");
  const res = await fetch(`https://${shop.shop_domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: app.clientId, client_secret: app.clientSecret, grant_type: "refresh_token", refresh_token: refresh }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Rafraîchissement du jeton Shopify refusé (${res.status})`);
  const t = (await res.json()) as TokenResponse;
  await saveToken(shop.shop_domain, shop.app_client_id, t);
  return t.access_token;
}

export async function saveToken(domain: string, clientId: string, t: TokenResponse): Promise<ShopRow> {
  const expires = t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null;
  const [row] = await sql()<ShopRow[]>`
    INSERT INTO shops (shop_domain, app_client_id, access_token_enc, refresh_token_enc, token_expires_at, scopes)
    VALUES (${domain}, ${clientId}, ${encrypt(t.access_token)}, ${encryptOpt(t.refresh_token)}, ${expires}, ${t.scope ?? ""})
    ON CONFLICT (shop_domain) DO UPDATE SET
      app_client_id = EXCLUDED.app_client_id,
      access_token_enc = EXCLUDED.access_token_enc,
      refresh_token_enc = coalesce(EXCLUDED.refresh_token_enc, shops.refresh_token_enc),
      token_expires_at = EXCLUDED.token_expires_at,
      scopes = EXCLUDED.scopes,
      uninstalled_at = NULL,
      updated_at = now()
    RETURNING *`;
  return row!;
}

export async function accessToken(shop: ShopRow): Promise<string> {
  if (!shop.access_token_enc || shop.uninstalled_at) throw new Error("Application non installée sur cette boutique");
  if (shop.token_expires_at && shop.token_expires_at.getTime() - Date.now() < 5 * 60_000) {
    return refreshAccessToken(shop);
  }
  return decryptOpt(shop.access_token_enc)!;
}

export async function shopClient(shop: ShopRow): Promise<AdminClient> {
  return adminClient(shop.shop_domain, await accessToken(shop));
}

/** Récupère les informations de la boutique après installation/réouverture. */
export async function syncShopInfo(shop: ShopRow): Promise<ShopRow> {
  const client = await shopClient(shop);
  const data = await client.request<{
    shop: {
      name: string;
      email: string;
      currencyCode: string;
      currencyFormats: { moneyFormat: string };
      primaryDomain: { host: string };
      ianaTimezone: string;
    };
    currentAppInstallation: { id: string };
  }>(`#graphql
    query KbShopInfo {
      shop { name email currencyCode currencyFormats { moneyFormat } primaryDomain { host } ianaTimezone }
      currentAppInstallation { id }
    }`);
  const s = data.shop;
  const [row] = await sql()<ShopRow[]>`
    UPDATE shops SET name = ${s.name}, email = ${s.email}, currency = ${s.currencyCode},
      money_format = ${s.currencyFormats.moneyFormat}, primary_domain = ${s.primaryDomain.host},
      timezone = ${s.ianaTimezone}, app_installation_gid = ${data.currentAppInstallation.id}, updated_at = now()
    WHERE id = ${shop.id} RETURNING *`;
  log("info", "shop.synced", { shop: shop.shop_domain });
  return row!;
}

export async function markUninstalled(domain: string): Promise<void> {
  await sql()`UPDATE shops SET uninstalled_at = now(), access_token_enc = NULL, refresh_token_enc = NULL, updated_at = now()
    WHERE shop_domain = ${domain}`;
}

export async function updateShopSettings(shopId: string, settings: ShopSettings): Promise<void> {
  await sql()`UPDATE shops SET settings = ${sql().json(settings as any)}, updated_at = now() WHERE id = ${shopId}`;
}

export async function audit(shopId: string | null, action: string, detail?: Record<string, unknown>): Promise<void> {
  await sql()`INSERT INTO audit_log (shop_id, action, detail) VALUES (${shopId}, ${action}, ${detail ? sql().json(detail as any) : null})`;
}

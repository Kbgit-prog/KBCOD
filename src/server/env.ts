import { z } from "zod";

const appSchema = z.object({
  clientId: z.string().min(10),
  clientSecret: z.string().min(10),
  name: z.string().default("KB COD Manager"),
});
export type ShopifyAppCredentials = z.infer<typeof appSchema>;

const envSchema = z.object({
  NODE_ENV: z.string().default("production"),
  APP_URL: z.string().url(),
  DATABASE_URL: z.string().min(10),
  /** Clé AES-256 (32 octets en base64) pour chiffrer tokens et secrets. */
  ENCRYPTION_KEY: z.string().min(40),
  /** Sel HMAC pour pseudonymiser téléphone/IP/e-mail dans les règles antifraude. */
  HASH_SALT: z.string().min(16),
  /** Secret partagé pour l'appel du traitement de file (cron). */
  CRON_SECRET: z.string().min(16),
  SHOPIFY_API_VERSION: z.string().default("2026-10"),
  SHOPIFY_SCOPES: z.string().default(""),
  /** Application principale. */
  SHOPIFY_API_KEY: z.string().min(10),
  SHOPIFY_API_SECRET: z.string().min(10),
  /** Applications supplémentaires (distribution personnalisée : une app par boutique), JSON. */
  SHOPIFY_EXTRA_APPS: z.string().default("[]"),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  META_GRAPH_VERSION: z.string().default("v24.0"),
  TURNSTILE_SECRET: z.string().default(""),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});
export type Env = z.infer<typeof envSchema> & { apps: ShopifyAppCredentials[] };

let cached: Env | null = null;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.parse(source);
  const extra = z.array(appSchema).parse(JSON.parse(parsed.SHOPIFY_EXTRA_APPS));
  const apps = [{ clientId: parsed.SHOPIFY_API_KEY, clientSecret: parsed.SHOPIFY_API_SECRET, name: "KB COD Manager" }, ...extra];
  return { ...parsed, APP_URL: parsed.APP_URL.replace(/\/$/, ""), apps };
}

export function env(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}

export function setEnvForTests(e: Env | null): void {
  cached = e;
}

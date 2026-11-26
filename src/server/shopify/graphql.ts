import { env } from "../env";
import { log } from "../lib/log";

export class ShopifyApiError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "throttled" | "network" | "graphql" | "user" | "server",
    readonly retryable: boolean,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface AdminClient {
  shop: string;
  request<T = any>(query: string, variables?: Record<string, unknown>, opts?: { timeoutMs?: number }): Promise<T>;
}

export function adminClient(shop: string, accessToken: string): AdminClient {
  const url = `https://${shop}/admin/api/${env().SHOPIFY_API_VERSION}/graphql.json`;
  return {
    shop,
    async request(query, variables, opts) {
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
          body: JSON.stringify({ query, variables }),
          signal: AbortSignal.timeout(opts?.timeoutMs ?? 20_000),
        });
      } catch (e) {
        throw new ShopifyApiError(`Réseau Shopify indisponible : ${(e as Error).message}`, "network", true);
      }
      if (res.status === 401 || res.status === 403) {
        throw new ShopifyApiError(`Accès Shopify refusé (${res.status})`, "auth", false);
      }
      if (res.status === 429) throw new ShopifyApiError("Limite de débit Shopify atteinte", "throttled", true);
      if (res.status >= 500) throw new ShopifyApiError(`Erreur serveur Shopify ${res.status}`, "server", true);
      const json = (await res.json()) as { data?: any; errors?: any[]; extensions?: any };
      if (json.errors?.length) {
        const throttled = json.errors.some((e) => e?.extensions?.code === "THROTTLED");
        log("warn", "shopify.graphql.errors", { shop, codes: json.errors.map((e) => e?.extensions?.code) });
        throw new ShopifyApiError(
          json.errors.map((e) => e.message).join("; "),
          throttled ? "throttled" : "graphql",
          throttled,
          json.errors,
        );
      }
      return json.data;
    },
  };
}

export function gid(type: string, id: string | number): string {
  return `gid://shopify/${type}/${id}`;
}

export function idFromGid(g: string): string {
  return g.split("/").pop() ?? g;
}

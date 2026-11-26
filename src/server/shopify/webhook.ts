import { env } from "../env";
import { hmacSha256, safeEqual } from "../lib/crypto";

/** Vérifie la signature HMAC d'un webhook Shopify en essayant chaque app configurée. */
export function verifyWebhookHmac(rawBody: Buffer, hmacHeader: string | null | undefined): string | null {
  if (!hmacHeader) return null;
  for (const app of env().apps) {
    if (safeEqual(hmacSha256(app.clientSecret, rawBody), hmacHeader)) return app.clientId;
  }
  return null;
}

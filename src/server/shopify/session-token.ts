import { hmacSha256, safeEqual } from "../lib/crypto";
import { env, type ShopifyAppCredentials } from "../env";

export interface SessionTokenClaims {
  iss: string;
  dest: string;
  aud: string;
  sub?: string;
  exp: number;
  nbf: number;
  iat: number;
  jti: string;
  sid?: string;
}

export class AuthError extends Error {
  constructor(message: string, readonly status = 401) {
    super(message);
  }
}

function b64urlJson<T>(part: string): T {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as T;
}

export function findApp(clientId: string): ShopifyAppCredentials | undefined {
  return env().apps.find((a) => a.clientId === clientId);
}

/** Vérifie un jeton de session App Bridge (JWT HS256 signé avec le secret de l'app). */
export function verifySessionToken(token: string, nowSec = Math.floor(Date.now() / 1000)) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthError("Jeton de session mal formé");
  const [h, p, s] = parts as [string, string, string];
  const header = b64urlJson<{ alg: string; typ?: string }>(h);
  if (header.alg !== "HS256") throw new AuthError("Algorithme de jeton non supporté");
  const claims = b64urlJson<SessionTokenClaims>(p);
  const app = findApp(claims.aud);
  if (!app) throw new AuthError("Application inconnue");
  const expected = hmacSha256(app.clientSecret, `${h}.${p}`).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  if (!safeEqual(expected, s)) throw new AuthError("Signature du jeton invalide");
  const skew = 10;
  if (claims.exp + skew < nowSec) throw new AuthError("Jeton expiré");
  if (claims.nbf - skew > nowSec) throw new AuthError("Jeton pas encore valide");
  const dest = new URL(claims.dest);
  const shop = dest.hostname;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) throw new AuthError("Boutique invalide");
  if (!claims.iss.startsWith(`https://${shop}`)) throw new AuthError("Émetteur incohérent");
  return { claims, shop, app };
}

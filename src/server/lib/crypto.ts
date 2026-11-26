import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { env } from "../env";

function key(): Buffer {
  const k = Buffer.from(env().ENCRYPTION_KEY, "base64");
  if (k.length !== 32) throw new Error("ENCRYPTION_KEY doit faire 32 octets encodés en base64");
  return k;
}

/** Chiffrement AES-256-GCM. Format : v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decrypt(payload: string): string {
  const [v, iv, tag, ct] = payload.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Format chiffré invalide");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

export function encryptOpt(v: string | null | undefined): string | null {
  return v ? encrypt(v) : null;
}
export function decryptOpt(v: string | null | undefined): string | null {
  return v ? decrypt(v) : null;
}

/** Empreinte pseudonyme (HMAC-SHA256 salé) d'un identifiant antifraude. */
export function pseudo(kind: string, value: string): string {
  return createHmac("sha256", env().HASH_SALT).update(`${kind}:${value}`).digest("base64url");
}

export function sha256Hex(v: string): string {
  return createHash("sha256").update(v, "utf8").digest("hex");
}

export function hmacSha256(secret: string, data: string | Buffer, enc: "base64" | "hex" = "base64"): string {
  return createHmac("sha256", secret).update(data).digest(enc);
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Jeton signé court (state OAuth, liens internes). */
export function signToken(data: Record<string, unknown>, ttlSeconds: number): string {
  const body = Buffer.from(JSON.stringify({ ...data, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString("base64url");
  return `${body}.${hmacSha256(env().ENCRYPTION_KEY, body, "base64").replace(/=+$/, "")}`;
}

export function verifyToken<T extends Record<string, unknown>>(token: string): T | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = hmacSha256(env().ENCRYPTION_KEY, body, "base64").replace(/=+$/, "");
  if (!safeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp: number };
    if (typeof data.exp !== "number" || data.exp < Date.now() / 1000) return null;
    return data;
  } catch {
    return null;
  }
}

import type { Context } from "hono";
import type { ShopRow } from "../services/shops";

export type AppEnv = {
  Variables: {
    shop: ShopRow;
    defer: (p: Promise<unknown>) => void;
  };
};

/** IP client : en-têtes posés par la plateforme d'hébergement (Vercel : x-real-ip, non falsifiable). */
export function clientIp(c: Context): string | null {
  const real = c.req.header("x-real-ip");
  if (real) return real.trim();
  const fwd = c.req.header("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  const cf = c.req.header("cf-connecting-ip");
  return cf?.trim() ?? null;
}

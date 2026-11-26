import { Hono } from "hono";
import { env } from "./env";
import { safeEqual, verifyToken } from "./lib/crypto";
import { errMsg, log } from "./lib/log";
import { admin } from "./routes/admin";
import { storefront } from "./routes/storefront";
import type { AppEnv } from "./routes/util";
import { processDueJobs } from "./services/jobs";
import { maintenance, registerAllJobs } from "./services/registry";
import { handleGoogleCallback } from "./services/sheets";
import { firstReceipt, handleWebhook } from "./services/webhooks";
import { verifyWebhookHmac } from "./shopify/webhook";

registerAllJobs();

export function createApp(opts: { defer?: (p: Promise<unknown>) => void } = {}) {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    const pending: Promise<unknown>[] = [];
    c.set("defer", (p) => {
      const safe = p.catch((e) => log("warn", "defer.failed", { error: errMsg(e) }));
      if (opts.defer) opts.defer(safe);
      else pending.push(safe);
    });
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    if (!opts.defer && pending.length) await Promise.all(pending);
  });

  app.get("/health", (c) => c.json({ ok: true, service: "kb-cod-manager", time: new Date().toISOString() }));

  app.route("/api/admin", admin);
  app.route("/sf", storefront);

  app.post("/webhooks", async (c) => {
    const raw = Buffer.from(await c.req.arrayBuffer());
    const appId = verifyWebhookHmac(raw, c.req.header("x-shopify-hmac-sha256"));
    if (!appId) return c.text("Signature invalide", 401);
    const topic = c.req.header("x-shopify-topic") ?? "";
    const shop = c.req.header("x-shopify-shop-domain") ?? "";
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) return c.text("Boutique invalide", 400);
    if (!(await firstReceipt(c.req.header("x-shopify-webhook-id") ?? null, shop, topic))) return c.text("Déjà traité", 200);
    try {
      await handleWebhook(topic, shop, JSON.parse(raw.toString("utf8") || "{}"));
    } catch (e) {
      log("error", "webhook.failed", { topic, shop, error: errMsg(e) });
      return c.text("Erreur", 500);
    }
    c.get("defer")(processDueJobs({ budgetMs: 8000 }));
    return c.text("ok", 200);
  });

  app.get("/google/callback", async (c) => {
    const state = verifyToken<{ s: string }>(c.req.query("state") ?? "");
    const page = (title: string, msg: string) =>
      c.html(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><body style="font-family:system-ui;padding:32px;text-align:center"><h2>${title}</h2><p>${msg}</p>
<script>try{window.opener&&window.opener.postMessage({type:"kbcod-google",ok:${title === "Compte Google connecté"}},"*")}catch(e){}setTimeout(function(){window.close()},1500)</script></body></html>`);
    if (!state) return page("Lien expiré", "Recommencez la connexion depuis l'application.");
    if (c.req.query("error")) return page("Connexion annulée", "Aucune autorisation n'a été accordée.");
    try {
      const email = await handleGoogleCallback(state.s, c.req.query("code") ?? "");
      return page("Compte Google connecté", `${email ? email.replace(/[<>&"]/g, "") + " — " : ""}vous pouvez fermer cette fenêtre.`);
    } catch (e) {
      return page("Échec de la connexion", errMsg(e).replace(/[<>&"]/g, ""));
    }
  });

  const cron = async (c: any) => {
    const auth = c.req.header("authorization") ?? "";
    if (!safeEqual(auth, `Bearer ${env().CRON_SECRET}`)) return c.text("Non autorisé", 401);
    const stats = await processDueJobs({ budgetMs: 40_000 });
    let maint: Record<string, number> | null = null;
    if (c.req.query("maintenance") === "1") maint = await maintenance();
    return c.json({ ok: true, ...stats, maintenance: maint });
  };
  app.post("/cron/jobs", cron);
  app.get("/cron/jobs", cron);

  app.onError((e, c) => {
    log("error", "unhandled", { path: c.req.path, error: errMsg(e) });
    return c.json({ error: "Erreur interne" }, 500);
  });
  return app;
}

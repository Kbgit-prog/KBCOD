/**
 * Test de bout en bout du script de vitrine (navigateur Chromium réel, API simulée).
 * Usage : npm run build:storefront && npm run test:e2e
 * Vérifie : popup, offre de quantité, livraison, validation, renvoi idempotent (même submissionId),
 * pixels Meta avec event_id identiques au format serveur, masquage du bouton « Acheter maintenant ».
 */
import { createRequire } from "node:module";
// Playwright préinstallé (global) ; installez-le avec `npm i -D playwright` sur une autre machine.
const { chromium } = createRequire(import.meta.url)("playwright");
import { mkdirSync } from "node:fs";
import path from "node:path";
import { defaultFormConfig } from "../../src/shared/defaults";
const SP = path.join(process.cwd(), ".cache/e2e");
mkdirSync(SP, { recursive: true });
const form = { id: "00000000-0000-4000-8000-000000000001", config: defaultFormConfig() };
const BUNDLE = path.join(process.cwd(), "extensions/kbcod-theme/assets/kbcod.js");
const boot: any = {
  shop: "demo-kb.myshopify.com", backend: "https://backend.test",
  config: { v: 1, backend: "https://backend.test", shop: "demo-kb.myshopify.com", currency: "XOF", moneyFormat: "{{amount_no_decimals_with_space_separator}} FCFA",
    defaultFormId: form.id, forms: { [form.id]: form.config }, productForms: {},
    offers: [{ id: "11111111-1111-4111-8111-111111111111", type: "quantity", name: "Lot", config: { productIds: [], tiers: [
      { id: "t1", quantity: 1, title: "1 article", subtitle: "", badge: "", discountType: "none", value: 0, preselected: true, imageUrl: "", freeShipping: false },
      { id: "t2", quantity: 2, title: "2 articles", subtitle: "Économisez 10 %", badge: "Populaire", discountType: "percentage", value: 10, preselected: false, imageUrl: "", freeShipping: true }],
      style: "list", accentColor: "#16a34a", hideQuantitySelector: true } }],
    shippingRates: [{ id: "s1", name: "Livraison Abidjan", description: "24 h", price: 150000, countries: [], minSubtotal: null, maxSubtotal: null, freeAbove: null, enabled: true }],
    hasDiscountCodes: false, fraud: { honeypot: true, turnstileSiteKey: "" }, abandoned: true,
    tracking: { pixels: [{ provider: "meta", id: "1234567890" }], submitEvent: "Purchase", submitIsCustom: false, initiateCheckout: true, pageView: false } },
  product: { id: "777", title: "Montre Élégance", image: null, selectedVariantId: "71", variants: [
    { id: "71", title: "Noir", price: 1500000, compareAtPrice: 2000000, available: true, image: null },
    { id: "72", title: "Or", price: 1800000, compareAtPrice: null, available: false, image: null }] },
};
const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name=viewport content="width=device-width,initial-scale=1"></head><body style="font-family:Georgia;margin:16px">
<h1>Montre Élégance</h1><form action="/cart/add"><input type=hidden name=id value=71><button type=submit name=add>Ajouter au panier</button></form>
<div class="shopify-payment-button">Acheter maintenant</div>
<script type="application/json" id="kbcod-boot">${JSON.stringify(boot)}</script><script src="/kbcod.js"></script></body></html>`;
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const errors: string[] = [], calls: { url: string; body: any }[] = [];
  page.on("pageerror", (e: Error) => errors.push(e.message));
  await page.route("https://shop.test/", (r: any) => r.fulfill({ contentType: "text/html", body: html }));
  await page.route("https://shop.test/kbcod.js", (r: any) => r.fulfill({ path: BUNDLE, contentType: "text/javascript" }));
  await page.route("https://connect.facebook.net/**", (r: any) => r.fulfill({ contentType: "text/javascript", body: "" }));
  let n = 0;
  await page.route("https://backend.test/**", async (r: any) => {
    const body = r.request().postDataJSON();
    calls.push({ url: r.request().url(), body });
    if (r.request().url().endsWith("/sf/submit")) {
      n++;
      if (n === 1) return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, status: "processing", retryAfterMs: 300 }) });
      return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, status: "created", orderName: "#1042", orderId: "1", orderStatusUrl: null, total: 3000000, currency: "XOF",
        events: [{ name: "Purchase", eventId: `kbcod.${body.submissionId}.submit`, value: 3000000, currency: "XOF", contentIds: ["777"], numItems: 2 }], postPurchase: null }) });
    }
    return r.fulfill({ contentType: "application/json", body: '{"ok":true}', headers: { "access-control-allow-origin": "*" } });
  });
  await page.goto("https://shop.test/");
  await page.waitForTimeout(500);
  // Code passé en texte : tsx injecte des aides (__name) absentes du navigateur.
  await page.evaluate("(() => { const orig = window.fbq; window.__fbq = []; window.fbq = Object.assign(function () { window.__fbq.push([].slice.call(arguments)); }, orig); })()");
  await page.screenshot({ path: `${SP}/sf-1-page.png` });
  const hidden = await page.evaluate("getComputedStyle(document.querySelector('.shopify-payment-button')).display");
  await page.click(".kbcod-auto .kb-root > button.kb-btn");
  await page.waitForTimeout(300);
  await page.click('.kbcod-auto label:has-text("2 articles")');
  await page.click(".kbcod-auto button[type=submit]");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SP}/sf-2-errors.png` });
  await page.fill(".kbcod-auto input[name=full_name]", "Awa Koné");
  await page.fill(".kbcod-auto input[name=phone]", "07 07 07 07 07");
  await page.fill(".kbcod-auto input[name=city]", "Abidjan");
  await page.fill(".kbcod-auto input[name=address]", "Cocody");
  await page.screenshot({ path: `${SP}/sf-3-filled.png` });
  await page.waitForTimeout(2600);
  await page.click(".kbcod-auto button[type=submit]");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SP}/sf-4-success.png` });
  const submits = calls.filter((c) => c.url.endsWith("/sf/submit"));
  const result = { errors, buyNowDisplay: hidden, submitCount: submits.length, sameId: submits.every((s) => s.body.submissionId === submits[0]!.body.submissionId),
    tier: submits[0]?.body.tierId, ship: submits[0]?.body.shippingRateId, fields: submits[0]?.body.fields, endpoints: [...new Set(calls.map((c) => c.url.split("/sf/")[1]))],
    fbq: (await page.evaluate("window.__fbq.map(function (a) { return [a[0], a[2], a[4] && a[4].eventID]; })")) as any[] };
  await browser.close();
  const sid = submits[0]?.body.submissionId as string;
  const checks: [string, boolean][] = [
    ["aucune erreur JS", errors.length === 0],
    ["bouton Acheter maintenant masqué", result.buyNowDisplay === "none"],
    ["renvoi après « processing » avec le même submissionId", result.submitCount === 2 && result.sameId],
    ["palier et livraison transmis", result.tier === "t2" && result.ship === "s1"],
    ["InitiateCheckout navigateur avec event_id kbcod.<id>.ic", result.fbq.some((f: any[]) => f[1] === "InitiateCheckout" && f[2] === `kbcod.${sid}.ic`)],
    ["Purchase navigateur avec l'event_id renvoyé par le serveur", result.fbq.some((f: any[]) => f[1] === "Purchase" && f[2] === `kbcod.${sid}.submit`)],
  ];
  for (const [name, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (checks.some((c) => !c[1])) { console.log(JSON.stringify(result, null, 1)); process.exit(1); }
})();

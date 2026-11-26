/**
 * Script de vitrine KB COD Manager (chargé par l'extension de thème).
 * Lit la configuration publiée (métachamp de l'app), monte les formulaires Embedded/Popup,
 * envoie les commandes au serveur et déclenche les pixels avec des event_id partagés.
 */
import type { SubmitPayload, SubmitResponse } from "../shared/api-types";
import type { FormConfig } from "../shared/form-schema";
import type { PublicOffer, ShippingRate } from "../shared/offers-schema";
import { KbForm, type ProductData } from "./renderer";

interface StorefrontConfig {
  v: number;
  backend: string;
  shop: string;
  currency: string;
  moneyFormat: string;
  defaultFormId: string | null;
  forms: Record<string, FormConfig>;
  productForms: Record<string, string>;
  offers: PublicOffer[];
  shippingRates: ShippingRate[];
  hasDiscountCodes: boolean;
  fraud: { honeypot: boolean; turnstileSiteKey: string };
  abandoned: boolean;
  tracking: { pixels: { provider: string; id: string }[]; submitEvent: string; submitIsCustom: boolean; initiateCheckout: boolean; pageView: boolean };
  remote?: boolean;
}

declare global {
  interface Window {
    KBCOD?: { mounted: boolean; forms: KbForm[]; open: () => void };
    fbq?: ((...args: unknown[]) => void) & { callMethod?: unknown; queue?: unknown[]; loaded?: boolean; version?: string; push?: unknown };
    _fbq?: unknown;
    ttq?: { instance?: (id: string) => { track: (...a: unknown[]) => void }; track?: (...a: unknown[]) => void };
    turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => string };
  }
}

function readJson<T>(id: string): T | null {
  const el = document.getElementById(id);
  if (!el?.textContent) return null;
  try {
    return JSON.parse(el.textContent) as T;
  } catch {
    return null;
  }
}

function cookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/[.$?*|{}()[\]\\/+^]/g, "\\$&")}=([^;]*)`));
  return m ? decodeURIComponent(m[1]!) : null;
}

function fbc(): string | null {
  const c = cookie("_fbc");
  if (c) return c;
  const id = new URLSearchParams(location.search).get("fbclid");
  return id ? `fb.1.${Date.now()}.${id}` : null;
}

function deviceId(): string | null {
  try {
    let d = localStorage.getItem("kbcod_did");
    if (!d) {
      d = crypto.randomUUID();
      localStorage.setItem("kbcod_did", d);
    }
    return d;
  } catch {
    return null;
  }
}

function ensureMetaPixel(ids: string[], pageView: boolean) {
  if (!ids.length) return;
  if (!window.fbq) {
    // Code de base standard du Meta Pixel (chargé uniquement si aucun pixel n'est déjà présent).
    const n: any = (window.fbq = function (...args: unknown[]) {
      n.callMethod ? n.callMethod(...args) : n.queue.push(args);
    } as any);
    if (!window._fbq) window._fbq = n;
    n.push = n;
    n.loaded = true;
    n.version = "2.0";
    n.queue = [];
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(s);
  }
  for (const id of ids) window.fbq!("init", id);
  if (pageView) for (const id of ids) window.fbq!("trackSingle", id, "PageView");
}

function main() {
  if (window.KBCOD?.mounted) return;
  const boot = readJson<{ product: ProductData | null; config: StorefrontConfig | null; shop: string; backend: string }>("kbcod-boot");
  if (!boot) return;
  const start = (cfg: StorefrontConfig) => mount(cfg, boot.product);
  if (boot.config && !boot.config.remote) start(boot.config);
  else {
    fetch(`${boot.backend}/sf/config?shop=${encodeURIComponent(boot.shop)}`)
      .then((r) => r.json())
      .then(start)
      .catch(() => undefined);
  }
}

function mount(cfg: StorefrontConfig, product: ProductData | null) {
  const metaIds = cfg.tracking.pixels.filter((p) => p.provider === "meta").map((p) => p.id);
  ensureMetaPixel(metaIds, cfg.tracking.pageView);
  window.KBCOD = { mounted: true, forms: [], open: () => window.KBCOD?.forms[0]?.open() };
  if (!product) return;

  const formId = cfg.productForms[product.id] ?? cfg.defaultFormId;
  if (!formId || !cfg.forms[formId]) return;
  const config = cfg.forms[formId]!;

  const post = async <T>(path: string, body: unknown): Promise<T> => {
    const r = await fetch(`${cfg.backend}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: path !== "/sf/submit" });
    return (await r.json()) as T;
  };

  const tracking = () => ({ fbp: cookie("_fbp"), fbc: fbc(), ttclid: new URLSearchParams(location.search).get("ttclid"), pageUrl: location.href.slice(0, 2000), referrer: document.referrer.slice(0, 2000) || null });

  const api = {
    shop: cfg.shop,
    submit: (p: SubmitPayload) => post<SubmitResponse>("/sf/submit", { ...p, tracking: tracking(), deviceId: deviceId() }),
    quote: (p: Record<string, unknown>) => post<any>("/sf/quote", p),
    partial: (p: Record<string, unknown>) => {
      if (cfg.abandoned) void post("/sf/partial", { ...p, shop: cfg.shop }).catch(() => undefined);
    },
    track: (event: "form_view" | "form_open" | "InitiateCheckout", data: Record<string, unknown> = {}) => {
      if (event === "InitiateCheckout" && !metaIds.length) return;
      void post("/sf/track", { shop: cfg.shop, event, formId, fbp: cookie("_fbp"), fbc: fbc(), pageUrl: location.href.slice(0, 2000), ...data }).catch(() => undefined);
    },
    postPurchase: (token: string, accept: boolean) => post<any>("/sf/post-purchase", { shop: cfg.shop, token, accept }),
  };

  const onEvent = (name: string, d: Record<string, unknown>) => {
    const custom = { value: Number(d.value ?? 0) / 100, currency: d.currency, content_ids: d.contentIds, content_type: "product", num_items: d.numItems };
    if (name === "InitiateCheckout" && cfg.tracking.initiateCheckout && window.fbq) {
      for (const id of metaIds) window.fbq("trackSingle", id, "InitiateCheckout", custom, { eventID: d.eventId });
    }
    if (name === "submit") {
      if (window.fbq) {
        for (const id of metaIds) {
          window.fbq(cfg.tracking.submitIsCustom ? "trackSingleCustom" : "trackSingle", id, d.name, { ...custom, payment_method: "cash_on_delivery", payment_status: "pending" }, { eventID: d.eventId });
        }
      }
      const tt = cfg.tracking.pixels.filter((p) => p.provider === "tiktok");
      for (const p of tt) window.ttq?.instance?.(p.id).track("PlaceAnOrder", { value: custom.value, currency: d.currency, content_type: "product" }, { event_id: d.eventId });
    }
  };

  const hosts: HTMLElement[] = [];
  const blocks = document.querySelectorAll<HTMLElement>(".kbcod-block");
  blocks.forEach((b) => hosts.push(b));
  if (!hosts.length) {
    // Intégration automatique (embed) : place le formulaire/bouton après le formulaire d'ajout au panier du thème.
    const productForm = document.querySelector<HTMLFormElement>('form[action*="/cart/add"]:not([id*="installment"])');
    const host = document.createElement("div");
    host.className = "kbcod-auto";
    host.style.margin = "12px 0";
    if (productForm?.parentElement) productForm.parentElement.insertBefore(host, productForm.nextSibling);
    else (document.querySelector("main") ?? document.body).appendChild(host);
    hosts.push(host);
  }

  const s = config.settings;
  const hide: string[] = [];
  if (s.hideAddToCart) hide.push('form[action*="/cart/add"] [type="submit"][name="add"]', 'form[action*="/cart/add"] button[name="add"]', "product-form .product-form__submit");
  if (s.hideBuyNow) hide.push(".shopify-payment-button", "shopify-accelerated-checkout", "shopify-buy-it-now-button");
  if (hide.length) {
    const st = document.createElement("style");
    st.textContent = `${hide.join(",")}{display:none!important}`;
    document.head.appendChild(st);
  }

  for (const host of hosts) {
    const form = new KbForm(host, {
      config,
      formId,
      product,
      offers: cfg.offers,
      shippingRates: cfg.shippingRates,
      hasDiscountCodes: cfg.hasDiscountCodes,
      moneyFormat: cfg.moneyFormat,
      currency: cfg.currency,
      mode: "live",
      api,
      onEvent,
      turnstileSiteKey: cfg.fraud.turnstileSiteKey,
    });
    window.KBCOD.forms.push(form);
    if (cfg.fraud.turnstileSiteKey) mountTurnstile(host, cfg.fraud.turnstileSiteKey, form);
  }

  if (s.triggerSelector) {
    document.addEventListener("click", (e) => {
      const t = (e.target as Element | null)?.closest?.(s.triggerSelector);
      if (t) {
        e.preventDefault();
        window.KBCOD?.forms[0]?.open();
      }
    });
  }

  // Suivi du changement de variante dans le thème.
  let lastVariant = product.selectedVariantId;
  const sync = () => {
    const fromUrl = new URLSearchParams(location.search).get("variant");
    const fromForm = document.querySelector<HTMLInputElement>('form[action*="/cart/add"] [name="id"]')?.value;
    const v = fromUrl || fromForm;
    if (v && v !== lastVariant) {
      lastVariant = v;
      window.KBCOD?.forms.forEach((f) => f.setVariant(v));
    }
  };
  document.addEventListener("change", (e) => {
    if ((e.target as Element | null)?.closest?.('form[action*="/cart/add"]')) setTimeout(sync, 50);
  });
  window.addEventListener("popstate", sync);
  setInterval(sync, 800);
}

function mountTurnstile(host: HTMLElement, siteKey: string, form: KbForm) {
  const slot = document.createElement("div");
  slot.slot = "captcha";
  slot.style.margin = "8px auto";
  host.appendChild(slot);
  const render = () => window.turnstile?.render(slot, { sitekey: siteKey, callback: (t: string) => form.setCaptchaToken(t), "expired-callback": () => form.setCaptchaToken(null) });
  if (window.turnstile) render();
  else {
    const sc = document.createElement("script");
    sc.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    sc.async = true;
    sc.onload = render;
    document.head.appendChild(sc);
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main);
else main();

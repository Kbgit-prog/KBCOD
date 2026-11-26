import type { SubmitPayload, SubmitResponse } from "../shared/api-types";
import type { FieldElement, FormConfig, FormElement } from "../shared/form-schema";
import type { DiscountCode, Downsell, PostPurchase, PublicOffer, QuantityOffer, ShippingRate, Upsell } from "../shared/offers-schema";
import { appliesToProduct } from "../shared/offer-utils";
import { computeQuote, findQuantityOffer, formatMoney, pct, toMinor, type CatalogVariant, type Quote } from "../shared/pricing";
import { formCss } from "./styles";

export interface ProductData {
  id: string;
  title: string;
  image: string | null;
  variants: { id: string; title: string; price: number; compareAtPrice: number | null; available: boolean; image: string | null }[];
  selectedVariantId: string;
}

export interface RenderOptions {
  config: FormConfig;
  formId: string;
  product: ProductData;
  offers: PublicOffer[];
  shippingRates: ShippingRate[];
  hasDiscountCodes: boolean;
  moneyFormat: string;
  currency: string;
  mode: "live" | "preview";
  /** Aperçu admin : popup ouverte dans le conteneur, pas en plein écran. */
  previewOpen?: boolean;
  turnstileSiteKey?: string;
  api?: {
    submit(p: SubmitPayload): Promise<SubmitResponse>;
    quote(p: Record<string, unknown>): Promise<{ ok: boolean; quote: Quote }>;
    partial(p: Record<string, unknown>): void;
    track(event: "form_view" | "form_open" | "InitiateCheckout", data?: Record<string, unknown>): void;
    postPurchase(token: string, accept: boolean): Promise<{ ok: boolean; added?: boolean; total?: number }>;
    shop: string;
  };
  onEvent?: (name: string, data: Record<string, unknown>) => void;
}

const ICONS: Record<string, string> = {
  user: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  pin: '<path d="M12 21s-7-6.1-7-11a7 7 0 1 1 14 0c0 4.9-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
  city: '<path d="M3 21h18M5 21V7l6-3v17M19 21V11l-8-3"/>',
  mail: '<path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/>',
  note: '<path d="M5 4h14v16H5zM8 9h8M8 13h8M8 17h5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
};
const FIELD_ICON: Partial<Record<FieldElement["input"], string>> = {
  first_name: "user",
  last_name: "user",
  full_name: "user",
  phone: "phone",
  phone_secondary: "phone",
  email: "mail",
  address: "pin",
  address2: "pin",
  city: "city",
  province: "city",
  zip: "pin",
  note: "note",
};

function svg(name: string, cls = "kb-icon"): SVGElement {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  el.setAttribute("viewBox", "0 0 24 24");
  el.setAttribute("fill", "none");
  el.setAttribute("stroke", "currentColor");
  el.setAttribute("stroke-width", "2");
  el.setAttribute("stroke-linecap", "round");
  el.setAttribute("stroke-linejoin", "round");
  el.setAttribute("class", cls);
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = ICONS[name] ?? "";
  return el;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | null | undefined> = {}, ...children: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));
}

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames([navigator.language || "fr"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

type Values = Record<string, string | boolean | string[]>;

export class KbForm {
  private root: ShadowRoot;
  private o: RenderOptions;
  private values: Values = {};
  private errors: Record<string, string> = {};
  private variantId: string;
  private quantity = 1;
  private tierId: string | null = null;
  private upsellIds = new Set<string>();
  private downsellId: string | null = null;
  private shippingRateId: string | null = null;
  private discountCode: string | null = null;
  private discountMsg: { ok: boolean; text: string } | null = null;
  private serverQuote: Quote | null = null;
  private submissionId = uuid();
  private startedAt = Date.now();
  private state: "form" | "submitting" | "otp" | "success" | "post_purchase" = "form";
  private alert: string | null = null;
  private otp: { challengeId: string; phoneMasked: string; message: string } | null = null;
  private success: { orderName: string; statusUrl: string | null } | null = null;
  private postPurchase: { offer: PublicOffer<"post_purchase">; token: string } | null = null;
  private popupOpen = false;
  private downsellShown = false;
  private showDownsell = false;
  private icFired = false;
  private viewTracked = false;
  private timers: number[] = [];
  private quoteSeq = 0;
  private captchaToken: string | null = null;

  constructor(private host: HTMLElement, opts: RenderOptions) {
    this.o = opts;
    this.root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    this.variantId = opts.product.selectedVariantId || opts.product.variants[0]?.id || "";
    for (const el of opts.config.elements) {
      if (el.type === "field" && el.defaultValue) this.values[el.key] = el.input === "checkbox" ? el.defaultValue === "true" : el.defaultValue;
    }
    const q = this.quantityOffer();
    const pre = q?.tiers.find((t) => t.preselected) ?? null;
    if (pre) this.tierId = pre.id;
    for (const u of this.upsells()) if ((u.config as Upsell).preselected) this.upsellIds.add(u.id);
    if (opts.previewOpen) this.popupOpen = true;
    this.render();
  }

  update(opts: Partial<RenderOptions>): void {
    this.o = { ...this.o, ...opts };
    if (opts.product) this.variantId = opts.product.selectedVariantId || this.variantId;
    this.render();
  }

  setVariant(id: string): void {
    if (this.o.product.variants.some((v) => v.id === id)) {
      this.variantId = id;
      this.render();
    }
  }

  open(): void {
    this.popupOpen = true;
    this.fireInitiateCheckout();
    this.o.api?.track("form_open", {});
    this.render();
  }

  destroy(): void {
    this.timers.forEach((t) => clearInterval(t));
    this.root.replaceChildren();
  }

  // ---------- Données ----------

  private quantityOffer(): QuantityOffer | null {
    const o = findQuantityOffer(this.o.offers, this.o.product.id);
    return o ? (o.config as QuantityOffer) : null;
  }

  private upsells(): PublicOffer<"upsell">[] {
    return this.o.offers.filter((o): o is PublicOffer<"upsell"> => o.type === "upsell" && appliesToProduct((o.config as Upsell).triggerProductIds, this.o.product.id));
  }

  private downsell(): PublicOffer<"downsell"> | null {
    return (this.o.offers.find((o) => o.type === "downsell" && appliesToProduct((o.config as Downsell).triggerProductIds, this.o.product.id)) as PublicOffer<"downsell">) ?? null;
  }

  private variant() {
    return this.o.product.variants.find((v) => v.id === this.variantId) ?? this.o.product.variants[0];
  }

  private country(): string {
    const f = this.o.config.elements.find((e) => e.type === "field" && e.input === "country") as FieldElement | undefined;
    const v = f ? this.values[f.key] : undefined;
    return typeof v === "string" && v ? v : this.o.config.settings.defaultCountry;
  }

  /** Estimation locale (affichage). Le serveur recalcule tout à l'envoi. */
  private quote(): Quote {
    const catalog = new Map<string, CatalogVariant>();
    for (const v of this.o.product.variants) {
      catalog.set(v.id, { variantId: v.id, productId: this.o.product.id, productTitle: this.o.product.title, title: v.title, price: v.price, compareAtPrice: v.compareAtPrice, available: v.available, image: v.image });
    }
    const upsells = this.upsells().filter((u) => this.upsellIds.has(u.id));
    for (const u of upsells) {
      const c = u.config as Upsell;
      catalog.set(c.variantId, { variantId: c.variantId, productId: c.productId, productTitle: c.productTitle || c.title, title: "", price: c.displayPrice ?? 0, compareAtPrice: null, available: true, image: c.imageUrl || null });
    }
    const local = computeQuote(
      {
        productId: this.o.product.id,
        variantId: this.variantId,
        quantity: this.quantity,
        tierId: this.tierId,
        upsellIds: [...this.upsellIds],
        downsellId: this.downsellId,
        shippingRateId: this.shippingRateId,
        discountCode: null,
        country: this.country(),
      },
      { catalog, offers: this.o.offers, shippingRates: this.o.shippingRates, discountCodes: [] as DiscountCode[], allowOutOfStock: true },
    );
    return this.serverQuote && this.discountCode ? this.serverQuote : local;
  }

  private money(minor: number) {
    return formatMoney(minor, this.o.moneyFormat);
  }

  // ---------- Rendu ----------

  private render(): void {
    const { config } = this.o;
    const style = h("style", {}, formCss(config.design) + (config.customCss.enabled ? `\n/* CSS personnalisé */\n${config.customCss.css}` : ""));
    const wrap = h("div", { class: `kb-root kb-tpl-${config.design.template}${this.o.previewOpen ? " kb-preview-popup" : ""}`, dir: config.design.direction, part: "root" });
    const mode = config.settings.mode;
    if (mode === "embedded") {
      wrap.append(this.renderBody());
    } else {
      wrap.append(this.renderOpenButton());
      if (this.popupOpen) wrap.append(this.renderPopup());
    }
    if (config.settings.stickyButton.enabled && this.o.mode === "live" && !this.popupOpen) wrap.append(this.renderSticky());
    if (this.showDownsell) wrap.append(this.renderDownsell());
    if (this.state === "post_purchase" && this.postPurchase) wrap.append(this.renderPostPurchase());
    const captcha = h("slot", { name: "captcha" });
    wrap.append(captcha);
    this.root.replaceChildren(style, wrap);
    this.trackView();
  }

  private trackView() {
    if (this.viewTracked || this.o.mode !== "live") return;
    this.viewTracked = true;
    this.o.api?.track("form_view", {});
  }

  private renderOpenButton(): HTMLElement {
    const s = this.o.config.settings;
    const btn = h("button", { type: "button", class: `kb-btn kb-anim-${this.o.config.design.buttonAnimation}`, part: "open-button" }, h("span", {}, this.fill(s.openButtonText)), s.openButtonSubtext ? h("small", {}, this.fill(s.openButtonSubtext)) : null);
    const v = this.variant();
    if (v && !v.available && this.o.config.settings.outOfStock === "disable") {
      btn.setAttribute("disabled", "");
      btn.querySelector("span")!.textContent = this.o.config.messages.outOfStock;
    }
    btn.addEventListener("click", () => this.open());
    return btn;
  }

  private renderSticky(): HTMLElement {
    const st = this.o.config.settings.stickyButton;
    const bar = h("div", { class: `kb-sticky${st.position === "top" ? " kb-top" : ""}${st.mobileOnly ? " kb-mobile-only" : ""}`, part: "sticky" });
    const btn = h("button", { type: "button", class: `kb-btn kb-anim-${this.o.config.design.buttonAnimation}` }, this.fill(st.text));
    btn.addEventListener("click", () => {
      if (this.o.config.settings.mode === "popup") this.open();
      else this.host.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    bar.append(btn);
    if (this.o.config.settings.mode === "embedded" && typeof IntersectionObserver !== "undefined") {
      new IntersectionObserver((e) => (bar.style.display = e[0]?.isIntersecting ? "none" : "")).observe(this.host);
    }
    return bar;
  }

  private renderPopup(): HTMLElement {
    const overlay = h("div", { class: "kb-overlay", role: "dialog", "aria-modal": "true", part: "overlay" });
    const modal = h("div", { class: "kb-modal", part: "modal" });
    const close = h("button", { type: "button", class: "kb-close", "aria-label": "Fermer" }, "×");
    close.addEventListener("click", () => this.closePopup());
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) this.closePopup();
    });
    modal.append(close, this.renderBody());
    overlay.append(modal);
    return overlay;
  }

  private closePopup() {
    if (this.o.previewOpen) return;
    this.popupOpen = false;
    const ds = this.downsell();
    if (ds && this.o.config.settings.downsellOnClose && !this.downsellShown && this.state === "form" && !this.downsellId) {
      this.downsellShown = true;
      this.showDownsell = true;
    }
    if (this.state === "success") this.reset();
    this.render();
  }

  private renderDownsell(): HTMLElement {
    const ds = this.downsell()!;
    const c = ds.config as Downsell;
    const overlay = h("div", { class: "kb-overlay" });
    const box = h("div", { class: "kb-modal kb-downsell" }, h("h3", { class: "kb-heading" }, c.title), h("p", { class: "kb-text" }, c.text));
    const accept = h("button", { type: "button", class: "kb-btn" }, c.acceptText);
    const decline = h("button", { type: "button", class: "kb-btn kb-btn-sec" }, c.declineText);
    accept.addEventListener("click", () => {
      this.downsellId = ds.id;
      this.showDownsell = false;
      this.popupOpen = true;
      this.render();
    });
    decline.addEventListener("click", () => {
      this.showDownsell = false;
      this.render();
    });
    box.append(accept, decline);
    overlay.append(box);
    return overlay;
  }

  private renderPostPurchase(): HTMLElement {
    const { offer, token } = this.postPurchase!;
    const c = offer.config as PostPurchase;
    const overlay = h("div", { class: "kb-overlay" });
    const price = c.displayPrice ?? 0;
    const discounted = c.discountType === "percentage" ? price - pct(price, c.value) : c.discountType === "fixed" ? Math.max(0, price - toMinor(c.value)) : price;
    const box = h(
      "div",
      { class: "kb-modal kb-downsell" },
      h("h3", { class: "kb-heading" }, c.title),
      c.imageUrl ? h("img", { class: "kb-img", src: c.imageUrl, alt: c.productTitle, style: "max-width:180px" }) : null,
      h("p", { class: "kb-text" }, c.description || c.productTitle),
      price ? h("div", { class: "kb-price" }, this.money(discounted), discounted < price ? h("span", { class: "kb-compare" }, this.money(price)) : null) : null,
    );
    const accept = h("button", { type: "button", class: "kb-btn" }, c.acceptText);
    const decline = h("button", { type: "button", class: "kb-btn kb-btn-sec" }, c.declineText);
    const finish = () => {
      this.state = "success";
      this.postPurchase = null;
      this.afterSuccess();
    };
    accept.addEventListener("click", async () => {
      accept.setAttribute("disabled", "");
      accept.replaceChildren(h("span", { class: "kb-spinner" }));
      if (this.o.api) await this.o.api.postPurchase(token, true).catch(() => null);
      finish();
    });
    decline.addEventListener("click", async () => {
      if (this.o.api) this.o.api.postPurchase(token, false).catch(() => null);
      finish();
    });
    box.append(accept, decline);
    overlay.append(box);
    return overlay;
  }

  private renderBody(): HTMLElement {
    if (this.state === "success" && this.success) return this.renderSuccess();
    const form = h("form", { class: "kb-form", novalidate: true, part: "form" });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      void this.submit();
    });
    form.addEventListener("focusin", () => this.fireInitiateCheckout(), { once: true });
    if (this.state === "otp" && this.otp) {
      form.append(this.renderOtp());
      return form;
    }
    if (this.alert) form.append(h("div", { class: "kb-alert", role: "alert" }, this.alert));
    const quote = this.quote();
    for (const el of this.o.config.elements) {
      if (!this.visible(el)) continue;
      const node = this.renderElement(el, quote);
      if (node) {
        if (el.type === "field" && el.width === "half") node.classList.add("kb-half");
        node.dataset.kbId = el.id;
        form.append(node);
      }
    }
    const hp = h("div", { class: "kb-hp", "aria-hidden": "true" }, h("input", { type: "text", name: "company_website", tabindex: "-1", autocomplete: "off" }));
    form.append(hp);
    return form;
  }

  private visible(el: FormElement): boolean {
    if (!el.visible) return false;
    const c = el.condition;
    if (!c) return true;
    const raw = this.values[c.fieldKey];
    const v = (Array.isArray(raw) ? raw.join(", ") : typeof raw === "boolean" ? (raw ? "oui" : "non") : (raw ?? "")).toString().trim().toLowerCase();
    const t = c.value.trim().toLowerCase();
    switch (c.operator) {
      case "equals":
        return Array.isArray(raw) ? raw.some((x) => x.toLowerCase() === t) : v === t;
      case "not_equals":
        return v !== t;
      case "contains":
        return v.includes(t);
      case "filled":
        return v !== "" && v !== "non";
      case "empty":
        return v === "" || v === "non";
    }
  }

  private fill(text: string): string {
    const q = this.quote();
    return text.replace(/\{total\}/g, this.money(q.total)).replace(/\{subtotal\}/g, this.money(q.subtotal)).replace(/\{product\}/g, this.o.product.title);
  }

  private renderElement(el: FormElement, quote: Quote): HTMLElement | null {
    switch (el.type) {
      case "heading":
        return h("h3", { class: "kb-heading", style: `font-size:${el.size}px;text-align:${el.align};${el.color ? `color:${el.color}` : ""}` }, this.fill(el.text));
      case "text":
        return h("p", { class: "kb-text", style: `font-size:${el.size}px;text-align:${el.align};${el.color ? `color:${el.color};` : ""}${el.background ? `background:${el.background};padding:8px;border-radius:8px` : ""}` }, this.fill(el.text));
      case "image":
        return el.url ? h("img", { class: "kb-img", src: el.url, alt: el.alt, loading: "lazy", style: `max-width:min(100%,${el.maxWidth}px)` }) : null;
      case "divider":
        return h("hr", { class: "kb-divider", style: el.color ? `border-color:${el.color}` : null });
      case "spacer":
        return h("div", { style: `height:${el.height}px` });
      case "countdown":
        return this.renderCountdown(el);
      case "cart":
        return this.renderCart(el, quote);
      case "quantity_offers":
        return this.renderTiers(el.title);
      case "upsells":
        return this.renderUpsells(el.title);
      case "shipping":
        return this.renderShipping(el.title, quote);
      case "summary":
        return this.renderSummary(el, quote);
      case "discount_code":
        return this.o.hasDiscountCodes || this.o.mode === "preview" ? this.renderDiscount(el) : null;
      case "submit": {
        const busy = this.state === "submitting";
        const v = this.variant();
        const out = v && !v.available && this.o.config.settings.outOfStock === "disable";
        const btn = h(
          "button",
          { type: "submit", class: `kb-btn kb-anim-${busy ? "none" : this.o.config.design.buttonAnimation}`, disabled: busy || out, part: "submit" },
          busy ? h("span", {}, h("span", { class: "kb-spinner" }), " ", this.o.config.messages.submitting) : h("span", {}, out ? this.o.config.messages.outOfStock : this.fill(el.text)),
          !busy && el.subtext ? h("small", {}, this.fill(el.subtext)) : null,
        );
        return btn;
      }
      case "field":
        return this.renderField(el);
    }
  }

  private renderCountdown(el: Extract<FormElement, { type: "countdown" }>): HTMLElement | null {
    const key = `kbcod_cd_${el.id}`;
    let start = Date.now();
    try {
      const s = Number(sessionStorage.getItem(key));
      if (s) start = s;
      else sessionStorage.setItem(key, String(start));
    } catch {
      /* stockage indisponible */
    }
    const total = el.minutes * 60_000;
    const remaining = () => {
      let left = total - ((Date.now() - start) % (el.onEnd === "restart" ? total : Number.MAX_SAFE_INTEGER));
      if (el.onEnd === "hide") left = total - (Date.now() - start);
      return left;
    };
    if (remaining() <= 0) return null;
    const b = h("b");
    const box = h("div", { class: "kb-countdown", style: `${el.background ? `background:${el.background};` : ""}${el.color ? `color:${el.color}` : ""}` }, h("span", {}, el.text), b);
    const tick = () => {
      const left = Math.max(0, remaining());
      const m = Math.floor(left / 60000);
      const s = Math.floor((left % 60000) / 1000);
      b.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      if (left <= 0 && el.onEnd === "hide") box.remove();
    };
    tick();
    this.timers.push(window.setInterval(tick, 1000));
    return box;
  }

  private renderCart(el: Extract<FormElement, { type: "cart" }>, quote: Quote): HTMLElement {
    const v = this.variant();
    const p = this.o.product;
    const q = this.quantityOffer();
    const hideQty = (q && q.hideQuantitySelector) || !el.showQuantity;
    const info = h("div", { class: "kb-cart-info" }, h("div", { class: "kb-cart-title" }, p.title));
    if (el.showVariantSelector && p.variants.length > 1) {
      const sel = h("select", { class: "kb-select", "aria-label": "Variante" });
      for (const vv of p.variants) sel.append(h("option", { value: vv.id, selected: vv.id === this.variantId, disabled: !vv.available && this.o.config.settings.outOfStock !== "allow" }, vv.title + (vv.available ? "" : ` — ${this.o.config.messages.outOfStock}`)));
      sel.addEventListener("change", () => {
        this.variantId = sel.value;
        this.serverQuote = null;
        this.o.onEvent?.("variant_change", { variantId: sel.value });
        this.render();
      });
      info.append(sel);
    }
    const line = quote.lines.find((l) => l.kind === "main");
    if (el.showPrice && v) info.append(h("div", { class: "kb-price" }, this.money(v.price), v.compareAtPrice && v.compareAtPrice > v.price ? h("span", { class: "kb-compare" }, this.money(v.compareAtPrice)) : null));
    const row = h("div", { class: "kb-cart", part: "cart" }, el.showImage && (v?.image || p.image) ? h("img", { src: v?.image || p.image || "", alt: p.title, loading: "lazy" }) : null, info);
    if (!hideQty && !this.tierId) {
      const qty = h("div", { class: "kb-qty" });
      const minus = h("button", { type: "button", "aria-label": "Diminuer" }, "−");
      const plus = h("button", { type: "button", "aria-label": "Augmenter" }, "+");
      minus.addEventListener("click", () => {
        this.quantity = Math.max(1, this.quantity - 1);
        this.render();
      });
      plus.addEventListener("click", () => {
        this.quantity = Math.min(el.maxQuantity, this.quantity + 1);
        this.render();
      });
      qty.append(minus, h("span", {}, String(line?.quantity ?? this.quantity)), plus);
      row.append(qty);
    }
    return row;
  }

  private renderTiers(title: string): HTMLElement | null {
    const q = this.quantityOffer();
    const v = this.variant();
    if (!q || !v) return null;
    const box = h("div", { part: "offers" }, title ? h("p", { class: "kb-section-title" }, title) : null);
    const list = h("div", { class: `kb-offers${q.style === "cards" ? " kb-cards" : ""}`, style: `--kb-tier-accent:${q.accentColor}`, role: "radiogroup" });
    for (const t of q.tiers) {
      const gross = v.price * t.quantity;
      const net =
        t.discountType === "percentage" ? gross - pct(gross, t.value) : t.discountType === "fixed" ? Math.max(0, gross - toMinor(t.value)) : t.discountType === "fixed_price" ? Math.min(gross, toMinor(t.value)) : gross;
      const on = this.tierId === t.id;
      const input = h("input", { type: "radio", name: "kb-tier", checked: on, value: t.id });
      const label = h(
        "label",
        { class: `kb-tier${on ? " kb-on" : ""}` },
        input,
        t.imageUrl ? h("img", { src: t.imageUrl, alt: "" }) : null,
        h("span", { class: "kb-tier-main" }, h("b", {}, t.title || `${t.quantity} ×`), t.subtitle ? h("span", { class: "kb-tier-sub" }, t.subtitle) : null),
        h("span", { class: "kb-price" }, this.money(net), net < gross ? h("span", { class: "kb-compare" }, this.money(gross)) : null),
        t.badge ? h("span", { class: "kb-badge" }, t.badge) : null,
      );
      input.addEventListener("change", () => {
        this.tierId = t.id;
        this.serverQuote = null;
        this.render();
      });
      list.append(label);
    }
    box.append(list);
    return box;
  }

  private renderUpsells(title: string): HTMLElement | null {
    const ups = this.upsells();
    if (!ups.length) return null;
    const box = h("div", { class: "kb-offers", part: "upsells" }, title ? h("p", { class: "kb-section-title" }, title) : null);
    for (const u of ups) {
      const c = u.config as Upsell;
      const price = c.displayPrice ?? 0;
      const net = c.discountType === "percentage" ? price - pct(price, c.value) : c.discountType === "fixed" ? Math.max(0, price - toMinor(c.value)) : price;
      const cb = h("input", { type: "checkbox", checked: this.upsellIds.has(u.id) });
      cb.addEventListener("change", () => {
        if (cb.checked) this.upsellIds.add(u.id);
        else this.upsellIds.delete(u.id);
        this.serverQuote = null;
        this.render();
      });
      box.append(
        h(
          "label",
          { class: "kb-upsell" },
          cb,
          c.imageUrl ? h("img", { src: c.imageUrl, alt: "" }) : null,
          h("span", { class: "kb-tier-main" }, h("b", {}, c.title), c.description ? h("span", { class: "kb-tier-sub" }, c.description) : null),
          price ? h("span", { class: "kb-price" }, this.money(net), net < price ? h("span", { class: "kb-compare" }, this.money(price)) : null) : null,
        ),
      );
    }
    return box;
  }

  private renderShipping(title: string, quote: Quote): HTMLElement | null {
    if (!quote.shippingOptions.length) return null;
    const box = h("div", { part: "shipping" }, title ? h("p", { class: "kb-section-title" }, title) : null);
    const list = h("div", { class: "kb-offers", role: "radiogroup" });
    const current = quote.shipping?.id;
    for (const opt of quote.shippingOptions) {
      const input = h("input", { type: "radio", name: "kb-ship", checked: opt.id === current });
      input.addEventListener("change", () => {
        this.shippingRateId = opt.id;
        this.serverQuote = null;
        this.render();
      });
      list.append(
        h(
          "label",
          { class: `kb-tier${opt.id === current ? " kb-on" : ""}` },
          input,
          h("span", { class: "kb-tier-main" }, h("b", {}, opt.name), opt.description ? h("span", { class: "kb-tier-sub" }, opt.description) : null),
          h("span", { class: "kb-price" }, opt.price === 0 ? this.freeLabel() : this.money(opt.price)),
        ),
      );
    }
    box.append(list);
    return box;
  }

  private freeLabel() {
    const s = this.o.config.elements.find((e) => e.type === "summary");
    return s && s.type === "summary" ? s.freeLabel : "Gratuite";
  }

  private renderSummary(el: Extract<FormElement, { type: "summary" }>, q: Quote): HTMLElement {
    const box = h("div", { class: "kb-summary", part: "summary" });
    box.append(h("div", { class: "kb-row" }, h("span", {}, el.subtotalLabel), h("span", {}, this.money(q.subtotal))));
    for (const d of q.discounts) box.append(h("div", { class: "kb-row kb-disc" }, h("span", {}, `${el.discountLabel} (${d.label})`), h("span", {}, `−${this.money(d.amount)}`)));
    if (q.shipping) box.append(h("div", { class: "kb-row" }, h("span", {}, el.shippingLabel), h("span", {}, q.shipping.price === 0 ? el.freeLabel : this.money(q.shipping.price))));
    box.append(h("div", { class: "kb-row kb-total" }, h("span", {}, el.totalLabel), h("span", {}, this.money(q.total))));
    return box;
  }

  private renderDiscount(el: Extract<FormElement, { type: "discount_code" }>): HTMLElement {
    const input = h("input", { class: "kb-input", type: "text", placeholder: el.placeholder, value: this.discountCode ?? "", "aria-label": el.label, autocomplete: "off" });
    const btn = h("button", { type: "button", class: "kb-btn kb-btn-sec", style: "width:auto" }, el.buttonText);
    btn.addEventListener("click", () => void this.applyDiscount(input.value.trim()));
    const box = h("div", {}, el.label ? h("label", { class: "kb-label" }, el.label) : null, h("div", { class: "kb-discount" }, input, btn));
    if (this.discountMsg) box.append(h("div", { class: "kb-err", style: this.discountMsg.ok ? "color:#15803d" : null }, this.discountMsg.text));
    return box;
  }

  private async applyDiscount(code: string) {
    if (!code || !this.o.api) {
      this.discountCode = null;
      this.serverQuote = null;
      this.discountMsg = null;
      this.render();
      return;
    }
    const seq = ++this.quoteSeq;
    const r = await this.o.api.quote(this.quotePayload(code)).catch(() => null);
    if (seq !== this.quoteSeq) return;
    const valid = r?.quote && !r.quote.errors.some((e) => e.includes("Code promo"));
    this.discountCode = valid ? code : null;
    this.serverQuote = valid ? r!.quote : null;
    this.discountMsg = { ok: Boolean(valid), text: valid ? this.o.config.messages.discountApplied : this.o.config.messages.discountInvalid };
    this.render();
  }

  private quotePayload(code: string | null) {
    return {
      shop: this.o.api?.shop,
      formId: this.o.formId,
      productId: this.o.product.id,
      variantId: this.variantId,
      quantity: this.quantity,
      tierId: this.tierId,
      upsellIds: [...this.upsellIds],
      downsellId: this.downsellId,
      shippingRateId: this.shippingRateId,
      discountCode: code,
      country: this.country(),
    };
  }

  private renderField(f: FieldElement): HTMLElement {
    const id = `kb-${f.key}`;
    const wrap = h("div", { class: `kb-field${this.errors[f.key] ? " kb-invalid" : ""}`, part: `field field-${f.key}` });
    const showLabel = this.o.config.design.showLabels && f.label && !["checkbox", "terms", "marketing_consent"].includes(f.input);
    if (showLabel) wrap.append(h("label", { class: "kb-label", for: id }, f.label, f.required ? h("span", { class: "kb-req" }, " *") : null));
    const val = this.values[f.key];
    const ac = this.o.config.settings.autocomplete;
    const autocomplete: Partial<Record<FieldElement["input"], string>> = {
      first_name: "given-name",
      last_name: "family-name",
      full_name: "name",
      phone: "tel",
      email: "email",
      address: "address-line1",
      address2: "address-line2",
      city: "address-level2",
      province: "address-level1",
      zip: "postal-code",
      country: "country",
    };
    const set = (v: string | boolean | string[]) => {
      this.values[f.key] = v;
      if (this.errors[f.key]) {
        delete this.errors[f.key];
        wrap.classList.remove("kb-invalid");
        wrap.querySelector(".kb-err")?.remove();
      }
    };
    const rerenderIfConditional = () => {
      if (this.o.config.elements.some((e) => e.condition?.fieldKey === f.key)) this.render();
    };
    let control: HTMLElement;
    switch (f.input) {
      case "textarea":
      case "note": {
        const ta = h("textarea", { id, class: "kb-input", placeholder: f.placeholder, required: f.required, maxlength: f.maxLength ? String(f.maxLength) : null, name: f.key });
        ta.value = typeof val === "string" ? val : "";
        ta.addEventListener("input", () => set(ta.value));
        ta.addEventListener("change", rerenderIfConditional);
        control = ta;
        break;
      }
      case "select":
      case "country": {
        const sel = h("select", { id, class: "kb-input", name: f.key, required: f.required, autocomplete: ac ? autocomplete[f.input] : "off" });
        const opts = f.input === "country" ? this.o.config.settings.countries.map((c) => ({ v: c, l: countryName(c) })) : f.options.map((o) => ({ v: o, l: o }));
        sel.append(h("option", { value: "" }, f.placeholder || "—"));
        const current = typeof val === "string" ? val : f.input === "country" ? this.o.config.settings.defaultCountry : "";
        for (const o of opts) sel.append(h("option", { value: o.v, selected: o.v === current }, o.l));
        if (f.input === "country" && !val) this.values[f.key] = current;
        sel.addEventListener("change", () => {
          set(sel.value);
          this.serverQuote = null;
          this.render();
        });
        control = sel;
        break;
      }
      case "radio": {
        const box = h("div", { class: "kb-choices", role: "radiogroup", "aria-label": f.label });
        for (const o of f.options) {
          const r = h("input", { type: "radio", name: id, value: o, checked: val === o });
          r.addEventListener("change", () => {
            set(o);
            rerenderIfConditional();
          });
          box.append(h("label", { class: "kb-choice" }, r, o));
        }
        control = box;
        break;
      }
      case "multi_choice": {
        const box = h("div", { class: "kb-choices" });
        const arr = Array.isArray(val) ? val : [];
        for (const o of f.options) {
          const cb = h("input", { type: "checkbox", value: o, checked: arr.includes(o) });
          cb.addEventListener("change", () => {
            const cur = new Set(Array.isArray(this.values[f.key]) ? (this.values[f.key] as string[]) : []);
            if (cb.checked) cur.add(o);
            else cur.delete(o);
            set([...cur]);
            rerenderIfConditional();
          });
          box.append(h("label", { class: "kb-choice" }, cb, o));
        }
        control = box;
        break;
      }
      case "checkbox":
      case "terms":
      case "marketing_consent": {
        const cb = h("input", { type: "checkbox", id, checked: val === true });
        cb.addEventListener("change", () => {
          set(cb.checked);
          rerenderIfConditional();
        });
        control = h("label", { class: "kb-choice" }, cb, h("span", {}, f.label || f.placeholder, f.required ? h("span", { class: "kb-req" }, " *") : null));
        break;
      }
      default: {
        const type = f.input === "phone" || f.input === "phone_secondary" ? "tel" : f.input === "email" ? "email" : f.input === "number" ? "number" : f.input === "date" ? "date" : "text";
        const input = h("input", {
          id,
          class: "kb-input",
          type,
          name: f.key,
          placeholder: f.placeholder,
          required: f.required,
          inputmode: type === "tel" ? "tel" : null,
          autocomplete: ac ? (autocomplete[f.input] ?? "on") : "off",
          maxlength: f.maxLength ? String(f.maxLength) : null,
          dir: type === "tel" ? "ltr" : null,
        });
        input.value = typeof val === "string" ? val : "";
        input.addEventListener("input", () => set(input.value));
        input.addEventListener("change", () => {
          rerenderIfConditional();
          if (f.input === "phone" || f.input === "email") this.savePartial();
        });
        control = input;
      }
    }
    const icon = f.icon ? FIELD_ICON[f.input] : undefined;
    if (icon && control.tagName !== "DIV" && control.tagName !== "LABEL") {
      wrap.append(h("div", { class: "kb-control kb-has-icon" }, svg(icon), control));
    } else wrap.append(control);
    if (this.errors[f.key]) wrap.append(h("div", { class: "kb-err", role: "alert" }, this.errors[f.key]!));
    return wrap;
  }

  private renderOtp(): HTMLElement {
    const m = this.o.config.messages;
    const input = h("input", { class: "kb-input", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "8", "aria-label": m.otpText });
    const btn = h("button", { type: "submit", class: "kb-btn" }, this.state === "submitting" ? h("span", { class: "kb-spinner" }) : "OK");
    const box = h(
      "div",
      { class: "kb-otp" },
      h("h3", { class: "kb-heading" }, m.otpTitle),
      h("p", { class: "kb-text" }, `${this.otp!.message} (${this.otp!.phoneMasked})`),
      this.alert ? h("div", { class: "kb-alert" }, this.alert) : null,
      input,
      btn,
    );
    input.addEventListener("input", () => (this.values.__otp = input.value.replace(/\D/g, "")));
    return box;
  }

  private renderSuccess(): HTMLElement {
    const m = this.o.config.messages;
    const text = m.successText.replace(/\{order_name\}/g, this.success?.orderName ?? "");
    return h("div", { class: "kb-form" }, h("div", { class: "kb-success", role: "status" }, svg("check", ""), h("h3", {}, m.successTitle), h("p", { class: "kb-text" }, text)));
  }

  // ---------- Envoi ----------

  private validate(): boolean {
    const m = this.o.config.messages;
    this.errors = {};
    for (const el of this.o.config.elements) {
      if (el.type !== "field" || !this.visible(el)) continue;
      const v = this.values[el.key];
      const msg = (d: string) => el.errorMessage || d;
      if (["checkbox", "terms", "marketing_consent"].includes(el.input)) {
        if (el.required && v !== true) this.errors[el.key] = msg(m.required);
        continue;
      }
      if (el.input === "multi_choice") {
        if (el.required && (!Array.isArray(v) || !v.length)) this.errors[el.key] = msg(m.required);
        continue;
      }
      const s = typeof v === "string" ? v.trim() : "";
      if (!s) {
        if (el.required) this.errors[el.key] = msg(m.required);
        continue;
      }
      if (el.minLength && s.length < el.minLength) this.errors[el.key] = msg(m.tooShort);
      if (el.maxLength && s.length > el.maxLength) this.errors[el.key] = msg(m.tooLong);
      if ((el.input === "phone" || el.input === "phone_secondary") && s.replace(/\D/g, "").length < 8) this.errors[el.key] = msg(m.invalidPhone);
      if (el.input === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) this.errors[el.key] = msg(m.invalidEmail);
    }
    return Object.keys(this.errors).length === 0;
  }

  private fireInitiateCheckout() {
    if (this.icFired || this.o.mode !== "live") return;
    this.icFired = true;
    const eventId = `kbcod.${this.submissionId}.ic`;
    const q = this.quote();
    this.o.onEvent?.("InitiateCheckout", { eventId, value: q.total, currency: this.o.currency, contentIds: [this.o.product.id], numItems: q.lines.reduce((s, l) => s + l.quantity, 0) });
    this.o.api?.track("InitiateCheckout", { eventId, value: q.total, productId: this.o.product.id, variantId: this.variantId, formId: this.o.formId });
  }

  private partialTimer: number | undefined;
  private savePartial() {
    if (this.o.mode !== "live" || !this.o.api) return;
    clearTimeout(this.partialTimer);
    this.partialTimer = window.setTimeout(() => {
      const consent = this.o.config.elements.some((e) => e.type === "field" && e.input === "marketing_consent" && this.values[e.key] === true);
      this.o.api!.partial({ formId: this.o.formId, submissionId: this.submissionId, productId: this.o.product.id, variantId: this.variantId, quantity: this.quantity, fields: this.fieldValues(), consent });
    }, 800);
  }

  private fieldValues(): Values {
    const out: Values = {};
    for (const el of this.o.config.elements) {
      if (el.type === "field" && this.visible(el) && this.values[el.key] !== undefined) out[el.key] = this.values[el.key]!;
    }
    return out;
  }

  setCaptchaToken(t: string | null) {
    this.captchaToken = t;
  }

  private async submit(): Promise<void> {
    if (this.state === "submitting") return;
    const m = this.o.config.messages;
    this.alert = null;
    if (this.state !== "otp" && !this.validate()) {
      this.render();
      const first = this.root.querySelector(".kb-invalid") as HTMLElement | null;
      first?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (this.o.mode === "preview" || !this.o.api) {
      this.success = { orderName: "#1001", statusUrl: null };
      this.state = "success";
      this.render();
      return;
    }
    const hp = (this.root.querySelector('input[name="company_website"]') as HTMLInputElement | null)?.value ?? "";
    const wasOtp = this.state === "otp";
    this.state = "submitting";
    this.render();
    const payload = {
      shop: this.o.api.shop,
      formId: this.o.formId,
      submissionId: this.submissionId,
      productId: this.o.product.id,
      variantId: this.variantId,
      quantity: this.quantity,
      tierId: this.tierId,
      upsellIds: [...this.upsellIds],
      downsellId: this.downsellId,
      shippingRateId: this.shippingRateId ?? this.quote().shipping?.id ?? null,
      discountCode: this.discountCode,
      fields: this.fieldValues(),
      tracking: {} as SubmitPayload["tracking"],
      hp,
      elapsedMs: Date.now() - this.startedAt,
      deviceId: null,
      otp: wasOtp && this.otp ? { challengeId: this.otp.challengeId, code: String(this.values.__otp ?? "") } : null,
      locale: document.documentElement.lang || null,
      captcha: this.captchaToken,
    } as SubmitPayload;
    let res: SubmitResponse | null = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        res = await this.o.api.submit(payload);
      } catch {
        res = null;
      }
      // « processing » (traitement en cours ou réseau incertain) : on renvoie la même soumission, sans risque de doublon.
      if (res && !(res.ok && res.status === "processing")) break;
      await new Promise((r) => setTimeout(r, res && res.ok && res.status === "processing" ? res.retryAfterMs : 1500 * (attempt + 1)));
    }
    if (!res) {
      this.state = wasOtp ? "otp" : "form";
      this.alert = m.submitError;
      this.render();
      return;
    }
    if (res.ok && res.status === "created") {
      this.success = { orderName: res.orderName, statusUrl: res.orderStatusUrl };
      for (const e of res.events) this.o.onEvent?.("submit", e as unknown as Record<string, unknown>);
      const pp = res.postPurchase;
      if (pp) {
        const found = this.o.offers.find((o) => o.id === pp.offerId && o.type === "post_purchase") as PublicOffer<"post_purchase"> | undefined;
        if (found) {
          this.postPurchase = { offer: found, token: pp.token };
          this.state = "post_purchase";
          this.render();
          return;
        }
      }
      this.state = "success";
      this.afterSuccess();
      return;
    }
    if (!res.ok && res.status === "otp_required") {
      this.otp = { challengeId: res.challengeId, phoneMasked: res.phoneMasked, message: res.message };
      this.state = "otp";
      this.alert = wasOtp ? res.message : null;
      this.render();
      return;
    }
    this.state = wasOtp ? "otp" : "form";
    if (!res.ok) {
      this.alert = res.message;
      if ("fieldErrors" in res && res.fieldErrors) this.errors = res.fieldErrors;
    }
    this.render();
  }

  private afterSuccess() {
    const r = this.o.config.settings.redirect;
    this.render();
    if (r.type === "order_status" && this.success?.statusUrl) window.setTimeout(() => (window.location.href = this.success!.statusUrl!), 1200);
    else if (r.type === "url" && r.url) window.setTimeout(() => (window.location.href = r.url), 1200);
  }

  private reset() {
    this.submissionId = uuid();
    this.startedAt = Date.now();
    this.state = "form";
    this.success = null;
    this.icFired = false;
  }
}

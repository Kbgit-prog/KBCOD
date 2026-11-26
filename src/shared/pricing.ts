import type {
  DiscountCode,
  Downsell,
  PublicOffer,
  QuantityOffer,
  QuantityTier,
  ShippingRate,
  Upsell,
} from "./offers-schema";
import { appliesToProduct } from "./offer-utils";

/** Montants en unités mineures (centimes) entières. */
export interface CatalogVariant {
  variantId: string;
  productId: string;
  productTitle: string;
  title: string;
  price: number;
  compareAtPrice: number | null;
  available: boolean;
  image: string | null;
  sku?: string | null;
}

export interface QuoteInput {
  productId: string;
  variantId: string;
  quantity: number;
  tierId?: string | null;
  upsellIds?: string[];
  downsellId?: string | null;
  shippingRateId?: string | null;
  discountCode?: string | null;
  country?: string | null;
}

export interface QuoteContext {
  catalog: Map<string, CatalogVariant>;
  offers: PublicOffer[];
  shippingRates: ShippingRate[];
  discountCodes: DiscountCode[];
  /** Quantité maximale par commande (antifraude), null = illimité. */
  maxQuantity?: number | null;
  allowOutOfStock?: boolean;
  now?: Date;
}

export interface QuoteLine {
  variantId: string;
  productId: string;
  title: string;
  variantTitle: string;
  quantity: number;
  unitPrice: number;
  kind: "main" | "upsell";
  sku?: string | null;
}

export interface Quote {
  lines: QuoteLine[];
  subtotal: number;
  discounts: { label: string; amount: number; source: string }[];
  discountTotal: number;
  shipping: { id: string; name: string; price: number } | null;
  shippingOptions: { id: string; name: string; description: string; price: number }[];
  total: number;
  tier: QuantityTier | null;
  errors: string[];
}

export function pct(amount: number, percent: number): number {
  return Math.round((amount * Math.min(Math.max(percent, 0), 100)) / 100);
}

/** Convertit un montant décimal (ex. "5000.00" ou 12.5) en centimes entiers. */
export function toMinor(amount: string | number): number {
  const n = typeof amount === "number" ? amount : Number.parseFloat(amount);
  if (!Number.isFinite(n)) throw new Error(`Montant invalide : ${amount}`);
  return Math.round(n * 100);
}

export function fromMinor(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function tierDiscount(tier: QuantityTier, unitPrice: number): number {
  const gross = unitPrice * tier.quantity;
  switch (tier.discountType) {
    case "percentage":
      return pct(gross, tier.value);
    case "fixed":
      return Math.min(gross, toMinor(tier.value));
    case "fixed_price":
      return Math.max(0, gross - toMinor(tier.value));
    default:
      return 0;
  }
}

export function eligibleShippingRates(
  rates: ShippingRate[],
  subtotalAfterDiscounts: number,
  country: string | null | undefined,
): ShippingRate[] {
  return rates.filter((r) => {
    if (!r.enabled) return false;
    if (r.countries.length && country && !r.countries.includes(country)) return false;
    if (r.minSubtotal !== null && subtotalAfterDiscounts < r.minSubtotal) return false;
    if (r.maxSubtotal !== null && subtotalAfterDiscounts > r.maxSubtotal) return false;
    return true;
  });
}

export function findQuantityOffer(offers: PublicOffer[], productId: string): PublicOffer<"quantity"> | null {
  const o = offers.find((x) => x.type === "quantity" && appliesToProduct((x.config as QuantityOffer).productIds, productId));
  return (o as PublicOffer<"quantity">) ?? null;
}

/**
 * Calcul unique des montants. Côté navigateur : estimation d'affichage.
 * Côté serveur : calcul faisant foi, avec le catalogue relu depuis Shopify.
 */
export function computeQuote(input: QuoteInput, ctx: QuoteContext): Quote {
  const errors: string[] = [];
  const lines: QuoteLine[] = [];
  const discounts: Quote["discounts"] = [];
  const now = ctx.now ?? new Date();

  const main = ctx.catalog.get(input.variantId);
  if (!main || main.productId !== input.productId) {
    return emptyQuote(["Variante introuvable pour ce produit"]);
  }
  if (!main.available && !ctx.allowOutOfStock) errors.push("Produit en rupture de stock");

  let quantity = Math.floor(input.quantity);
  let tier: QuantityTier | null = null;
  const qOffer = findQuantityOffer(ctx.offers, input.productId);
  if (input.tierId) {
    const t = qOffer ? (qOffer.config as QuantityOffer).tiers.find((x) => x.id === input.tierId) : undefined;
    if (!t) errors.push("Offre de quantité invalide");
    else {
      tier = t;
      quantity = t.quantity;
    }
  }
  if (!Number.isInteger(quantity) || quantity < 1) errors.push("Quantité invalide");
  if (ctx.maxQuantity && quantity > ctx.maxQuantity) errors.push(`Quantité maximale : ${ctx.maxQuantity}`);
  quantity = Math.max(1, quantity);

  lines.push({
    variantId: main.variantId,
    productId: main.productId,
    title: main.productTitle,
    variantTitle: main.title,
    quantity,
    unitPrice: main.price,
    kind: "main",
    sku: main.sku ?? null,
  });
  if (tier) {
    const d = tierDiscount(tier, main.price);
    if (d > 0) discounts.push({ label: tier.title || `Offre x${tier.quantity}`, amount: d, source: `tier:${tier.id}` });
  }

  const seenUpsell = new Set<string>();
  for (const uid of input.upsellIds ?? []) {
    if (seenUpsell.has(uid)) continue;
    seenUpsell.add(uid);
    const offer = ctx.offers.find((o) => o.id === uid && o.type === "upsell") as PublicOffer<"upsell"> | undefined;
    const cfg = offer?.config as Upsell | undefined;
    if (!offer || !cfg || !appliesToProduct(cfg.triggerProductIds, input.productId)) {
      errors.push("Upsell invalide");
      continue;
    }
    const v = ctx.catalog.get(cfg.variantId);
    if (!v || v.productId !== cfg.productId) {
      errors.push("Produit d'upsell introuvable");
      continue;
    }
    if (!v.available && !ctx.allowOutOfStock) {
      errors.push("Produit d'upsell en rupture de stock");
      continue;
    }
    lines.push({
      variantId: v.variantId,
      productId: v.productId,
      title: v.productTitle,
      variantTitle: v.title,
      quantity: 1,
      unitPrice: v.price,
      kind: "upsell",
      sku: v.sku ?? null,
    });
    const d = cfg.discountType === "percentage" ? pct(v.price, cfg.value) : cfg.discountType === "fixed" ? Math.min(v.price, toMinor(cfg.value)) : 0;
    if (d > 0) discounts.push({ label: offer.name || cfg.title, amount: d, source: `upsell:${offer.id}` });
  }

  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  let running = subtotal - discounts.reduce((s, d) => s + d.amount, 0);

  if (input.downsellId) {
    const offer = ctx.offers.find((o) => o.id === input.downsellId && o.type === "downsell");
    const cfg = offer?.config as Downsell | undefined;
    if (!offer || !cfg || !appliesToProduct(cfg.triggerProductIds, input.productId)) errors.push("Offre de downsell invalide");
    else {
      const d = cfg.discountType === "percentage" ? pct(running, cfg.value) : Math.min(running, toMinor(cfg.value));
      if (d > 0) {
        discounts.push({ label: offer.name || "Offre spéciale", amount: d, source: `downsell:${offer.id}` });
        running -= d;
      }
    }
  }

  if (input.discountCode) {
    const code = ctx.discountCodes.find(
      (c) => c.enabled && c.code.toLowerCase() === input.discountCode!.trim().toLowerCase(),
    );
    if (!code || (code.expiresAt && new Date(code.expiresAt) < now) || (code.minSubtotal !== null && running < code.minSubtotal)) {
      errors.push("Code promo invalide");
    } else {
      const d = code.type === "percentage" ? pct(running, code.value) : Math.min(running, toMinor(code.value));
      if (d > 0) {
        discounts.push({ label: code.code.toUpperCase(), amount: d, source: `code:${code.code.toUpperCase()}` });
        running -= d;
      }
    }
  }

  const discountTotal = Math.min(subtotal, discounts.reduce((s, d) => s + d.amount, 0));
  const afterDiscounts = subtotal - discountTotal;

  const eligible = eligibleShippingRates(ctx.shippingRates, afterDiscounts, input.country);
  const priceOf = (r: ShippingRate) =>
    tier?.freeShipping || (r.freeAbove !== null && afterDiscounts >= r.freeAbove) ? 0 : r.price;
  const shippingOptions = eligible.map((r) => ({ id: r.id, name: r.name, description: r.description, price: priceOf(r) }));
  let shipping: Quote["shipping"] = null;
  if (shippingOptions.length) {
    const chosen = input.shippingRateId ? shippingOptions.find((o) => o.id === input.shippingRateId) : shippingOptions[0];
    if (!chosen) errors.push("Mode de livraison indisponible");
    else shipping = { id: chosen.id, name: chosen.name, price: chosen.price };
  } else if (input.shippingRateId) {
    errors.push("Mode de livraison indisponible");
  }

  const total = Math.max(0, afterDiscounts + (shipping?.price ?? 0));
  return { lines, subtotal, discounts, discountTotal, shipping, shippingOptions, total, tier, errors };
}

function emptyQuote(errors: string[]): Quote {
  return { lines: [], subtotal: 0, discounts: [], discountTotal: 0, shipping: null, shippingOptions: [], total: 0, tier: null, errors };
}

/** Formatage selon le format monétaire Shopify (ex. "{{amount_no_decimals_with_space_separator}} FCFA"). */
export function formatMoney(minor: number, format = "{{amount}}"): string {
  const value = minor / 100;
  const fmt = (n: number, decimals: number, thousands: string, dec: string) => {
    const fixed = Math.abs(n).toFixed(decimals);
    const [int, frac] = fixed.split(".");
    const withSep = (int ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
    return (n < 0 ? "-" : "") + (frac ? `${withSep}${dec}${frac}` : withSep);
  };
  return format.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => {
    switch (key) {
      case "amount":
        return fmt(value, 2, ",", ".");
      case "amount_no_decimals":
        return fmt(value, 0, ",", ".");
      case "amount_with_comma_separator":
        return fmt(value, 2, ".", ",");
      case "amount_no_decimals_with_comma_separator":
        return fmt(value, 0, ".", ",");
      case "amount_with_space_separator":
        return fmt(value, 2, " ", ",");
      case "amount_no_decimals_with_space_separator":
        return fmt(value, 0, " ", ",");
      case "amount_with_apostrophe_separator":
        return fmt(value, 2, "'", ".");
      case "amount_with_period_and_space_separator":
        return fmt(value, 2, " ", ".");
      default:
        return fmt(value, 2, ",", ".");
    }
  });
}

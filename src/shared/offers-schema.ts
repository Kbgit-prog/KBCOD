import { z } from "zod";

const money = z.number().int().min(0).max(1_000_000_000_00); // unités mineures (centimes)
const idList = z.array(z.string().regex(/^\d{1,20}$/)).max(500).default([]);
const shortText = z.string().max(300);

export const discountTypeSchema = z.enum(["none", "percentage", "fixed", "fixed_price"]);
export type DiscountType = z.infer<typeof discountTypeSchema>;

export const quantityTierSchema = z.object({
  id: z.string().min(1).max(64),
  quantity: z.number().int().min(1).max(999),
  title: shortText.default(""),
  subtitle: shortText.default(""),
  badge: shortText.default(""),
  /** percentage : % de remise ; fixed : montant retiré ; fixed_price : prix total du palier. */
  discountType: discountTypeSchema.default("none"),
  value: z.number().min(0).max(1_000_000_000).default(0),
  preselected: z.boolean().default(false),
  imageUrl: z.string().url().max(2000).or(z.literal("")).default(""),
  freeShipping: z.boolean().default(false),
});
export type QuantityTier = z.infer<typeof quantityTierSchema>;

export const quantityOfferSchema = z.object({
  productIds: idList,
  tiers: z.array(quantityTierSchema).min(1).max(10),
  style: z.enum(["list", "cards"]).default("list"),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).default("#2563eb"),
  hideQuantitySelector: z.boolean().default(true),
});
export type QuantityOffer = z.infer<typeof quantityOfferSchema>;

export const upsellSchema = z.object({
  /** Produits déclencheurs (vide = tous les produits). */
  triggerProductIds: idList,
  productId: z.string().regex(/^\d{1,20}$/),
  variantId: z.string().regex(/^\d{1,20}$/),
  title: shortText.default("Ajoutez ce produit à votre commande"),
  description: shortText.default(""),
  imageUrl: z.string().url().max(2000).or(z.literal("")).default(""),
  discountType: z.enum(["none", "percentage", "fixed"]).default("none"),
  value: z.number().min(0).max(1_000_000_000).default(0),
  preselected: z.boolean().default(false),
});
export type Upsell = z.infer<typeof upsellSchema>;

export const downsellSchema = z.object({
  triggerProductIds: idList,
  title: shortText.default("Attendez ! Une offre spéciale pour vous"),
  text: shortText.default("Profitez d'une réduction si vous commandez maintenant."),
  discountType: z.enum(["percentage", "fixed"]).default("percentage"),
  value: z.number().min(0).max(1_000_000_000).default(10),
  acceptText: shortText.default("Oui, je profite de l'offre"),
  declineText: shortText.default("Non merci"),
});
export type Downsell = z.infer<typeof downsellSchema>;

/** Upsell 1-Click proposé après la création de la commande (ajout par modification de commande). */
export const postPurchaseSchema = z.object({
  triggerProductIds: idList,
  productId: z.string().regex(/^\d{1,20}$/),
  variantId: z.string().regex(/^\d{1,20}$/),
  title: shortText.default("Offre exclusive : ajoutez ce produit"),
  description: shortText.default(""),
  imageUrl: z.string().url().max(2000).or(z.literal("")).default(""),
  discountType: z.enum(["none", "percentage", "fixed"]).default("percentage"),
  value: z.number().min(0).max(1_000_000_000).default(10),
  acceptText: shortText.default("Ajouter à ma commande"),
  declineText: shortText.default("Non merci"),
});
export type PostPurchase = z.infer<typeof postPurchaseSchema>;

export const OFFER_TYPES = ["quantity", "upsell", "downsell", "post_purchase"] as const;
export type OfferType = (typeof OFFER_TYPES)[number];

export const offerConfigSchemas = {
  quantity: quantityOfferSchema,
  upsell: upsellSchema,
  downsell: downsellSchema,
  post_purchase: postPurchaseSchema,
} as const;

export const shippingRateSchema = z.object({
  id: z.string().min(1).max(64),
  name: shortText.min(1),
  description: shortText.default(""),
  price: money,
  countries: z.array(z.string().length(2)).max(250).default([]),
  minSubtotal: money.nullable().default(null),
  maxSubtotal: money.nullable().default(null),
  freeAbove: money.nullable().default(null),
  enabled: z.boolean().default(true),
});
export type ShippingRate = z.infer<typeof shippingRateSchema>;

export const discountCodeSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]{2,40}$/),
  type: z.enum(["percentage", "fixed"]),
  value: z.number().min(0).max(1_000_000_000),
  minSubtotal: money.nullable().default(null),
  enabled: z.boolean().default(true),
  expiresAt: z.string().datetime().nullable().default(null),
});
export type DiscountCode = z.infer<typeof discountCodeSchema>;

/** Offre telle qu'envoyée au storefront (id + type + config). */
export interface PublicOffer<T extends OfferType = OfferType> {
  id: string;
  type: T;
  name: string;
  config: z.infer<(typeof offerConfigSchemas)[T]>;
}

export function appliesToProduct(ids: string[], productId: string): boolean {
  return ids.length === 0 || ids.includes(productId);
}

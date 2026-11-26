import { z } from "zod";

const numId = z.string().regex(/^\d{1,20}$/);

export const fieldValueSchema = z.union([z.string().max(2000), z.boolean(), z.array(z.string().max(300)).max(50)]);

export const submitSchema = z.object({
  shop: z.string().regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/),
  formId: z.string().uuid(),
  /** Clé d'idempotence générée par le navigateur à l'ouverture du formulaire. */
  submissionId: z.string().uuid(),
  productId: numId,
  variantId: numId,
  quantity: z.number().int().min(1).max(999),
  tierId: z.string().max(64).nullable().default(null),
  upsellIds: z.array(z.string().uuid()).max(10).default([]),
  downsellId: z.string().uuid().nullable().default(null),
  shippingRateId: z.string().max(64).nullable().default(null),
  discountCode: z.string().max(40).nullable().default(null),
  fields: z.record(z.string().regex(/^[a-z0-9_]{1,64}$/), fieldValueSchema),
  tracking: z
    .object({
      fbp: z.string().max(200).nullable().default(null),
      fbc: z.string().max(400).nullable().default(null),
      ttclid: z.string().max(400).nullable().default(null),
      pageUrl: z.string().max(2000).nullable().default(null),
      referrer: z.string().max(2000).nullable().default(null),
    })
    .prefault({}),
  /** Champ piège invisible : doit rester vide. */
  hp: z.string().max(200).default(""),
  /** Millisecondes écoulées entre l'affichage et l'envoi. */
  elapsedMs: z.number().int().min(0).max(86_400_000),
  deviceId: z.string().max(64).nullable().default(null),
  otp: z.object({ challengeId: z.string().uuid(), code: z.string().regex(/^\d{4,8}$/) }).nullable().default(null),
  locale: z.string().max(10).nullable().default(null),
  /** Jeton Cloudflare Turnstile si la protection anti-robot est activée. */
  captcha: z.string().max(4000).nullable().default(null),
});
export type SubmitPayload = z.infer<typeof submitSchema>;

export type SubmitResponse =
  | {
      ok: true;
      status: "created";
      orderName: string;
      orderId: string;
      orderStatusUrl: string | null;
      total: number;
      currency: string;
      /** Identifiants d'événements à réutiliser côté navigateur (déduplication Meta). */
      events: { name: string; eventId: string; value: number; currency: string; contentIds: string[]; numItems: number }[];
      postPurchase: { offerId: string; token: string } | null;
    }
  | { ok: true; status: "processing"; retryAfterMs: number }
  | { ok: false; status: "otp_required"; challengeId: string; phoneMasked: string; message: string }
  | { ok: false; status: "blocked" | "limited" | "invalid" | "error"; message: string; fieldErrors?: Record<string, string> };

export const quoteRequestSchema = submitSchema.pick({
  shop: true,
  formId: true,
  productId: true,
  variantId: true,
  quantity: true,
  tierId: true,
  upsellIds: true,
  downsellId: true,
  shippingRateId: true,
  discountCode: true,
}).extend({ country: z.string().length(2).nullable().default(null) });

export const partialSchema = z.object({
  shop: submitSchema.shape.shop,
  formId: z.string().uuid(),
  submissionId: z.string().uuid(),
  productId: numId,
  variantId: numId,
  quantity: z.number().int().min(1).max(999),
  fields: submitSchema.shape.fields,
  consent: z.boolean().default(false),
});

export const trackSchema = z.object({
  shop: submitSchema.shape.shop,
  formId: z.string().uuid().nullable().default(null),
  event: z.enum(["form_view", "form_open", "InitiateCheckout"]),
  eventId: z.string().max(100).nullable().default(null),
  productId: numId.nullable().default(null),
  variantId: numId.nullable().default(null),
  value: z.number().int().min(0).max(1e12).nullable().default(null),
  fbp: z.string().max(200).nullable().default(null),
  fbc: z.string().max(400).nullable().default(null),
  pageUrl: z.string().max(2000).nullable().default(null),
});

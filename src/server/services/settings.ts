import { z } from "zod";
import { discountCodeSchema, shippingRateSchema } from "../../shared/offers-schema";

export const limitRuleSchema = z.object({
  id: z.string().min(1).max(64),
  enabled: z.boolean().default(true),
  identifier: z.enum(["phone", "ip", "device", "email", "ip_phone"]),
  maxOrders: z.number().int().min(1).max(1000),
  /** Durée de la fenêtre glissante en heures (ex. 72). */
  windowHours: z.number().min(0.1).max(24 * 365),
  /** block : refuse ; otp : exige une vérification OTP ; flag : crée la commande avec une étiquette. */
  action: z.enum(["block", "otp", "flag"]).default("block"),
  message: z.string().max(300).default(""),
});
export type LimitRule = z.infer<typeof limitRuleSchema>;

export const fraudSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  rules: z.array(limitRuleSchema).max(20).default([
    { id: "phone72", enabled: true, identifier: "phone", maxOrders: 2, windowHours: 72, action: "block", message: "" },
    { id: "ip24", enabled: true, identifier: "ip", maxOrders: 5, windowHours: 24, action: "flag", message: "" },
  ]),
  maxQuantityPerOrder: z.number().int().min(1).max(999).nullable().default(20),
  /** Tentatives (même bloquées) par IP et par 10 minutes avant refus temporaire. */
  attemptsPer10Min: z.number().int().min(1).max(1000).default(15),
  /** Délai minimal (ms) entre affichage et envoi ; plus rapide = robot probable. */
  minFillMs: z.number().int().min(0).max(60_000).default(2500),
  honeypot: z.boolean().default(true),
  turnstile: z.object({ enabled: z.boolean().default(false), siteKey: z.string().max(200).default("") }).prefault({}),
  /** Les commandes signalées reçoivent cette étiquette Shopify. */
  flagTag: z.string().max(40).default("KBCOD_A_VERIFIER"),
  /** Indicatifs autorisés (vide = tous), ex. ["225"]. */
  allowedCallingCodes: z.array(z.string().regex(/^\d{1,4}$/)).max(50).default([]),
});
export type FraudSettings = z.infer<typeof fraudSettingsSchema>;

export const otpSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  /** always : chaque commande ; rules : uniquement quand une règle l'exige. */
  mode: z.enum(["always", "rules"]).default("rules"),
  channel: z.enum(["sms", "whatsapp"]).default("sms"),
  codeLength: z.number().int().min(4).max(8).default(4),
  ttlMinutes: z.number().int().min(1).max(30).default(10),
  maxAttempts: z.number().int().min(1).max(10).default(5),
  maxSends: z.number().int().min(1).max(5).default(3),
  verifiedTag: z.string().max(40).default("KBCOD_VERIFIE"),
  template: z.string().max(300).default("Votre code {shop_name} : {code}"),
});

export const providerSettingsSchema = z.object({
  smsProvider: z.enum(["none", "twilio", "webhook"]).default("none"),
  twilioAccountSid: z.string().max(64).default(""),
  twilioFrom: z.string().max(32).default(""),
  /** Jeton Twilio ou secret webhook, stocké chiffré (jamais renvoyé au navigateur). */
  smsSecretEnc: z.string().max(2000).default(""),
  webhookUrl: z.string().url().or(z.literal("")).default(""),
  whatsappPhoneNumberId: z.string().max(64).default(""),
  whatsappTokenEnc: z.string().max(2000).default(""),
  whatsappLanguage: z.string().max(10).default("fr"),
});

export const notificationSettingsSchema = z.object({
  orderConfirmation: z.object({ enabled: z.boolean().default(false), channel: z.enum(["sms", "whatsapp"]).default("whatsapp"), template: z.string().max(1000).default("Bonjour {name}, votre commande {order_name} ({total}) est bien reçue. Nous vous appellerons pour confirmer la livraison.") }).prefault({}),
  shipping: z.object({ enabled: z.boolean().default(false), channel: z.enum(["sms", "whatsapp"]).default("whatsapp"), template: z.string().max(1000).default("Bonjour {name}, votre commande {order_name} est en route.") }).prefault({}),
  abandoned: z.object({ enabled: z.boolean().default(false), channel: z.enum(["sms", "whatsapp"]).default("whatsapp"), template: z.string().max(1000).default("Bonjour {name}, vous n'avez pas terminé votre commande sur {shop_name}. Répondez à ce message pour la finaliser.") }).prefault({}),
  /** Modèle WhatsApp approuvé (obligatoire hors fenêtre de 24 h). */
  whatsappTemplateName: z.string().max(100).default(""),
});

export const orderSettingsSchema = z.object({
  tags: z.array(z.string().max(40)).max(20).default(["KBCOD", "COD"]),
  sendReceipt: z.boolean().default(false),
  /** Enregistre une transaction en attente « Paiement à la livraison ». */
  recordCodTransaction: z.boolean().default(true),
  gatewayName: z.string().max(60).default("Cash on Delivery (COD)"),
  inventoryBehaviour: z.enum(["DECREMENT_OBEYING_POLICY", "DECREMENT_IGNORING_POLICY", "BYPASS"]).default("DECREMENT_OBEYING_POLICY"),
  allowOutOfStock: z.boolean().default(false),
  /** Étiquette ajoutée par le marchand pour signaler une commande confirmée (déclenche l'événement de confirmation). */
  confirmedTag: z.string().max(40).default("confirmed"),
  /** Nom des champs utilisés pour l'adresse de livraison Shopify. */
  noteFieldKeys: z.array(z.string()).max(20).default([]),
  shippingRates: z.array(shippingRateSchema).max(50).default([]),
  discountCodes: z.array(discountCodeSchema).max(100).default([]),
  taxesIncluded: z.boolean().default(true),
});

export const abandonedSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  delayMinutes: z.number().int().min(5).max(1440).default(15),
  retentionDays: z.number().int().min(1).max(365).default(30),
});

export const trackingSettingsSchema = z.object({
  /** Événement envoyé à la soumission (commande COD créée, non payée). */
  submitEvent: z.enum(["Lead", "Purchase", "SubmitApplication", "CompleteRegistration", "Custom"]).default("Purchase"),
  submitCustomName: z.string().regex(/^[A-Za-z0-9_]{1,40}$/).default("CODOrderPlaced"),
  /** Événements serveur des étapes suivantes (vide = désactivé). */
  confirmedEvent: z.string().max(40).default("CODOrderConfirmed"),
  shippedEvent: z.string().max(40).default("CODOrderShipped"),
  /** À la mise en « payé » (livraison encaissée). */
  paidEvent: z.string().max(40).default("CODOrderDelivered"),
  initiateCheckout: z.boolean().default(true),
  sendPageView: z.boolean().default(false),
});

export const shopSettingsSchema = z.object({
  fraud: fraudSettingsSchema.prefault({}),
  otp: otpSettingsSchema.prefault({}),
  providers: providerSettingsSchema.prefault({}),
  notifications: notificationSettingsSchema.prefault({}),
  orders: orderSettingsSchema.prefault({}),
  abandoned: abandonedSettingsSchema.prefault({}),
  tracking: trackingSettingsSchema.prefault({}),
  dataRetentionDays: z.number().int().min(30).max(3650).default(365),
});
export type ShopSettings = z.infer<typeof shopSettingsSchema>;

/** Version publiable (sans secrets) des paramètres. */
export function publicSettings(s: ShopSettings) {
  const { smsSecretEnc, whatsappTokenEnc, ...providers } = s.providers;
  return {
    ...s,
    providers: { ...providers, hasSmsSecret: Boolean(smsSecretEnc), hasWhatsappToken: Boolean(whatsappTokenEnc) },
  };
}

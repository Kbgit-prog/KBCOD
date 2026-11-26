import { z } from "zod";

/**
 * Configuration d'un formulaire COD. Partagée par l'admin (constructeur),
 * le serveur (validation) et le storefront (rendu).
 */

const color = z.string().regex(/^#[0-9a-fA-F]{3,8}$|^transparent$/, "Couleur hexadécimale attendue");
const shortText = z.string().max(300);
const longText = z.string().max(5000);

export const conditionSchema = z.object({
  fieldKey: z.string().min(1).max(64),
  operator: z.enum(["equals", "not_equals", "contains", "filled", "empty"]),
  value: z.string().max(300).default(""),
});

const base = {
  id: z.string().min(1).max(64),
  visible: z.boolean().default(true),
  condition: conditionSchema.nullable().default(null),
};

/** Types de champs de saisie client. */
export const INPUT_TYPES = [
  "first_name",
  "last_name",
  "full_name",
  "phone",
  "phone_secondary",
  "email",
  "address",
  "address2",
  "city",
  "province",
  "zip",
  "country",
  "note",
  "text",
  "textarea",
  "number",
  "date",
  "select",
  "radio",
  "checkbox",
  "multi_choice",
  "marketing_consent",
  "terms",
] as const;
export type InputType = (typeof INPUT_TYPES)[number];

export const fieldElementSchema = z.object({
  ...base,
  type: z.literal("field"),
  input: z.enum(INPUT_TYPES),
  /** Clé stable utilisée pour le mapping Sheets, les conditions et les commandes. */
  key: z.string().regex(/^[a-z0-9_]{1,64}$/, "Clé : minuscules, chiffres et _ uniquement"),
  label: shortText.default(""),
  placeholder: shortText.default(""),
  required: z.boolean().default(false),
  errorMessage: shortText.default(""),
  defaultValue: shortText.default(""),
  options: z.array(z.string().max(200)).max(100).default([]),
  minLength: z.number().int().min(0).max(5000).nullable().default(null),
  maxLength: z.number().int().min(1).max(5000).nullable().default(null),
  width: z.enum(["full", "half"]).default("full"),
  icon: z.boolean().default(true),
  /** Pays par défaut pour la validation du téléphone (ISO 3166-1 alpha-2). */
  phoneCountry: z.string().length(2).nullable().default(null),
  /** Autoriser les numéros d'un autre pays que le pays par défaut. */
  phoneInternational: z.boolean().default(true),
});

export const headingElementSchema = z.object({
  ...base,
  type: z.literal("heading"),
  text: shortText.default("Commander maintenant"),
  size: z.number().int().min(10).max(48).default(20),
  align: z.enum(["left", "center", "right"]).default("center"),
  color: color.nullable().default(null),
});

export const textElementSchema = z.object({
  ...base,
  type: z.literal("text"),
  text: longText.default(""),
  align: z.enum(["left", "center", "right"]).default("left"),
  size: z.number().int().min(10).max(32).default(14),
  color: color.nullable().default(null),
  background: color.nullable().default(null),
});

export const imageElementSchema = z.object({
  ...base,
  type: z.literal("image"),
  url: z.string().url().max(2000).or(z.literal("")).default(""),
  alt: shortText.default(""),
  maxWidth: z.number().int().min(20).max(1200).default(600),
});

export const countdownElementSchema = z.object({
  ...base,
  type: z.literal("countdown"),
  text: shortText.default("L'offre se termine dans"),
  minutes: z.number().int().min(1).max(10080).default(15),
  /** restart : relance le minuteur à expiration ; hide : masque l'élément. */
  onEnd: z.enum(["restart", "hide"]).default("restart"),
  background: color.nullable().default(null),
  color: color.nullable().default(null),
});

export const cartElementSchema = z.object({
  ...base,
  type: z.literal("cart"),
  showImage: z.boolean().default(true),
  showVariantSelector: z.boolean().default(true),
  showQuantity: z.boolean().default(true),
  showPrice: z.boolean().default(true),
  maxQuantity: z.number().int().min(1).max(999).default(10),
});

export const offersElementSchema = z.object({
  ...base,
  type: z.literal("quantity_offers"),
  title: shortText.default("Choisissez votre offre"),
});

export const upsellElementSchema = z.object({
  ...base,
  type: z.literal("upsells"),
  title: shortText.default(""),
});

export const shippingElementSchema = z.object({
  ...base,
  type: z.literal("shipping"),
  title: shortText.default("Mode de livraison"),
});

export const summaryElementSchema = z.object({
  ...base,
  type: z.literal("summary"),
  subtotalLabel: shortText.default("Sous-total"),
  shippingLabel: shortText.default("Livraison"),
  discountLabel: shortText.default("Réduction"),
  totalLabel: shortText.default("Total"),
  freeLabel: shortText.default("Gratuite"),
});

export const discountElementSchema = z.object({
  ...base,
  type: z.literal("discount_code"),
  label: shortText.default("Code promo"),
  placeholder: shortText.default("Entrez votre code"),
  buttonText: shortText.default("Appliquer"),
});

export const submitElementSchema = z.object({
  ...base,
  type: z.literal("submit"),
  text: shortText.default("Acheter maintenant - {total}"),
  subtext: shortText.default("Paiement à la livraison"),
});

export const dividerElementSchema = z.object({
  ...base,
  type: z.literal("divider"),
  color: color.nullable().default(null),
});

export const spacerElementSchema = z.object({
  ...base,
  type: z.literal("spacer"),
  height: z.number().int().min(0).max(200).default(16),
});

export const elementSchema = z.discriminatedUnion("type", [
  fieldElementSchema,
  headingElementSchema,
  textElementSchema,
  imageElementSchema,
  countdownElementSchema,
  cartElementSchema,
  offersElementSchema,
  upsellElementSchema,
  shippingElementSchema,
  summaryElementSchema,
  discountElementSchema,
  submitElementSchema,
  dividerElementSchema,
  spacerElementSchema,
]);

export type FormElement = z.infer<typeof elementSchema>;
export type FieldElement = z.infer<typeof fieldElementSchema>;
export type ElementType = FormElement["type"];

export const designSchema = z.object({
  template: z.enum(["classic", "modern", "minimal", "bold"]).default("modern"),
  direction: z.enum(["ltr", "rtl"]).default("ltr"),
  fontFamily: z.string().max(120).default("inherit"),
  fontSize: z.number().int().min(10).max(24).default(14),
  textColor: color.default("#1f2937"),
  labelColor: color.default("#374151"),
  labelBold: z.boolean().default(true),
  labelItalic: z.boolean().default(false),
  showLabels: z.boolean().default(true),
  background: color.default("#ffffff"),
  borderColor: color.default("#e5e7eb"),
  borderWidth: z.number().int().min(0).max(10).default(1),
  borderRadius: z.number().int().min(0).max(40).default(12),
  shadow: z.enum(["none", "sm", "md", "lg"]).default("sm"),
  padding: z.number().int().min(0).max(60).default(16),
  spacing: z.number().int().min(0).max(40).default(12),
  maxWidth: z.number().int().min(280).max(1200).default(560),
  fieldBackground: color.default("#ffffff"),
  fieldTextColor: color.default("#111827"),
  fieldBorderColor: color.default("#d1d5db"),
  fieldBorderWidth: z.number().int().min(0).max(6).default(1),
  fieldRadius: z.number().int().min(0).max(30).default(8),
  fieldHeight: z.number().int().min(32).max(72).default(44),
  focusColor: color.default("#2563eb"),
  iconColor: color.default("#6b7280"),
  errorColor: color.default("#dc2626"),
  accentColor: color.default("#2563eb"),
  buttonBackground: color.default("#111827"),
  buttonTextColor: color.default("#ffffff"),
  buttonRadius: z.number().int().min(0).max(40).default(10),
  buttonFontSize: z.number().int().min(12).max(28).default(17),
  buttonBold: z.boolean().default(true),
  buttonHeight: z.number().int().min(36).max(90).default(54),
  buttonBorderColor: color.default("#111827"),
  buttonBorderWidth: z.number().int().min(0).max(6).default(0),
  buttonAnimation: z.enum(["none", "pulse", "shake", "bounce", "glow"]).default("pulse"),
  overlayColor: color.default("#00000099"),
});
export type FormDesign = z.infer<typeof designSchema>;

export const messagesSchema = z.object({
  required: shortText.default("Ce champ est obligatoire"),
  invalidPhone: shortText.default("Numéro de téléphone invalide"),
  invalidEmail: shortText.default("Adresse e-mail invalide"),
  tooShort: shortText.default("Valeur trop courte"),
  tooLong: shortText.default("Valeur trop longue"),
  submitting: shortText.default("Envoi en cours…"),
  submitError: shortText.default("Une erreur est survenue. Veuillez réessayer."),
  blocked: shortText.default("Nous ne pouvons pas accepter cette commande. Contactez-nous."),
  limitReached: shortText.default("Vous avez atteint le nombre maximal de commandes autorisé. Réessayez plus tard."),
  outOfStock: shortText.default("Ce produit est en rupture de stock"),
  successTitle: shortText.default("Merci pour votre commande !"),
  successText: longText.default("Votre commande {order_name} a bien été enregistrée. Nous vous appellerons pour la confirmer."),
  otpTitle: shortText.default("Vérification du numéro"),
  otpText: shortText.default("Saisissez le code reçu par SMS"),
  otpInvalid: shortText.default("Code incorrect"),
  discountInvalid: shortText.default("Code promo invalide"),
  discountApplied: shortText.default("Code promo appliqué"),
});
export type FormMessages = z.infer<typeof messagesSchema>;

export const settingsSchema = z.object({
  mode: z.enum(["embedded", "popup"]).default("popup"),
  /** Texte du bouton qui ouvre la popup (mode popup). */
  openButtonText: shortText.default("Commander - Paiement à la livraison"),
  openButtonSubtext: shortText.default(""),
  hideAddToCart: z.boolean().default(false),
  hideBuyNow: z.boolean().default(true),
  stickyButton: z
    .object({
      enabled: z.boolean().default(true),
      mobileOnly: z.boolean().default(true),
      text: shortText.default("Commander maintenant"),
      position: z.enum(["bottom", "top"]).default("bottom"),
    })
    .default({}),
  countries: z.array(z.string().length(2)).max(250).default(["CI"]),
  defaultCountry: z.string().length(2).default("CI"),
  outOfStock: z.enum(["disable", "hide", "allow"]).default("disable"),
  redirect: z
    .object({
      type: z.enum(["message", "order_status", "url"]).default("message"),
      url: z.string().url().max(2000).or(z.literal("")).default(""),
    })
    .default({}),
  autocomplete: z.boolean().default(true),
  /** Ouvre la popup de downsell quand le client ferme le formulaire. */
  downsellOnClose: z.boolean().default(true),
  /** Sélecteur CSS de boutons du thème qui doivent ouvrir le formulaire. */
  triggerSelector: z.string().max(300).default(""),
});
export type FormSettings = z.infer<typeof settingsSchema>;

export const customCssSchema = z.object({
  enabled: z.boolean().default(false),
  css: z.string().max(50_000).default(""),
});

export const formConfigSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  settings: settingsSchema.default({}),
  design: designSchema.default({}),
  messages: messagesSchema.default({}),
  customCss: customCssSchema.default({}),
  elements: z.array(elementSchema).max(80),
});
export type FormConfig = z.infer<typeof formConfigSchema>;

/** Vérifie les invariants qui ne s'expriment pas en Zod simple. */
export function checkFormInvariants(config: FormConfig): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const el of config.elements) {
    if (ids.has(el.id)) errors.push(`Identifiant d'élément dupliqué : ${el.id}`);
    ids.add(el.id);
    if (el.type === "field") {
      if (keys.has(el.key)) errors.push(`Clé de champ dupliquée : ${el.key}`);
      keys.add(el.key);
      if (["select", "radio", "multi_choice"].includes(el.input) && el.options.length === 0) {
        errors.push(`Le champ « ${el.label || el.key} » doit avoir au moins une option`);
      }
    }
  }
  const phone = config.elements.find((e) => e.type === "field" && e.input === "phone");
  if (!phone) errors.push("Le formulaire doit contenir un champ Téléphone");
  if (!config.elements.some((e) => e.type === "submit")) errors.push("Le formulaire doit contenir un bouton de commande");
  for (const el of config.elements) {
    if (el.condition && !keys.has(el.condition.fieldKey)) {
      errors.push(`Condition de « ${el.id} » : champ inconnu ${el.condition.fieldKey}`);
    }
  }
  return errors;
}

export function parseFormConfig(input: unknown):
  | { ok: true; config: FormConfig }
  | { ok: false; errors: string[] } {
  const r = formConfigSchema.safeParse(input);
  if (!r.success) {
    return { ok: false, errors: r.error.issues.map((i) => `${i.path.join(".")} : ${i.message}`) };
  }
  const inv = checkFormInvariants(r.data);
  if (inv.length) return { ok: false, errors: inv };
  return { ok: true, config: r.data };
}

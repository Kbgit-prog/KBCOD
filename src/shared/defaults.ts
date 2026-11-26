import type { ElementType, FieldElement, FormConfig, FormElement, InputType } from "./form-schema";
import { formConfigSchema } from "./form-schema";

let counter = 0;
export function newId(prefix = "el"): string {
  counter = (counter + 1) % 1_000_000;
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rnd}${counter}`;
}

export const INPUT_LABELS: Record<InputType, string> = {
  first_name: "Prénom",
  last_name: "Nom",
  full_name: "Nom complet",
  phone: "Téléphone",
  phone_secondary: "Téléphone secondaire",
  email: "E-mail",
  address: "Adresse",
  address2: "Complément d'adresse",
  city: "Ville",
  province: "Région / Province",
  zip: "Code postal",
  country: "Pays",
  note: "Note de commande",
  text: "Texte libre",
  textarea: "Zone de texte",
  number: "Nombre",
  date: "Date",
  select: "Liste déroulante",
  radio: "Choix unique",
  checkbox: "Case à cocher",
  multi_choice: "Choix multiples",
  marketing_consent: "Accepter le marketing",
  terms: "Accepter les conditions",
};

export const ELEMENT_LABELS: Record<ElementType, string> = {
  field: "Champ",
  heading: "Titre",
  text: "Texte",
  image: "Image",
  countdown: "Compte à rebours",
  cart: "Contenu du panier",
  quantity_offers: "Offres de quantité",
  upsells: "Upsells 1-Tick",
  shipping: "Options de livraison",
  summary: "Résumé de commande",
  discount_code: "Code promo",
  submit: "Bouton de commande",
  divider: "Séparateur",
  spacer: "Espace",
};

const AUTO_KEY: Partial<Record<InputType, string>> = {
  first_name: "first_name",
  last_name: "last_name",
  full_name: "full_name",
  phone: "phone",
  phone_secondary: "phone_secondary",
  email: "email",
  address: "address",
  address2: "address2",
  city: "city",
  province: "province",
  zip: "zip",
  country: "country",
  note: "note",
  marketing_consent: "marketing_consent",
  terms: "terms",
};

export function createField(input: InputType, existingKeys: Set<string> = new Set()): FieldElement {
  let key = AUTO_KEY[input] ?? `custom_${input}`;
  if (existingKeys.has(key)) {
    let i = 2;
    while (existingKeys.has(`${key}_${i}`)) i++;
    key = `${key}_${i}`;
  }
  const label = INPUT_LABELS[input];
  const required = ["phone", "full_name", "first_name", "address", "city", "terms"].includes(input);
  const options = ["select", "radio", "multi_choice"].includes(input) ? ["Option 1", "Option 2"] : [];
  return {
    id: newId("f"),
    type: "field",
    visible: true,
    condition: null,
    input,
    key,
    label,
    placeholder: input === "phone" ? "07 00 00 00 00" : label,
    required,
    errorMessage: "",
    defaultValue: "",
    options,
    minLength: null,
    maxLength: null,
    width: "full",
    icon: true,
    phoneCountry: null,
    phoneInternational: true,
  };
}

export function createElement(type: ElementType, existingKeys?: Set<string>): FormElement {
  if (type === "field") return createField("text", existingKeys);
  const parsed = formConfigSchema.shape.elements.element.parse({ id: newId(type.slice(0, 3)), type });
  return parsed;
}

export function defaultFormConfig(): FormConfig {
  const keys = new Set<string>();
  const f = (i: InputType, patch: Partial<FieldElement> = {}) => {
    const el = { ...createField(i, keys), ...patch };
    keys.add(el.key);
    return el;
  };
  return formConfigSchema.parse({
    elements: [
      createElement("heading"),
      createElement("cart"),
      createElement("quantity_offers"),
      f("full_name", { placeholder: "Votre nom complet" }),
      f("phone", { placeholder: "Votre numéro de téléphone" }),
      f("city", { placeholder: "Votre ville / commune" }),
      f("address", { placeholder: "Quartier, rue, repère…", required: true }),
      createElement("shipping"),
      createElement("upsells"),
      createElement("summary"),
      createElement("submit"),
    ],
  });
}

import type { FieldElement, FormConfig, FormElement } from "../../shared/form-schema";
import { getCountryCallingCode, type CountryCode } from "libphonenumber-js";
import { normalizeEmail, normalizePhone } from "./fraud";

export type FieldValues = Record<string, string | boolean | string[]>;

export function asText(v: FieldValues[string] | undefined): string {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? "oui" : "non";
  return v.trim();
}

/** Évalue la condition d'affichage d'un élément. */
export function isVisible(el: FormElement, values: FieldValues): boolean {
  if (!el.visible) return false;
  const c = el.condition;
  if (!c) return true;
  const raw = values[c.fieldKey];
  const v = asText(raw).toLowerCase();
  const target = c.value.trim().toLowerCase();
  switch (c.operator) {
    case "equals":
      return Array.isArray(raw) ? raw.some((x) => x.toLowerCase() === target) : v === target;
    case "not_equals":
      return v !== target;
    case "contains":
      return v.includes(target);
    case "filled":
      return v !== "" && v !== "non";
    case "empty":
      return v === "" || v === "non";
  }
}

export interface ValidatedFields {
  values: Record<string, string | boolean | string[]>;
  errors: Record<string, string>;
  phone: { e164: string; callingCode: string } | null;
  email: string | null;
  fields: FieldElement[];
}

/** Validation serveur des champs selon la configuration du formulaire (ne fait jamais confiance au navigateur). */
export function validateFields(config: FormConfig, input: FieldValues, defaultCountry: string): ValidatedFields {
  const errors: Record<string, string> = {};
  const values: ValidatedFields["values"] = {};
  const m = config.messages;
  let phone: ValidatedFields["phone"] = null;
  let email: string | null = null;
  const fields = config.elements.filter((e): e is FieldElement => e.type === "field");
  for (const f of fields) {
    if (!isVisible(f, input)) continue;
    const raw = input[f.key];
    const msg = (fallback: string) => f.errorMessage || fallback;
    if (f.input === "checkbox" || f.input === "marketing_consent" || f.input === "terms") {
      const checked = raw === true || raw === "true" || raw === "on";
      if (f.required && !checked) errors[f.key] = msg(m.required);
      values[f.key] = checked;
      continue;
    }
    if (f.input === "multi_choice") {
      const arr = Array.isArray(raw) ? raw.filter((x) => f.options.includes(x)) : [];
      if (f.required && arr.length === 0) errors[f.key] = msg(m.required);
      values[f.key] = arr;
      continue;
    }
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) {
      if (f.required) errors[f.key] = msg(m.required);
      continue;
    }
    if (f.minLength && text.length < f.minLength) errors[f.key] = msg(m.tooShort);
    if ((f.maxLength && text.length > f.maxLength) || text.length > 2000) errors[f.key] = msg(m.tooLong);
    if ((f.input === "select" || f.input === "radio") && !f.options.includes(text)) errors[f.key] = msg(m.required);
    if (f.input === "phone" || f.input === "phone_secondary") {
      const p = normalizePhone(text, f.phoneCountry ?? defaultCountry);
      const country = (f.phoneCountry ?? defaultCountry).toUpperCase();
      if (!p) errors[f.key] = msg(m.invalidPhone);
      else if (!f.phoneInternational && p.callingCode !== callingCodeOf(country)) errors[f.key] = msg(m.invalidPhone);
      else {
        values[f.key] = p.e164;
        if (f.input === "phone" && !phone) phone = p;
        continue;
      }
    }
    if (f.input === "email") {
      const e = normalizeEmail(text);
      if (!e) errors[f.key] = msg(m.invalidEmail);
      else {
        values[f.key] = e;
        email = email ?? e;
        continue;
      }
    }
    if (f.input === "number" && !/^-?\d+([.,]\d+)?$/.test(text)) errors[f.key] = msg(m.required);
    if (f.input === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(text)) errors[f.key] = msg(m.required);
    if (f.input === "country" && !/^[A-Za-z]{2}$/.test(text)) errors[f.key] = msg(m.required);
    values[f.key] = f.input === "country" ? text.toUpperCase() : text;
  }
  if (!phone && !errors.phone && fields.some((f) => f.input === "phone" && isVisible(f, input))) {
    const pf = fields.find((f) => f.input === "phone")!;
    errors[pf.key] = errors[pf.key] ?? (pf.errorMessage || m.invalidPhone);
  }
  return { values, errors, phone, email, fields };
}

function callingCodeOf(country: string): string | null {
  try {
    return getCountryCallingCode(country as CountryCode);
  } catch {
    return null;
  }
}

export interface CustomerInfo {
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  phone: string | null;
  email: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  zip: string | null;
  countryCode: string;
  note: string | null;
  acceptsMarketing: boolean;
  /** Champs personnalisés : libellé → valeur. */
  extra: { key: string; label: string; value: string }[];
}

const STANDARD = new Set(["first_name", "last_name", "full_name", "phone", "email", "address", "address2", "city", "province", "zip", "country", "note", "marketing_consent"]);

export function extractCustomer(v: ValidatedFields, defaultCountry: string): CustomerInfo {
  const byInput = (input: string) => {
    const f = v.fields.find((x) => x.input === input && v.values[x.key] !== undefined);
    return f ? v.values[f.key] : undefined;
  };
  const t = (input: string) => {
    const x = byInput(input);
    return typeof x === "string" && x ? x : null;
  };
  let firstName = t("first_name");
  let lastName = t("last_name");
  const fullName = t("full_name");
  if (fullName && !firstName && !lastName) {
    const parts = fullName.split(/\s+/);
    firstName = parts.shift() ?? null;
    lastName = parts.join(" ") || null;
  }
  const extra = v.fields
    .filter((f) => !STANDARD.has(f.input) && v.values[f.key] !== undefined)
    .map((f) => ({ key: f.key, label: f.label || f.key, value: asText(v.values[f.key]) }));
  return {
    firstName,
    lastName,
    fullName: fullName ?? ([firstName, lastName].filter(Boolean).join(" ") || null),
    phone: v.phone?.e164 ?? null,
    email: v.email,
    address1: t("address"),
    address2: t("address2"),
    city: t("city"),
    province: t("province"),
    zip: t("zip"),
    countryCode: (t("country") ?? defaultCountry).toUpperCase(),
    note: t("note"),
    acceptsMarketing: byInput("marketing_consent") === true,
    extra,
  };
}

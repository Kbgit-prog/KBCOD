import { defaultFormConfig } from "../../shared/defaults";
import { parseFormConfig, type FormConfig } from "../../shared/form-schema";
import { offerConfigSchemas, type OfferType, type PublicOffer } from "../../shared/offers-schema";
import { validateCustomCss } from "../../shared/css-validate";
import { sql } from "../db";
import { env } from "../env";
import { log } from "../lib/log";
import { shopClient, shopSettings, type ShopRow } from "./shops";

export interface FormRow {
  id: string;
  shop_id: string;
  name: string;
  is_default: boolean;
  active: boolean;
  config: FormConfig;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export class ValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join(" ; "));
  }
}

export function validateConfig(input: unknown): FormConfig {
  const r = parseFormConfig(input);
  if (!r.ok) throw new ValidationError(r.errors);
  if (r.config.customCss.enabled && r.config.customCss.css) {
    const v = validateCustomCss(r.config.customCss.css);
    if (!v.ok) throw new ValidationError(v.errors.map((e) => `CSS ligne ${e.line} : ${e.message}`));
  }
  return r.config;
}

export async function listForms(shopId: string) {
  const forms = await sql()<FormRow[]>`SELECT * FROM forms WHERE shop_id = ${shopId} AND deleted_at IS NULL ORDER BY is_default DESC, created_at`;
  const products = await sql()<{ form_id: string; product_id: string; product_title: string | null }[]>`
    SELECT form_id, product_id, product_title FROM form_products WHERE shop_id = ${shopId}`;
  return forms.map((f) => ({ ...f, products: products.filter((p) => p.form_id === f.id) }));
}

export async function getForm(shopId: string, formId: string): Promise<FormRow | null> {
  const [f] = await sql()<FormRow[]>`SELECT * FROM forms WHERE id = ${formId} AND shop_id = ${shopId} AND deleted_at IS NULL`;
  return f ?? null;
}

export async function ensureDefaultForm(shopId: string): Promise<FormRow> {
  const [existing] = await sql()<FormRow[]>`SELECT * FROM forms WHERE shop_id = ${shopId} AND is_default AND deleted_at IS NULL`;
  if (existing) return existing;
  const config = defaultFormConfig();
  const [row] = await sql()<FormRow[]>`
    INSERT INTO forms (shop_id, name, is_default, config) VALUES (${shopId}, 'Formulaire principal', true, ${sql().json(config as any)})
    ON CONFLICT DO NOTHING RETURNING *`;
  if (row) {
    await sql()`INSERT INTO form_versions (shop_id, form_id, version, config, note) VALUES (${shopId}, ${row.id}, 1, ${sql().json(config as any)}, 'Création')`;
    return row;
  }
  const [again] = await sql()<FormRow[]>`SELECT * FROM forms WHERE shop_id = ${shopId} AND is_default AND deleted_at IS NULL`;
  return again!;
}

export async function createForm(shopId: string, name: string, config?: unknown): Promise<FormRow> {
  const cfg = config ? validateConfig(config) : defaultFormConfig();
  const [row] = await sql()<FormRow[]>`INSERT INTO forms (shop_id, name, config) VALUES (${shopId}, ${name}, ${sql().json(cfg as any)}) RETURNING *`;
  await sql()`INSERT INTO form_versions (shop_id, form_id, version, config, note) VALUES (${shopId}, ${row!.id}, 1, ${sql().json(cfg as any)}, 'Création')`;
  return row!;
}

/** Enregistre une nouvelle version (verrou optimiste sur `expectedVersion`). */
export async function saveForm(
  shopId: string,
  formId: string,
  patch: { name?: string; active?: boolean; config?: unknown; expectedVersion?: number; note?: string },
): Promise<FormRow> {
  return sql().begin(async (tx) => {
    const [cur] = await tx<FormRow[]>`SELECT * FROM forms WHERE id = ${formId} AND shop_id = ${shopId} AND deleted_at IS NULL FOR UPDATE`;
    if (!cur) throw new ValidationError(["Formulaire introuvable"]);
    if (patch.expectedVersion !== undefined && patch.expectedVersion !== cur.version) {
      throw new ValidationError(["Le formulaire a été modifié ailleurs. Rechargez la page avant d'enregistrer."]);
    }
    if (patch.active === false && cur.is_default) throw new ValidationError(["Le formulaire principal ne peut pas être désactivé"]);
    const config = patch.config !== undefined ? validateConfig(patch.config) : cur.config;
    const version = patch.config !== undefined ? cur.version + 1 : cur.version;
    const [row] = await tx<FormRow[]>`UPDATE forms SET name = ${patch.name ?? cur.name}, active = ${patch.active ?? cur.active},
      config = ${tx.json(config as any)}, version = ${version}, updated_at = now()
      WHERE id = ${formId} AND shop_id = ${shopId} RETURNING *`;
    if (patch.config !== undefined) {
      await tx`INSERT INTO form_versions (shop_id, form_id, version, config, note)
        VALUES (${shopId}, ${formId}, ${version}, ${tx.json(config as any)}, ${patch.note ?? null})`;
      // Conserver les 50 dernières versions.
      await tx`DELETE FROM form_versions WHERE form_id = ${formId} AND version <= ${version - 50}`;
    }
    return row!;
  });
}

export async function duplicateForm(shopId: string, formId: string): Promise<FormRow> {
  const f = await getForm(shopId, formId);
  if (!f) throw new ValidationError(["Formulaire introuvable"]);
  return createForm(shopId, `${f.name} (copie)`.slice(0, 120), f.config);
}

export async function deleteForm(shopId: string, formId: string): Promise<void> {
  const f = await getForm(shopId, formId);
  if (!f) throw new ValidationError(["Formulaire introuvable"]);
  if (f.is_default) throw new ValidationError(["Le formulaire principal ne peut pas être supprimé"]);
  await sql().begin(async (tx) => {
    await tx`DELETE FROM form_products WHERE form_id = ${formId} AND shop_id = ${shopId}`;
    await tx`UPDATE forms SET deleted_at = now(), active = false WHERE id = ${formId} AND shop_id = ${shopId}`;
  });
}

export async function setDefaultForm(shopId: string, formId: string): Promise<void> {
  await sql().begin(async (tx) => {
    const [f] = await tx`SELECT id FROM forms WHERE id = ${formId} AND shop_id = ${shopId} AND deleted_at IS NULL AND active`;
    if (!f) throw new ValidationError(["Formulaire introuvable ou inactif"]);
    await tx`UPDATE forms SET is_default = false WHERE shop_id = ${shopId} AND is_default`;
    await tx`UPDATE forms SET is_default = true WHERE id = ${formId} AND shop_id = ${shopId}`;
  });
}

export async function listVersions(shopId: string, formId: string) {
  return sql()`SELECT version, note, created_at FROM form_versions WHERE shop_id = ${shopId} AND form_id = ${formId} ORDER BY version DESC LIMIT 50`;
}

export async function restoreVersion(shopId: string, formId: string, version: number): Promise<FormRow> {
  const [v] = await sql()<{ config: FormConfig }[]>`SELECT config FROM form_versions WHERE shop_id = ${shopId} AND form_id = ${formId} AND version = ${version}`;
  if (!v) throw new ValidationError(["Version introuvable"]);
  return saveForm(shopId, formId, { config: v.config, note: `Restauration de la version ${version}` });
}

export async function assignProducts(shopId: string, formId: string, products: { id: string; title?: string }[]): Promise<void> {
  const f = await getForm(shopId, formId);
  if (!f) throw new ValidationError(["Formulaire introuvable"]);
  await sql().begin(async (tx) => {
    await tx`DELETE FROM form_products WHERE shop_id = ${shopId} AND form_id = ${formId}`;
    for (const p of products) {
      if (!/^\d{1,20}$/.test(p.id)) throw new ValidationError([`Produit invalide : ${p.id}`]);
      // Un produit n'a qu'un formulaire : la nouvelle affectation remplace l'ancienne.
      await tx`INSERT INTO form_products (shop_id, product_id, form_id, product_title) VALUES (${shopId}, ${p.id}, ${formId}, ${p.title ?? null})
        ON CONFLICT (shop_id, product_id) DO UPDATE SET form_id = EXCLUDED.form_id, product_title = EXCLUDED.product_title`;
    }
  });
}

/** Formulaire applicable à un produit : spécifique actif, sinon principal. */
export async function resolveForm(shopId: string, productId: string | null): Promise<FormRow | null> {
  if (productId) {
    const [f] = await sql()<FormRow[]>`SELECT f.* FROM form_products fp JOIN forms f ON f.id = fp.form_id
      WHERE fp.shop_id = ${shopId} AND fp.product_id = ${productId} AND f.active AND f.deleted_at IS NULL`;
    if (f) return f;
  }
  const [d] = await sql()<FormRow[]>`SELECT * FROM forms WHERE shop_id = ${shopId} AND is_default AND deleted_at IS NULL`;
  return d ?? null;
}

// ---------- Offres ----------

export interface OfferRow {
  id: string;
  shop_id: string;
  type: OfferType;
  name: string;
  active: boolean;
  priority: number;
  config: unknown;
}

export function validateOffer(type: OfferType, config: unknown) {
  const schema = offerConfigSchemas[type];
  if (!schema) throw new ValidationError(["Type d'offre inconnu"]);
  const r = schema.safeParse(config);
  if (!r.success) throw new ValidationError(r.error.issues.map((i) => `${i.path.join(".")} : ${i.message}`));
  return r.data;
}

export async function listOffers(shopId: string): Promise<OfferRow[]> {
  return sql()<OfferRow[]>`SELECT * FROM offers WHERE shop_id = ${shopId} ORDER BY type, priority DESC, created_at`;
}

export async function upsertOffer(shopId: string, input: { id?: string; type: OfferType; name: string; active: boolean; priority?: number; config: unknown }) {
  const config = validateOffer(input.type, input.config);
  if (input.id) {
    const [row] = await sql()<OfferRow[]>`UPDATE offers SET name = ${input.name}, active = ${input.active}, priority = ${input.priority ?? 0},
      config = ${sql().json(config as any)}, updated_at = now() WHERE id = ${input.id} AND shop_id = ${shopId} RETURNING *`;
    if (!row) throw new ValidationError(["Offre introuvable"]);
    return row;
  }
  const [row] = await sql()<OfferRow[]>`INSERT INTO offers (shop_id, type, name, active, priority, config)
    VALUES (${shopId}, ${input.type}, ${input.name}, ${input.active}, ${input.priority ?? 0}, ${sql().json(config as any)}) RETURNING *`;
  return row!;
}

export async function deleteOffer(shopId: string, id: string): Promise<void> {
  await sql()`DELETE FROM offers WHERE id = ${id} AND shop_id = ${shopId}`;
}

export async function activeOffers(shopId: string): Promise<PublicOffer[]> {
  const rows = await sql()<OfferRow[]>`SELECT * FROM offers WHERE shop_id = ${shopId} AND active ORDER BY priority DESC, created_at`;
  const out: PublicOffer[] = [];
  for (const r of rows) {
    const p = offerConfigSchemas[r.type]?.safeParse(r.config);
    if (p?.success) out.push({ id: r.id, type: r.type, name: r.name, config: p.data } as PublicOffer);
  }
  return out;
}

// ---------- Publication vers le thème ----------

export async function buildStorefrontConfig(shop: ShopRow) {
  const settings = shopSettings(shop);
  const forms = await sql()<FormRow[]>`SELECT * FROM forms WHERE shop_id = ${shop.id} AND active AND deleted_at IS NULL`;
  const products = await sql()<{ product_id: string; form_id: string }[]>`SELECT product_id, form_id FROM form_products WHERE shop_id = ${shop.id}`;
  const pixels = await sql()<{ provider: string; pixel_id: string }[]>`SELECT provider, pixel_id FROM pixels WHERE shop_id = ${shop.id} AND enabled`;
  const offers = await activeOffers(shop.id);
  const def = forms.find((f) => f.is_default);
  return {
    v: 1,
    backend: env().APP_URL,
    shop: shop.shop_domain,
    currency: shop.currency,
    moneyFormat: shop.money_format,
    defaultFormId: def?.id ?? null,
    forms: Object.fromEntries(forms.map((f) => [f.id, f.config])),
    productForms: Object.fromEntries(products.filter((p) => forms.some((f) => f.id === p.form_id)).map((p) => [p.product_id, p.form_id])),
    offers,
    shippingRates: settings.orders.shippingRates.filter((r) => r.enabled),
    hasDiscountCodes: settings.orders.discountCodes.some((c) => c.enabled),
    fraud: { honeypot: settings.fraud.honeypot, turnstileSiteKey: settings.fraud.turnstile.enabled ? settings.fraud.turnstile.siteKey : "" },
    abandoned: settings.abandoned.enabled,
    tracking: {
      pixels: pixels.map((p) => ({ provider: p.provider, id: p.pixel_id })),
      submitEvent: settings.tracking.submitEvent === "Custom" ? settings.tracking.submitCustomName : settings.tracking.submitEvent,
      submitIsCustom: settings.tracking.submitEvent === "Custom",
      initiateCheckout: settings.tracking.initiateCheckout,
      pageView: settings.tracking.sendPageView,
    },
    publishedAt: new Date().toISOString(),
  };
}

const METAFIELD_LIMIT = 120_000;

/** Écrit la configuration dans un métachamp de l'installation de l'app (lu par l'extension de thème). */
export async function publishConfig(shop: ShopRow): Promise<{ bytes: number; inline: boolean }> {
  if (!shop.app_installation_gid) throw new Error("Installation inconnue : rouvrez l'application");
  const cfg = await buildStorefrontConfig(shop);
  let value = JSON.stringify(cfg);
  const inline = value.length <= METAFIELD_LIMIT;
  if (!inline) value = JSON.stringify({ v: 1, backend: env().APP_URL, shop: shop.shop_domain, remote: true });
  const client = await shopClient(shop);
  const data = await client.request<{ metafieldsSet: { userErrors: { field: string[]; message: string }[] } }>(
    `#graphql
    mutation KbPublish($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message } }
    }`,
    { metafields: [{ ownerId: shop.app_installation_gid, namespace: "kbcod", key: "config", type: "json", value }] },
  );
  const errs = data.metafieldsSet.userErrors;
  if (errs.length) throw new Error(`Publication refusée : ${errs.map((e) => e.message).join(", ")}`);
  log("info", "config.published", { shop: shop.shop_domain, bytes: value.length, inline });
  return { bytes: value.length, inline };
}

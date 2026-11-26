import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useRef, useState } from "react";
import { createElement, createField, defaultFormConfig, ELEMENT_LABELS, INPUT_LABELS, newId } from "../../shared/defaults";
import { designSchema, formConfigSchema, INPUT_TYPES, parseFormConfig, type ElementType, type FieldElement, type FormConfig, type FormElement, type InputType } from "../../shared/form-schema";
import type { PublicOffer, ShippingRate } from "../../shared/offers-schema";
import { validateCustomCss } from "../../shared/css-validate";
import { KbForm, type ProductData } from "../../storefront/renderer";
import { Badge, Card, Color, Num, Select, Text, Toggle, date, useAction, useLoad } from "../components/ui";
import { api, pickProducts } from "../lib/api";
import type { PageProps } from "../lib/types";

export interface FormRecord {
  id: string;
  name: string;
  is_default: boolean;
  active: boolean;
  config: FormConfig;
  version: number;
  products: { product_id: string; product_title: string | null }[];
}

const SAMPLE: ProductData = {
  id: "0",
  title: "Produit exemple",
  image: null,
  selectedVariantId: "1",
  variants: [
    { id: "1", title: "Noir", price: 1500000, compareAtPrice: 2000000, available: true, image: null },
    { id: "2", title: "Blanc", price: 1500000, compareAtPrice: null, available: true, image: null },
  ],
};

const COUNTRIES = ["CI", "SN", "ML", "BF", "TG", "BJ", "NE", "GN", "CM", "GA", "CG", "CD", "MA", "DZ", "TN", "FR", "BE", "CH", "CA", "US", "GH", "NG"];

function Preview({ config, formId, offers, shippingRates, moneyFormat, currency, device, popup }: {
  config: FormConfig;
  formId: string;
  offers: PublicOffer[];
  shippingRates: ShippingRate[];
  moneyFormat: string;
  currency: string;
  device: "mobile" | "desktop";
  popup: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const form = useRef<KbForm | null>(null);
  const parsed = useMemo(() => formConfigSchema.safeParse(config), [config]);
  useEffect(() => {
    if (!host.current || !parsed.success) return;
    const opts = {
      config: parsed.data,
      formId,
      product: SAMPLE,
      offers: offers.map((o) => (o.type === "quantity" || o.type === "upsell" || o.type === "downsell" ? { ...o, config: { ...(o.config as any), productIds: [], triggerProductIds: [] } } : o)) as PublicOffer[],
      shippingRates,
      hasDiscountCodes: true,
      moneyFormat,
      currency,
      mode: "preview" as const,
      previewOpen: popup && parsed.data.settings.mode === "popup",
    };
    if (!form.current) form.current = new KbForm(host.current, opts);
    else form.current.update(opts);
  }, [parsed, offers, shippingRates, popup, formId, moneyFormat, currency]);
  useEffect(() => () => form.current?.destroy(), []);
  return (
    <div className={`preview ${device}`}>
      {!parsed.success && <div className="banner err">Configuration invalide : {parsed.error.issues[0]?.message}</div>}
      <div ref={host} />
    </div>
  );
}

function SortableItem({ el, selected, onSelect, onToggle, onDuplicate, onRemove }: {
  el: FormElement;
  selected: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: el.id });
  const label = el.type === "field" ? `${el.label || INPUT_LABELS[el.input]}${el.required ? " *" : ""}` : ELEMENT_LABELS[el.type];
  const kind = el.type === "field" ? INPUT_LABELS[el.input] : "";
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`el-item${selected ? " sel" : ""}${el.visible ? "" : " hidden"}`} onClick={onSelect}>
      <span className="grip" {...attributes} {...listeners} title="Glisser pour déplacer" aria-label="Déplacer">
        ⋮⋮
      </span>
      <span className="name">
        {label}
        {kind && kind !== label.replace(" *", "") && <span className="muted small"> · {kind}</span>}
        {el.condition && <span className="muted small"> · conditionnel</span>}
      </span>
      <button className="icon-btn" title={el.visible ? "Masquer" : "Afficher"} onClick={(e) => (e.stopPropagation(), onToggle())}>
        {el.visible ? "👁" : "◌"}
      </button>
      <button className="icon-btn" title="Dupliquer" onClick={(e) => (e.stopPropagation(), onDuplicate())}>
        ⧉
      </button>
      <button className="icon-btn" title="Supprimer" onClick={(e) => (e.stopPropagation(), onRemove())}>
        ✕
      </button>
    </div>
  );
}

function ElementEditor({ el, fields, onChange }: { el: FormElement; fields: FieldElement[]; onChange: (e: FormElement) => void }) {
  const set = (patch: Partial<FormElement>) => onChange({ ...el, ...patch } as FormElement);
  const condition = (
    <details style={{ marginTop: 8 }}>
      <summary className="small">Affichage conditionnel {el.condition ? <Badge tone="info">actif</Badge> : null}</summary>
      <div className="stack" style={{ marginTop: 8 }}>
        <Toggle label="Afficher seulement si une condition est remplie" checked={Boolean(el.condition)} onChange={(v) => set({ condition: v ? { fieldKey: fields.find((f) => f.id !== el.id)?.key ?? "", operator: "equals", value: "" } : null })} />
        {el.condition && (
          <div className="grid3">
            <Select label="Champ" value={el.condition.fieldKey} onChange={(v) => set({ condition: { ...el.condition!, fieldKey: v } })} options={fields.filter((f) => f.id !== el.id).map((f) => ({ value: f.key, label: f.label || f.key }))} />
            <Select
              label="Opérateur"
              value={el.condition.operator}
              onChange={(v) => set({ condition: { ...el.condition!, operator: v } })}
              options={[
                { value: "equals", label: "est égal à" },
                { value: "not_equals", label: "est différent de" },
                { value: "contains", label: "contient" },
                { value: "filled", label: "est rempli / coché" },
                { value: "empty", label: "est vide / non coché" },
              ]}
            />
            {!["filled", "empty"].includes(el.condition.operator) && <Text label="Valeur" value={el.condition.value} onChange={(v) => set({ condition: { ...el.condition!, value: v } })} />}
          </div>
        )}
      </div>
    </details>
  );
  switch (el.type) {
    case "field": {
      const hasOptions = ["select", "radio", "multi_choice"].includes(el.input);
      return (
        <div className="stack">
          <Select label="Type de champ" value={el.input} onChange={(v) => set({ input: v as InputType })} options={INPUT_TYPES.map((t) => ({ value: t, label: INPUT_LABELS[t] }))} />
          <Text label="Libellé" value={el.label} onChange={(v) => set({ label: v })} />
          {!["checkbox", "terms", "marketing_consent", "radio", "multi_choice"].includes(el.input) && <Text label="Texte indicatif (placeholder)" value={el.placeholder} onChange={(v) => set({ placeholder: v })} />}
          <Text label="Clé technique" value={el.key} onChange={(v) => set({ key: v.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 64) })} hint="Utilisée pour Google Sheets et les conditions. Minuscules, chiffres et _." />
          <div className="grid2">
            <Toggle label="Obligatoire" checked={el.required} onChange={(v) => set({ required: v })} />
            <Toggle label="Afficher l'icône" checked={el.icon} onChange={(v) => set({ icon: v })} />
          </div>
          <Select label="Largeur" value={el.width} onChange={(v) => set({ width: v })} options={[{ value: "full", label: "Pleine largeur" }, { value: "half", label: "Demi-largeur (ordinateur)" }]} />
          <Text label="Message d'erreur personnalisé" value={el.errorMessage} onChange={(v) => set({ errorMessage: v })} placeholder="Message par défaut" />
          <Text label="Valeur par défaut" value={el.defaultValue} onChange={(v) => set({ defaultValue: v })} />
          {hasOptions && (
            <Text label="Options (une par ligne)" multiline value={el.options.join("\n")} onChange={(v) => set({ options: v.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 100) })} />
          )}
          {!hasOptions && !["checkbox", "terms", "marketing_consent", "country", "date"].includes(el.input) && (
            <div className="grid2">
              <Num label="Longueur min." value={el.minLength} nullable min={0} onChange={(v) => set({ minLength: v })} />
              <Num label="Longueur max." value={el.maxLength} nullable min={1} onChange={(v) => set({ maxLength: v })} />
            </div>
          )}
          {(el.input === "phone" || el.input === "phone_secondary") && (
            <div className="grid2">
              <Select label="Pays du numéro" value={el.phoneCountry ?? ""} onChange={(v) => set({ phoneCountry: v || null })} options={[{ value: "", label: "Pays par défaut du formulaire" }, ...COUNTRIES.map((c) => ({ value: c, label: c }))]} />
              <Toggle label="Accepter les numéros d'autres pays" checked={el.phoneInternational} onChange={(v) => set({ phoneInternational: v })} />
            </div>
          )}
          {el.input === "address" && <p className="muted small">Saisie libre : aucune liste de communes n'est imposée. Ajoutez un champ « Liste déroulante » si vous voulez des choix fixes.</p>}
          {condition}
        </div>
      );
    }
    case "heading":
      return (
        <div className="stack">
          <Text label="Texte" value={el.text} onChange={(v) => set({ text: v })} hint="Variables : {total}, {product}" />
          <div className="grid3">
            <Num label="Taille (px)" value={el.size} min={10} max={48} onChange={(v) => set({ size: v ?? 20 })} />
            <Select label="Alignement" value={el.align} onChange={(v) => set({ align: v })} options={[{ value: "left", label: "Gauche" }, { value: "center", label: "Centre" }, { value: "right", label: "Droite" }]} />
            <Color label="Couleur" value={el.color} nullable onChange={(v) => set({ color: v })} />
          </div>
          {condition}
        </div>
      );
    case "text":
      return (
        <div className="stack">
          <Text label="Texte" multiline value={el.text} onChange={(v) => set({ text: v })} />
          <div className="grid2">
            <Num label="Taille (px)" value={el.size} min={10} max={32} onChange={(v) => set({ size: v ?? 14 })} />
            <Select label="Alignement" value={el.align} onChange={(v) => set({ align: v })} options={[{ value: "left", label: "Gauche" }, { value: "center", label: "Centre" }, { value: "right", label: "Droite" }]} />
            <Color label="Couleur" value={el.color} nullable onChange={(v) => set({ color: v })} />
            <Color label="Fond" value={el.background} nullable onChange={(v) => set({ background: v })} />
          </div>
          {condition}
        </div>
      );
    case "image":
      return (
        <div className="stack">
          <Text label="URL de l'image (https)" value={el.url} onChange={(v) => set({ url: v })} hint="Importez l'image dans Contenu > Fichiers de Shopify puis collez son lien." />
          <Text label="Texte alternatif" value={el.alt} onChange={(v) => set({ alt: v })} />
          <Num label="Largeur max. (px)" value={el.maxWidth} min={20} max={1200} onChange={(v) => set({ maxWidth: v ?? 600 })} />
          {condition}
        </div>
      );
    case "countdown":
      return (
        <div className="stack">
          <Text label="Texte" value={el.text} onChange={(v) => set({ text: v })} />
          <Num label="Durée (minutes)" value={el.minutes} min={1} max={10080} onChange={(v) => set({ minutes: v ?? 15 })} />
          <Select label="À la fin" value={el.onEnd} onChange={(v) => set({ onEnd: v })} options={[{ value: "restart", label: "Recommencer" }, { value: "hide", label: "Masquer" }]} />
          <div className="grid2">
            <Color label="Fond" value={el.background} nullable onChange={(v) => set({ background: v })} />
            <Color label="Texte" value={el.color} nullable onChange={(v) => set({ color: v })} />
          </div>
        </div>
      );
    case "cart":
      return (
        <div className="stack">
          <Toggle label="Afficher l'image" checked={el.showImage} onChange={(v) => set({ showImage: v })} />
          <Toggle label="Sélecteur de variante" checked={el.showVariantSelector} onChange={(v) => set({ showVariantSelector: v })} />
          <Toggle label="Sélecteur de quantité" checked={el.showQuantity} onChange={(v) => set({ showQuantity: v })} hint="Masqué automatiquement si une offre de quantité l'indique." />
          <Toggle label="Afficher le prix" checked={el.showPrice} onChange={(v) => set({ showPrice: v })} />
          <Num label="Quantité max." value={el.maxQuantity} min={1} max={999} onChange={(v) => set({ maxQuantity: v ?? 10 })} />
        </div>
      );
    case "quantity_offers":
    case "upsells":
    case "shipping":
      return (
        <div className="stack">
          <Text label="Titre de la section" value={el.title} onChange={(v) => set({ title: v })} />
          <p className="muted small">
            {el.type === "shipping" ? "Les tarifs se règlent dans « Livraison & réductions »." : "Le contenu se règle dans « Offres & Upsells ». Cet élément définit sa position dans le formulaire."}
          </p>
          {condition}
        </div>
      );
    case "summary":
      return (
        <div className="stack">
          <Text label="Libellé sous-total" value={el.subtotalLabel} onChange={(v) => set({ subtotalLabel: v })} />
          <Text label="Libellé livraison" value={el.shippingLabel} onChange={(v) => set({ shippingLabel: v })} />
          <Text label="Libellé réduction" value={el.discountLabel} onChange={(v) => set({ discountLabel: v })} />
          <Text label="Libellé total" value={el.totalLabel} onChange={(v) => set({ totalLabel: v })} />
          <Text label="Libellé livraison gratuite" value={el.freeLabel} onChange={(v) => set({ freeLabel: v })} />
        </div>
      );
    case "discount_code":
      return (
        <div className="stack">
          <Text label="Libellé" value={el.label} onChange={(v) => set({ label: v })} />
          <Text label="Placeholder" value={el.placeholder} onChange={(v) => set({ placeholder: v })} />
          <Text label="Texte du bouton" value={el.buttonText} onChange={(v) => set({ buttonText: v })} />
          <p className="muted small">Visible uniquement si au moins un code est actif (Livraison & réductions).</p>
        </div>
      );
    case "submit":
      return (
        <div className="stack">
          <Text label="Texte du bouton" value={el.text} onChange={(v) => set({ text: v })} hint="Variables : {total}, {subtotal}, {product}" />
          <Text label="Sous-texte" value={el.subtext} onChange={(v) => set({ subtext: v })} />
          <p className="muted small">Couleurs, taille et animation : onglet Design.</p>
        </div>
      );
    case "divider":
      return <Color label="Couleur" value={el.color} nullable onChange={(v) => set({ color: v })} />;
    case "spacer":
      return <Num label="Hauteur (px)" value={el.height} min={0} max={200} onChange={(v) => set({ height: v ?? 16 })} />;
  }
}

function DesignEditor({ config, onChange }: { config: FormConfig; onChange: (c: FormConfig) => void }) {
  const d = config.design;
  const set = (patch: Partial<FormConfig["design"]>) => onChange({ ...config, design: { ...d, ...patch } });
  const n = (label: string, k: keyof typeof d, min: number, max: number) => <Num label={label} value={d[k] as number} min={min} max={max} onChange={(v) => set({ [k]: v ?? min } as any)} />;
  const c = (label: string, k: keyof typeof d) => <Color label={label} value={d[k] as string} onChange={(v) => set({ [k]: v ?? "#000000" } as any)} />;
  return (
    <div className="stack">
      <div className="grid2">
        <Select label="Modèle" value={d.template} onChange={(v) => set({ template: v })} options={[{ value: "modern", label: "Moderne" }, { value: "classic", label: "Classique" }, { value: "minimal", label: "Minimal" }, { value: "bold", label: "Affirmé" }]} />
        <Select label="Direction" value={d.direction} onChange={(v) => set({ direction: v })} options={[{ value: "ltr", label: "Gauche → droite" }, { value: "rtl", label: "Droite → gauche (arabe)" }]} />
      </div>
      <h3>Texte</h3>
      <div className="grid2">
        <Text label="Police" value={d.fontFamily} onChange={(v) => set({ fontFamily: v || "inherit" })} hint="« inherit » = police du thème" />
        {n("Taille (px)", "fontSize", 10, 24)}
        {c("Couleur du texte", "textColor")}
        {c("Couleur des libellés", "labelColor")}
      </div>
      <div className="row">
        <Toggle label="Libellés visibles" checked={d.showLabels} onChange={(v) => set({ showLabels: v })} />
        <Toggle label="Gras" checked={d.labelBold} onChange={(v) => set({ labelBold: v })} />
        <Toggle label="Italique" checked={d.labelItalic} onChange={(v) => set({ labelItalic: v })} />
      </div>
      <h3>Formulaire</h3>
      <div className="grid2">
        {c("Arrière-plan", "background")}
        {c("Bordure", "borderColor")}
        {n("Épaisseur bordure", "borderWidth", 0, 10)}
        {n("Arrondi", "borderRadius", 0, 40)}
        {n("Marge intérieure", "padding", 0, 60)}
        {n("Espacement", "spacing", 0, 40)}
        {n("Largeur max.", "maxWidth", 280, 1200)}
        <Select label="Ombre" value={d.shadow} onChange={(v) => set({ shadow: v })} options={[{ value: "none", label: "Aucune" }, { value: "sm", label: "Légère" }, { value: "md", label: "Moyenne" }, { value: "lg", label: "Forte" }]} />
      </div>
      <h3>Champs</h3>
      <div className="grid2">
        {c("Fond", "fieldBackground")}
        {c("Texte", "fieldTextColor")}
        {c("Bordure", "fieldBorderColor")}
        {n("Épaisseur bordure", "fieldBorderWidth", 0, 6)}
        {n("Arrondi", "fieldRadius", 0, 30)}
        {n("Hauteur", "fieldHeight", 32, 72)}
        {c("Focus", "focusColor")}
        {c("Icônes", "iconColor")}
        {c("Erreurs", "errorColor")}
        {c("Accent (offres, cases)", "accentColor")}
      </div>
      <h3>Bouton</h3>
      <div className="grid2">
        {c("Fond", "buttonBackground")}
        {c("Texte", "buttonTextColor")}
        {c("Bordure", "buttonBorderColor")}
        {n("Épaisseur bordure", "buttonBorderWidth", 0, 6)}
        {n("Arrondi", "buttonRadius", 0, 40)}
        {n("Taille du texte", "buttonFontSize", 12, 28)}
        {n("Hauteur", "buttonHeight", 36, 90)}
        <Select label="Animation" value={d.buttonAnimation} onChange={(v) => set({ buttonAnimation: v })} options={[{ value: "none", label: "Aucune" }, { value: "pulse", label: "Pulsation" }, { value: "shake", label: "Secousse" }, { value: "bounce", label: "Rebond" }, { value: "glow", label: "Halo" }]} />
      </div>
      <Toggle label="Texte du bouton en gras" checked={d.buttonBold} onChange={(v) => set({ buttonBold: v })} />
      <h3>Popup</h3>
      {c("Voile d'arrière-plan", "overlayColor")}
      <button className="btn" onClick={() => onChange({ ...config, design: designSchema.parse({}) })}>
        Restaurer le design par défaut
      </button>
    </div>
  );
}

function SettingsEditor({ config, onChange }: { config: FormConfig; onChange: (c: FormConfig) => void }) {
  const s = config.settings;
  const set = (patch: Partial<FormConfig["settings"]>) => onChange({ ...config, settings: { ...s, ...patch } });
  return (
    <div className="stack">
      <Select label="Type de formulaire" value={s.mode} onChange={(v) => set({ mode: v })} options={[{ value: "popup", label: "Popup (bouton qui ouvre le formulaire)" }, { value: "embedded", label: "Embedded (intégré à la page produit)" }]} />
      {s.mode === "popup" && (
        <>
          <Text label="Texte du bouton d'ouverture" value={s.openButtonText} onChange={(v) => set({ openButtonText: v })} hint="Variables : {total}, {product}" />
          <Text label="Sous-texte du bouton" value={s.openButtonSubtext} onChange={(v) => set({ openButtonSubtext: v })} />
          <Toggle label="Proposer le downsell à la fermeture" checked={s.downsellOnClose} onChange={(v) => set({ downsellOnClose: v })} />
        </>
      )}
      <h3>Bouton fixe (sticky)</h3>
      <Toggle label="Activer le bouton fixe" checked={s.stickyButton.enabled} onChange={(v) => set({ stickyButton: { ...s.stickyButton, enabled: v } })} />
      {s.stickyButton.enabled && (
        <div className="grid2">
          <Text label="Texte" value={s.stickyButton.text} onChange={(v) => set({ stickyButton: { ...s.stickyButton, text: v } })} />
          <Select label="Position" value={s.stickyButton.position} onChange={(v) => set({ stickyButton: { ...s.stickyButton, position: v } })} options={[{ value: "bottom", label: "En bas" }, { value: "top", label: "En haut" }]} />
          <Toggle label="Mobile uniquement" checked={s.stickyButton.mobileOnly} onChange={(v) => set({ stickyButton: { ...s.stickyButton, mobileOnly: v } })} />
        </div>
      )}
      <h3>Boutons du thème</h3>
      <Toggle label="Masquer « Ajouter au panier »" checked={s.hideAddToCart} onChange={(v) => set({ hideAddToCart: v })} />
      <Toggle label="Masquer « Acheter maintenant » / paiement accéléré" checked={s.hideBuyNow} onChange={(v) => set({ hideBuyNow: v })} />
      <Text label="Sélecteur CSS de boutons qui ouvrent le formulaire" value={s.triggerSelector} onChange={(v) => set({ triggerSelector: v })} placeholder="#mon-bouton, .acheter" hint="Pour PageFly, GemPages… : donnez un ID ou une classe à votre bouton." />
      <h3>Pays et adresse</h3>
      <Text label="Pays desservis (codes ISO séparés par des virgules)" value={s.countries.join(", ")} onChange={(v) => set({ countries: v.split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x)) })} />
      <Text label="Pays par défaut" value={s.defaultCountry} onChange={(v) => set({ defaultCountry: v.toUpperCase().slice(0, 2) })} />
      <Toggle label="Autoriser l'autocomplétion du navigateur" checked={s.autocomplete} onChange={(v) => set({ autocomplete: v })} />
      <h3>Rupture de stock</h3>
      <Select label="Comportement" value={s.outOfStock} onChange={(v) => set({ outOfStock: v })} options={[{ value: "disable", label: "Désactiver le bouton" }, { value: "hide", label: "Masquer la variante" }, { value: "allow", label: "Autoriser la commande" }]} />
      <h3>Après la commande</h3>
      <Select label="Action" value={s.redirect.type} onChange={(v) => set({ redirect: { ...s.redirect, type: v } })} options={[{ value: "message", label: "Afficher le message de remerciement" }, { value: "order_status", label: "Page de statut de commande Shopify" }, { value: "url", label: "Rediriger vers une URL" }]} />
      {s.redirect.type === "url" && <Text label="URL" value={s.redirect.url} onChange={(v) => set({ redirect: { ...s.redirect, url: v } })} />}
    </div>
  );
}

function MessagesEditor({ config, onChange }: { config: FormConfig; onChange: (c: FormConfig) => void }) {
  const labels: Record<keyof FormConfig["messages"], string> = {
    required: "Champ obligatoire",
    invalidPhone: "Téléphone invalide",
    invalidEmail: "E-mail invalide",
    tooShort: "Valeur trop courte",
    tooLong: "Valeur trop longue",
    submitting: "Envoi en cours",
    submitError: "Erreur d'envoi",
    blocked: "Commande bloquée",
    limitReached: "Limite de commandes atteinte",
    outOfStock: "Rupture de stock",
    successTitle: "Titre de confirmation",
    successText: "Texte de confirmation ({order_name})",
    otpTitle: "Titre OTP",
    otpText: "Texte OTP",
    otpInvalid: "Code OTP incorrect",
    discountInvalid: "Code promo invalide",
    discountApplied: "Code promo appliqué",
  };
  return (
    <div className="stack">
      {(Object.keys(labels) as (keyof FormConfig["messages"])[]).map((k) => (
        <Text key={k} label={labels[k]} value={config.messages[k]} multiline={k === "successText"} onChange={(v) => onChange({ ...config, messages: { ...config.messages, [k]: v } })} />
      ))}
    </div>
  );
}

function CssEditor({ config, onChange }: { config: FormConfig; onChange: (c: FormConfig) => void }) {
  const v = useMemo(() => validateCustomCss(config.customCss.css), [config.customCss.css]);
  return (
    <div className="stack">
      <Toggle label="Activer le CSS personnalisé" checked={config.customCss.enabled} onChange={(x) => onChange({ ...config, customCss: { ...config.customCss, enabled: x } })} />
      <Text
        label="CSS (appliqué uniquement à ce formulaire)"
        multiline
        code
        value={config.customCss.css}
        onChange={(x) => onChange({ ...config, customCss: { ...config.customCss, css: x } })}
        hint={
          <>
            Le formulaire est isolé du thème (Shadow DOM). Classes utiles : <code>.kb-form</code>, <code>.kb-input</code>, <code>.kb-label</code>, <code>.kb-btn</code>, <code>.kb-tier</code>,{" "}
            <code>.kb-summary</code>, <code>.kb-modal</code>, <code>[data-kb-id="…"]</code>. JavaScript interdit.
          </>
        }
      />
      {v.ok ? <span className="badge ok">Syntaxe valide</span> : <ul className="err-list">{v.errors.slice(0, 10).map((e, i) => <li key={i}>Ligne {e.line}, col. {e.column} : {e.message}</li>)}</ul>}
    </div>
  );
}

export function FormBuilder({ form, onClose, boot }: { form: FormRecord; onClose: () => void } & PageProps) {
  const [config, setConfig] = useState<FormConfig>(() => structuredClone(form.config));
  const [name, setName] = useState(form.name);
  const [version, setVersion] = useState(form.version);
  const [tab, setTab] = useState<"elements" | "design" | "settings" | "messages" | "css" | "products" | "versions">("elements");
  const [selected, setSelected] = useState<string | null>(config.elements[0]?.id ?? null);
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const [popupOpen, setPopupOpen] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [products, setProducts] = useState(form.products);
  const offers = useLoad<{ id: string; type: string; name: string; active: boolean; config: unknown }[]>("/offers");
  const versions = useLoad<{ version: number; note: string | null; created_at: string }[]>(tab === "versions" ? `/forms/${form.id}/versions` : null, [tab]);
  const { busy, run } = useAction();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const update = (c: FormConfig) => {
    setConfig(c);
    setDirty(true);
    const r = parseFormConfig(c);
    setErrors(r.ok ? [] : r.errors);
  };
  const fields = config.elements.filter((e): e is FieldElement => e.type === "field");
  const keys = new Set(fields.map((f) => f.key));
  const sel = config.elements.find((e) => e.id === selected) ?? null;

  const add = (type: ElementType, input?: InputType) => {
    const el = type === "field" ? createField(input ?? "text", keys) : createElement(type);
    const idx = sel ? config.elements.findIndex((e) => e.id === sel.id) + 1 : config.elements.length;
    const elements = [...config.elements];
    elements.splice(idx, 0, el);
    update({ ...config, elements });
    setSelected(el.id);
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = config.elements.findIndex((x) => x.id === e.active.id);
    const to = config.elements.findIndex((x) => x.id === e.over!.id);
    update({ ...config, elements: arrayMove(config.elements, from, to) });
  };
  const save = async () => {
    const r = await run(async () => api(`/forms/${form.id}`, { method: "PUT", body: { name, config, expectedVersion: version } }), "Formulaire enregistré et publié");
    if (r) {
      setVersion((r as any).form.version);
      setDirty(false);
      if ((r as any).published?.error) setErrors([`Enregistré, mais publication vers le thème impossible : ${(r as any).published.error}`]);
    }
  };
  const publicOffers = (offers.data ?? []).filter((o) => o.active) as unknown as PublicOffer[];

  return (
    <div>
      <div className="row between" style={{ marginBottom: 12 }}>
        <div className="row">
          <button className="btn" onClick={() => (!dirty || confirm("Quitter sans enregistrer ?")) && onClose()}>
            ← Formulaires
          </button>
          <input type="text" value={name} onChange={(e) => (setName(e.target.value), setDirty(true))} style={{ width: 240 }} aria-label="Nom du formulaire" />
          {form.is_default && <Badge tone="info">Principal</Badge>}
          {dirty && <Badge tone="warn">Modifications non enregistrées</Badge>}
        </div>
        <div className="row">
          <button className="btn" onClick={() => confirm("Remplacer par la configuration par défaut ?") && update(defaultFormConfig())}>
            Réinitialiser
          </button>
          <button className="btn primary" disabled={busy || errors.length > 0} onClick={save}>
            {busy ? <span className="spinner" /> : "Enregistrer"}
          </button>
        </div>
      </div>
      {errors.length > 0 && (
        <div className="banner err">
          <ul style={{ margin: 0, paddingLeft: 18 }}>{errors.slice(0, 8).map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
      <div className="builder">
        <div className="card">
          <div className="subtabs">
            {(
              [
                ["elements", "Éléments"],
                ["design", "Design"],
                ["settings", "Paramètres"],
                ["messages", "Messages"],
                ["css", "CSS"],
                ["products", "Produits"],
                ["versions", "Versions"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
                {l}
              </button>
            ))}
          </div>
          {tab === "elements" && (
            <div className="stack">
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={config.elements.map((e) => e.id)} strategy={verticalListSortingStrategy}>
                  <div className="el-list">
                    {config.elements.map((el) => (
                      <SortableItem
                        key={el.id}
                        el={el}
                        selected={el.id === selected}
                        onSelect={() => setSelected(el.id)}
                        onToggle={() => update({ ...config, elements: config.elements.map((x) => (x.id === el.id ? { ...x, visible: !x.visible } : x)) as FormElement[] })}
                        onDuplicate={() => {
                          const copy = { ...structuredClone(el), id: newId(el.type.slice(0, 3)) } as FormElement;
                          if (copy.type === "field") copy.key = createField(copy.input, keys).key;
                          const i = config.elements.findIndex((x) => x.id === el.id);
                          const elements = [...config.elements];
                          elements.splice(i + 1, 0, copy);
                          update({ ...config, elements });
                        }}
                        onRemove={() => {
                          update({ ...config, elements: config.elements.filter((x) => x.id !== el.id) });
                          if (selected === el.id) setSelected(null);
                        }}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
              {sel && (
                <div className="card" style={{ background: "#fafafa", margin: 0 }}>
                  <h2>{sel.type === "field" ? `Champ : ${sel.label || INPUT_LABELS[sel.input]}` : ELEMENT_LABELS[sel.type]}</h2>
                  <ElementEditor el={sel} fields={fields} onChange={(n) => update({ ...config, elements: config.elements.map((x) => (x.id === n.id ? n : x)) })} />
                </div>
              )}
              <details open>
                <summary>
                  <b>Ajouter un champ client</b>
                </summary>
                <div className="lib" style={{ marginTop: 8 }}>
                  {INPUT_TYPES.map((t) => (
                    <button key={t} onClick={() => add("field", t)}>
                      + {INPUT_LABELS[t]}
                    </button>
                  ))}
                </div>
              </details>
              <details>
                <summary>
                  <b>Ajouter un bloc</b>
                </summary>
                <div className="lib" style={{ marginTop: 8 }}>
                  {(Object.keys(ELEMENT_LABELS) as ElementType[])
                    .filter((t) => t !== "field")
                    .map((t) => (
                      <button key={t} onClick={() => add(t)}>
                        + {ELEMENT_LABELS[t]}
                      </button>
                    ))}
                </div>
              </details>
            </div>
          )}
          {tab === "design" && <DesignEditor config={config} onChange={update} />}
          {tab === "settings" && <SettingsEditor config={config} onChange={update} />}
          {tab === "messages" && <MessagesEditor config={config} onChange={update} />}
          {tab === "css" && <CssEditor config={config} onChange={update} />}
          {tab === "products" && (
            <div className="stack">
              {form.is_default ? (
                <p className="muted">Formulaire principal : utilisé par tous les produits sans formulaire spécifique.</p>
              ) : (
                <p className="muted">Ce formulaire remplace le formulaire principal pour les produits ci-dessous.</p>
              )}
              {!form.is_default && (
                <>
                  <div className="row">
                    <button
                      className="btn"
                      onClick={async () => {
                        const picked = await pickProducts(true);
                        if (picked === null) return alert("Sélecteur de produits disponible uniquement dans l'administration Shopify.");
                        const merged = [...products];
                        for (const p of picked) if (!merged.some((m) => m.product_id === p.id)) merged.push({ product_id: p.id, product_title: p.title });
                        setProducts(merged);
                      }}
                    >
                      Choisir des produits
                    </button>
                    <button
                      className="btn primary"
                      disabled={busy}
                      onClick={() => run(() => api(`/forms/${form.id}/products`, { method: "PUT", body: { products: products.map((p) => ({ id: p.product_id, title: p.product_title ?? undefined })) } }), "Produits associés")}
                    >
                      Enregistrer l'association
                    </button>
                  </div>
                  <table>
                    <tbody>
                      {products.map((p) => (
                        <tr key={p.product_id}>
                          <td>{p.product_title ?? p.product_id}</td>
                          <td style={{ width: 40 }}>
                            <button className="icon-btn" onClick={() => setProducts(products.filter((x) => x.product_id !== p.product_id))}>
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                      {!products.length && (
                        <tr>
                          <td className="muted">Aucun produit associé.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}
          {tab === "versions" && (
            <div className="stack">
              <p className="muted small">Chaque enregistrement crée une version (50 conservées). La restauration crée une nouvelle version.</p>
              <table>
                <tbody>
                  {(versions.data ?? []).map((v) => (
                    <tr key={v.version}>
                      <td>v{v.version}</td>
                      <td>{date(v.created_at)}</td>
                      <td className="muted small">{v.note ?? ""}</td>
                      <td>
                        {v.version !== version && (
                          <button
                            className="btn sm"
                            onClick={async () => {
                              if (dirty && !confirm("Les modifications non enregistrées seront perdues. Continuer ?")) return;
                              const r = await run(() => api<FormRecord>(`/forms/${form.id}/restore`, { body: { version: v.version } }), `Version ${v.version} restaurée`);
                              if (r) {
                                setConfig(r.config);
                                setVersion(r.version);
                                setDirty(false);
                                void versions.reload();
                              }
                            }}
                          >
                            Restaurer
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="preview-wrap">
          <div className="row between" style={{ marginBottom: 8 }}>
            <div className="row">
              <button className={`btn sm ${device === "mobile" ? "primary" : ""}`} onClick={() => setDevice("mobile")}>
                Mobile
              </button>
              <button className={`btn sm ${device === "desktop" ? "primary" : ""}`} onClick={() => setDevice("desktop")}>
                Ordinateur
              </button>
            </div>
            {config.settings.mode === "popup" && <Toggle label="Popup ouverte" checked={popupOpen} onChange={setPopupOpen} />}
          </div>
          <Preview config={config} formId={form.id} offers={publicOffers} shippingRates={boot.settings.orders.shippingRates} moneyFormat={boot.shop.moneyFormat} currency={boot.shop.currency} device={device} popup={popupOpen} />
          <p className="muted small">Aperçu avec un produit exemple. Les prix réels sont relus dans Shopify à chaque commande.</p>
        </div>
      </div>
    </div>
  );
}

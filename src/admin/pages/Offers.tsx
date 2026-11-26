import { useState } from "react";
import { newId } from "../../shared/defaults";
import { offerConfigSchemas, type OfferType, type QuantityTier } from "../../shared/offers-schema";
import { Badge, Card, Color, ErrorBanner, Loading, Num, Select, Text, Toggle, useAction, useLoad } from "../components/ui";
import { api, pickProducts } from "../lib/api";
import type { PageProps } from "../lib/types";

interface OfferRow {
  id?: string;
  type: OfferType;
  name: string;
  active: boolean;
  priority: number;
  config: any;
}

const TYPE_LABEL: Record<OfferType, string> = {
  quantity: "Offre de quantité / bundle",
  upsell: "Upsell 1-Tick (dans le formulaire)",
  downsell: "Downsell (à la fermeture)",
  post_purchase: "Upsell 1-Click (après commande)",
};

const DISCOUNTS = [
  { value: "none", label: "Aucune remise" },
  { value: "percentage", label: "Pourcentage" },
  { value: "fixed", label: "Montant retiré" },
  { value: "fixed_price", label: "Prix total fixe" },
] as const;

function ProductTargets({ ids, onChange, label }: { ids: string[]; onChange: (ids: string[]) => void; label: string }) {
  return (
    <div className="stack">
      <b className="small">{label}</b>
      <div className="row">
        <Badge tone={ids.length ? "info" : undefined}>{ids.length ? `${ids.length} produit(s)` : "Tous les produits"}</Badge>
        <button
          className="btn sm"
          onClick={async () => {
            const p = await pickProducts(true);
            if (p === null) {
              const raw = prompt("IDs produits (séparés par des virgules)", ids.join(","));
              if (raw !== null) onChange(raw.split(",").map((x) => x.trim()).filter((x) => /^\d+$/.test(x)));
              return;
            }
            if (p.length) onChange([...new Set([...ids, ...p.map((x) => x.id)])]);
          }}
        >
          Choisir
        </button>
        {ids.length > 0 && <button className="btn sm" onClick={() => onChange([])}>Tous les produits</button>}
      </div>
    </div>
  );
}

function ProductChoice({ cfg, set }: { cfg: any; set: (p: any) => void }) {
  return (
    <div className="row">
      <span>{cfg.productTitle ? <b>{cfg.productTitle}</b> : <span className="muted">Aucun produit choisi</span>}</span>
      <button
        className="btn sm"
        onClick={async () => {
          const p = await pickProducts(false);
          if (!p || !p[0]) return;
          const v = p[0].variants[0];
          if (!v) return;
          let variant = v;
          if (p[0].variants.length > 1) {
            const name = prompt(`Variante ? (${p[0].variants.map((x) => x.title).join(" / ")})`, v.title);
            variant = p[0].variants.find((x) => x.title === name) ?? v;
          }
          set({ productId: p[0].id, variantId: variant.id, productTitle: `${p[0].title}${p[0].variants.length > 1 ? ` (${variant.title})` : ""}`, displayPrice: variant.price, imageUrl: cfg.imageUrl || p[0].image || "" });
        }}
      >
        Choisir le produit
      </button>
    </div>
  );
}

function OfferEditor({ offer, onSave, onCancel, busy }: { offer: OfferRow; onSave: (o: OfferRow) => void; onCancel: () => void; busy: boolean }) {
  const [o, setO] = useState<OfferRow>(offer);
  const cfg = o.config;
  const set = (patch: any) => setO({ ...o, config: { ...cfg, ...patch } });
  const parsed = offerConfigSchemas[o.type].safeParse(cfg);
  const tiers: QuantityTier[] = cfg.tiers ?? [];
  const setTier = (i: number, patch: Partial<QuantityTier>) => set({ tiers: tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  return (
    <Card title={`${o.id ? "Modifier" : "Nouvelle"} : ${TYPE_LABEL[o.type]}`}>
      <div className="stack">
        <div className="grid2">
          <Text label="Nom interne" value={o.name} onChange={(v) => setO({ ...o, name: v })} />
          <Num label="Priorité" value={o.priority} onChange={(v) => setO({ ...o, priority: v ?? 0 })} hint="La plus haute l'emporte si plusieurs offres visent le même produit." />
        </div>
        <Toggle label="Active" checked={o.active} onChange={(v) => setO({ ...o, active: v })} />
        {o.type === "quantity" && (
          <>
            <ProductTargets label="Produits concernés" ids={cfg.productIds ?? []} onChange={(ids) => set({ productIds: ids })} />
            <div className="grid3">
              <Select label="Style" value={cfg.style ?? "list"} onChange={(v) => set({ style: v })} options={[{ value: "list", label: "Liste" }, { value: "cards", label: "Cartes" }]} />
              <Color label="Couleur d'accent" value={cfg.accentColor ?? "#2563eb"} onChange={(v) => set({ accentColor: v ?? "#2563eb" })} />
              <Toggle label="Masquer le sélecteur de quantité" checked={cfg.hideQuantitySelector ?? true} onChange={(v) => set({ hideQuantitySelector: v })} />
            </div>
            <h3>Paliers</h3>
            {tiers.map((t, i) => (
              <div key={t.id} className="card" style={{ background: "#fafafa", marginBottom: 8 }}>
                <div className="grid3">
                  <Num label="Quantité" value={t.quantity} min={1} onChange={(v) => setTier(i, { quantity: v ?? 1 })} />
                  <Text label="Titre" value={t.title} onChange={(v) => setTier(i, { title: v })} placeholder={`Achetez ${t.quantity}`} />
                  <Text label="Sous-titre" value={t.subtitle} onChange={(v) => setTier(i, { subtitle: v })} />
                  <Text label="Badge" value={t.badge} onChange={(v) => setTier(i, { badge: v })} placeholder="Le plus populaire" />
                  <Select label="Remise" value={t.discountType} onChange={(v) => setTier(i, { discountType: v })} options={DISCOUNTS as any} />
                  {t.discountType !== "none" && <Num label={t.discountType === "percentage" ? "Pourcentage" : "Montant"} value={t.value} min={0} step={0.01} onChange={(v) => setTier(i, { value: v ?? 0 })} />}
                  <Text label="Image (URL)" value={t.imageUrl} onChange={(v) => setTier(i, { imageUrl: v })} />
                </div>
                <div className="row">
                  <Toggle label="Présélectionné" checked={t.preselected} onChange={(v) => set({ tiers: tiers.map((x, j) => ({ ...x, preselected: j === i ? v : v ? false : x.preselected })) })} />
                  <Toggle label="Livraison offerte" checked={t.freeShipping} onChange={(v) => setTier(i, { freeShipping: v })} />
                  <button className="btn sm danger" onClick={() => set({ tiers: tiers.filter((_, j) => j !== i) })}>Supprimer</button>
                </div>
              </div>
            ))}
            {tiers.length < 10 && (
              <button className="btn" onClick={() => set({ tiers: [...tiers, { id: newId("t"), quantity: (tiers.at(-1)?.quantity ?? 0) + 1, title: "", subtitle: "", badge: "", discountType: "none", value: 0, preselected: false, imageUrl: "", freeShipping: false }] })}>
                + Ajouter un palier
              </button>
            )}
          </>
        )}
        {(o.type === "upsell" || o.type === "post_purchase") && (
          <>
            <ProductTargets label="Proposé sur" ids={cfg.triggerProductIds ?? []} onChange={(ids) => set({ triggerProductIds: ids })} />
            <ProductChoice cfg={cfg} set={set} />
            <Text label="Titre" value={cfg.title ?? ""} onChange={(v) => set({ title: v })} />
            <Text label="Description" value={cfg.description ?? ""} onChange={(v) => set({ description: v })} />
            <Text label="Image (URL)" value={cfg.imageUrl ?? ""} onChange={(v) => set({ imageUrl: v })} />
            <div className="grid2">
              <Select label="Remise" value={cfg.discountType ?? "none"} onChange={(v) => set({ discountType: v })} options={DISCOUNTS.filter((d) => d.value !== "fixed_price") as any} />
              {cfg.discountType && cfg.discountType !== "none" && <Num label="Valeur" value={cfg.value ?? 0} min={0} step={0.01} onChange={(v) => set({ value: v ?? 0 })} />}
            </div>
            {o.type === "upsell" && <Toggle label="Coché par défaut" checked={cfg.preselected ?? false} onChange={(v) => set({ preselected: v })} />}
            {o.type === "post_purchase" && (
              <div className="grid2">
                <Text label="Bouton accepter" value={cfg.acceptText ?? ""} onChange={(v) => set({ acceptText: v })} />
                <Text label="Bouton refuser" value={cfg.declineText ?? ""} onChange={(v) => set({ declineText: v })} />
              </div>
            )}
            {o.type === "post_purchase" && <p className="muted small">Le produit est ajouté à la commande existante par modification de commande Shopify (aucune seconde commande).</p>}
          </>
        )}
        {o.type === "downsell" && (
          <>
            <ProductTargets label="Proposé sur" ids={cfg.triggerProductIds ?? []} onChange={(ids) => set({ triggerProductIds: ids })} />
            <Text label="Titre" value={cfg.title ?? ""} onChange={(v) => set({ title: v })} />
            <Text label="Texte" value={cfg.text ?? ""} onChange={(v) => set({ text: v })} />
            <div className="grid2">
              <Select label="Remise" value={cfg.discountType ?? "percentage"} onChange={(v) => set({ discountType: v })} options={[{ value: "percentage", label: "Pourcentage" }, { value: "fixed", label: "Montant retiré" }]} />
              <Num label="Valeur" value={cfg.value ?? 10} min={0} step={0.01} onChange={(v) => set({ value: v ?? 0 })} />
              <Text label="Bouton accepter" value={cfg.acceptText ?? ""} onChange={(v) => set({ acceptText: v })} />
              <Text label="Bouton refuser" value={cfg.declineText ?? ""} onChange={(v) => set({ declineText: v })} />
            </div>
          </>
        )}
        {!parsed.success && <ul className="err-list">{parsed.error.issues.slice(0, 6).map((i, k) => <li key={k}>{i.path.join(".")} : {i.message}</li>)}</ul>}
        <div className="row">
          <button className="btn primary" disabled={busy || !parsed.success || !o.name} onClick={() => onSave({ ...o, config: parsed.success ? parsed.data : cfg })}>
            Enregistrer
          </button>
          <button className="btn" onClick={onCancel}>Annuler</button>
        </div>
      </div>
    </Card>
  );
}

export function OffersPage({ boot }: PageProps) {
  const { data, error, reload } = useLoad<OfferRow[]>("/offers");
  const [editing, setEditing] = useState<OfferRow | null>(null);
  const { busy, run } = useAction();
  const create = (type: OfferType) => {
    const defaults: Record<OfferType, any> = {
      quantity: { productIds: [], tiers: [{ id: newId("t"), quantity: 1, title: "1 article", preselected: true }, { id: newId("t"), quantity: 2, title: "2 articles", badge: "Populaire", discountType: "percentage", value: 10 }, { id: newId("t"), quantity: 3, title: "3 articles", discountType: "percentage", value: 15, freeShipping: true }] },
      upsell: { triggerProductIds: [] },
      downsell: { triggerProductIds: [] },
      post_purchase: { triggerProductIds: [] },
    };
    setEditing({ type, name: TYPE_LABEL[type], active: true, priority: 0, config: offerConfigSchemas[type].safeParse(defaults[type]).data ?? defaults[type] });
  };
  if (editing) {
    return (
      <OfferEditor
        offer={editing}
        busy={busy}
        onCancel={() => setEditing(null)}
        onSave={async (o) => {
          const r = await run(() => api("/offers", { body: o }), "Offre enregistrée et publiée");
          if (r) {
            setEditing(null);
            void reload();
          }
        }}
      />
    );
  }
  return (
    <Card
      title="Offres & Upsells"
      actions={
        <select value="" onChange={(e) => e.target.value && create(e.target.value as OfferType)} style={{ width: 240 }}>
          <option value="">+ Créer une offre…</option>
          {(Object.keys(TYPE_LABEL) as OfferType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
      }
    >
      <p className="muted small">
        Les remises sont recalculées par le serveur à chaque commande (le navigateur n'impose jamais un prix). Placez les offres dans le formulaire avec les blocs « Offres de quantité » et « Upsells 1-Tick ».
        Devise : {boot.shop.currency}.
      </p>
      <ErrorBanner error={error} />
      {!data ? <Loading /> : (
        <table>
          <thead><tr><th>Nom</th><th>Type</th><th>Produits</th><th>Statut</th><th /></tr></thead>
          <tbody>
            {data.map((o) => (
              <tr key={o.id}>
                <td><b>{o.name}</b></td>
                <td>{TYPE_LABEL[o.type]}</td>
                <td>{((o.config.productIds ?? o.config.triggerProductIds) as string[] | undefined)?.length || "Tous"}</td>
                <td>{o.active ? <Badge tone="ok">Active</Badge> : <Badge>Inactive</Badge>}</td>
                <td className="row">
                  <button className="btn sm" onClick={() => setEditing(o)}>Modifier</button>
                  <button className="btn sm danger" disabled={busy} onClick={() => confirm("Supprimer cette offre ?") && run(() => api(`/offers/${o.id}`, { method: "DELETE" }), "Offre supprimée").then(reload)}>Supprimer</button>
                </td>
              </tr>
            ))}
            {!data.length && <tr><td colSpan={5} className="empty">Aucune offre.</td></tr>}
          </tbody>
        </table>
      )}
    </Card>
  );
}

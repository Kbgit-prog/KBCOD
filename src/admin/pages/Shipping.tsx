import { useState } from "react";
import { newId } from "../../shared/defaults";
import { Card, Num, Select, Text, Toggle, useAction } from "../components/ui";
import { api } from "../lib/api";
import type { PageProps } from "../lib/types";

const toMinor = (v: number | null) => (v === null ? null : Math.round(v * 100));
const fromMinor = (v: number | null) => (v === null ? null : v / 100);

export function ShippingPage({ boot, reloadBoot }: PageProps) {
  const [o, setO] = useState(boot.settings.orders);
  const { busy, run } = useAction();
  const save = () => run(() => api("/settings", { method: "PUT", body: { orders: o } }), "Enregistré et publié").then(reloadBoot);
  const cur = boot.shop.currency;
  return (
    <>
      <Card title={`Frais de livraison (${cur})`} actions={<button className="btn primary" disabled={busy} onClick={save}>Enregistrer</button>}>
        <p className="muted small">Ajoutez le bloc « Options de livraison » au formulaire pour laisser le client choisir. Sans tarif, la commande est créée sans frais de livraison.</p>
        <div className="stack">
          {o.shippingRates.map((r, i) => {
            const set = (patch: Partial<typeof r>) => setO({ ...o, shippingRates: o.shippingRates.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
            return (
              <div key={r.id} className="card" style={{ background: "#fafafa", marginBottom: 0 }}>
                <div className="grid3">
                  <Text label="Nom" value={r.name} onChange={(v) => set({ name: v })} />
                  <Text label="Description" value={r.description} onChange={(v) => set({ description: v })} placeholder="Livraison en 24-48 h" />
                  <Num label="Prix" value={fromMinor(r.price)} min={0} step={0.01} onChange={(v) => set({ price: toMinor(v ?? 0) ?? 0 })} />
                  <Num label="Gratuit à partir de" value={fromMinor(r.freeAbove)} nullable min={0} step={0.01} onChange={(v) => set({ freeAbove: toMinor(v) })} />
                  <Num label="Sous-total min." value={fromMinor(r.minSubtotal)} nullable min={0} step={0.01} onChange={(v) => set({ minSubtotal: toMinor(v) })} />
                  <Num label="Sous-total max." value={fromMinor(r.maxSubtotal)} nullable min={0} step={0.01} onChange={(v) => set({ maxSubtotal: toMinor(v) })} />
                  <Text label="Pays (vide = tous)" value={r.countries.join(", ")} onChange={(v) => set({ countries: v.split(/[,\s]+/).map((x) => x.toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x)) })} />
                </div>
                <div className="row">
                  <Toggle label="Actif" checked={r.enabled} onChange={(v) => set({ enabled: v })} />
                  <button className="btn sm danger" onClick={() => setO({ ...o, shippingRates: o.shippingRates.filter((_, j) => j !== i) })}>Supprimer</button>
                </div>
              </div>
            );
          })}
          <button className="btn" onClick={() => setO({ ...o, shippingRates: [...o.shippingRates, { id: newId("s"), name: "Livraison standard", description: "", price: 0, countries: [], minSubtotal: null, maxSubtotal: null, freeAbove: null, enabled: true }] })}>+ Ajouter un tarif</button>
        </div>
      </Card>

      <Card title="Codes promo" actions={<button className="btn primary" disabled={busy} onClick={save}>Enregistrer</button>}>
        <p className="muted small">Codes propres au formulaire COD, vérifiés par le serveur. Ajoutez le bloc « Code promo » au formulaire.</p>
        {o.discountCodes.map((d, i) => {
          const set = (patch: Partial<typeof d>) => setO({ ...o, discountCodes: o.discountCodes.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
          return (
            <div key={i} className="grid3" style={{ alignItems: "end", marginBottom: 8 }}>
              <Text label="Code" value={d.code} onChange={(v) => set({ code: v.replace(/[^A-Za-z0-9_-]/g, "").toUpperCase() })} />
              <Select label="Type" value={d.type} onChange={(v) => set({ type: v })} options={[{ value: "percentage", label: "Pourcentage" }, { value: "fixed", label: "Montant" }]} />
              <Num label="Valeur" value={d.value} min={0} step={0.01} onChange={(v) => set({ value: v ?? 0 })} />
              <Num label="Sous-total min." value={fromMinor(d.minSubtotal)} nullable min={0} onChange={(v) => set({ minSubtotal: toMinor(v) })} />
              <label className="field">Expire le<input type="datetime-local" value={d.expiresAt ? d.expiresAt.slice(0, 16) : ""} onChange={(e) => set({ expiresAt: e.target.value ? new Date(e.target.value).toISOString() : null })} /></label>
              <div className="row"><Toggle label="Actif" checked={d.enabled} onChange={(v) => set({ enabled: v })} /><button className="btn sm danger" onClick={() => setO({ ...o, discountCodes: o.discountCodes.filter((_, j) => j !== i) })}>✕</button></div>
            </div>
          );
        })}
        <button className="btn" onClick={() => setO({ ...o, discountCodes: [...o.discountCodes, { code: "BIENVENUE", type: "percentage", value: 10, minSubtotal: null, enabled: true, expiresAt: null }] })}>+ Ajouter un code</button>
      </Card>

      <Card title="Création des commandes Shopify" actions={<button className="btn primary" disabled={busy} onClick={save}>Enregistrer</button>}>
        <div className="stack">
          <Text label="Étiquettes ajoutées aux commandes" value={o.tags.join(", ")} onChange={(v) => setO({ ...o, tags: v.split(",").map((x) => x.trim()).filter(Boolean) })} />
          <Text label="Étiquette de confirmation (déclenche l'événement « confirmée »)" value={o.confirmedTag} onChange={(v) => setO({ ...o, confirmedTag: v.trim() })} />
          <Toggle label="Envoyer l'e-mail de confirmation Shopify au client" checked={o.sendReceipt} onChange={(v) => setO({ ...o, sendReceipt: v })} />
          <Toggle label="Enregistrer une transaction en attente « paiement à la livraison »" checked={o.recordCodTransaction} onChange={(v) => setO({ ...o, recordCodTransaction: v })} hint="Statut financier toujours « En attente » : la commande n'est jamais marquée payée." />
          <Text label="Nom du mode de paiement" value={o.gatewayName} onChange={(v) => setO({ ...o, gatewayName: v })} />
          <Select label="Stock" value={o.inventoryBehaviour} onChange={(v) => setO({ ...o, inventoryBehaviour: v })} options={[{ value: "DECREMENT_OBEYING_POLICY", label: "Décrémenter en respectant la politique de stock" }, { value: "DECREMENT_IGNORING_POLICY", label: "Décrémenter sans contrôle" }, { value: "BYPASS", label: "Ne pas toucher au stock" }]} />
          <Toggle label="Autoriser la commande d'un produit en rupture" checked={o.allowOutOfStock} onChange={(v) => setO({ ...o, allowOutOfStock: v })} />
          <Toggle label="Prix TTC (taxes incluses)" checked={o.taxesIncluded} onChange={(v) => setO({ ...o, taxesIncluded: v })} />
        </div>
      </Card>
    </>
  );
}

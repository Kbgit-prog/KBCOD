import { useState } from "react";
import { Badge, Card, ErrorBanner, Loading, Select, Text, Toggle, statusBadge, date, useAction, useLoad } from "../components/ui";
import { api } from "../lib/api";
import type { PageProps } from "../lib/types";

interface Pixel {
  id: string;
  provider: string;
  name: string;
  pixel_id: string;
  test_event_code: string | null;
  enabled: boolean;
  hasToken: boolean;
}

const PROVIDERS = [
  { value: "meta", label: "Meta (Facebook / Instagram) — Pixel + Conversions API" },
  { value: "tiktok", label: "TikTok Pixel (navigateur)" },
  { value: "snapchat", label: "Snapchat Pixel (navigateur)" },
  { value: "pinterest", label: "Pinterest Tag (navigateur)" },
  { value: "google_ads", label: "Google Ads (navigateur)" },
  { value: "ga4", label: "Google Analytics 4 (navigateur)" },
];

export function TrackingPage({ boot, reloadBoot }: PageProps) {
  const pixels = useLoad<Pixel[]>("/pixels");
  const events = useLoad<any[]>("/tracking/events");
  const [edit, setEdit] = useState<(Partial<Pixel> & { capiToken?: string }) | null>(null);
  const [t, setT] = useState(boot.settings.tracking);
  const { busy, run } = useAction();

  return (
    <>
      <Card title="Événements COD" actions={<button className="btn primary" disabled={busy} onClick={() => run(() => api("/settings", { method: "PUT", body: { tracking: t } }), "Paramètres de tracking enregistrés").then(reloadBoot)}>Enregistrer</button>}>
        <div className="stack">
          <div className="banner info small">
            Parcours COD : <b>formulaire ouvert</b> (InitiateCheckout) → <b>commande soumise</b> (commande Shopify créée, paiement en attente) → <b>confirmée</b> (étiquette « {boot.settings.orders.confirmedTag} » ajoutée) →{" "}
            <b>expédiée</b> (traitement créé) → <b>livrée/payée</b> (commande marquée payée). Chaque événement porte <code>payment_status</code> (pending / paid) et un <code>event_id</code> unique partagé entre navigateur et serveur.
          </div>
          <div className="grid2">
            <Select
              label="Événement à la soumission"
              value={t.submitEvent}
              onChange={(v) => setT({ ...t, submitEvent: v })}
              options={[
                { value: "Purchase", label: "Purchase (commande COD passée, non payée)" },
                { value: "Lead", label: "Lead" },
                { value: "SubmitApplication", label: "SubmitApplication" },
                { value: "CompleteRegistration", label: "CompleteRegistration" },
                { value: "Custom", label: "Événement personnalisé" },
              ]}
              hint="Meta définit Purchase comme un tunnel de commande terminé ; ici il est envoyé avec payment_status=pending. Le paiement réel est signalé par l'événement « livrée/payée »."
            />
            {t.submitEvent === "Custom" && <Text label="Nom personnalisé" value={t.submitCustomName} onChange={(v) => setT({ ...t, submitCustomName: v.replace(/[^A-Za-z0-9_]/g, "") })} />}
            <Text label="Événement « confirmée » (serveur)" value={t.confirmedEvent} onChange={(v) => setT({ ...t, confirmedEvent: v.replace(/[^A-Za-z0-9_]/g, "") })} hint="Vide = désactivé" />
            <Text label="Événement « expédiée » (serveur)" value={t.shippedEvent} onChange={(v) => setT({ ...t, shippedEvent: v.replace(/[^A-Za-z0-9_]/g, "") })} />
            <Text label="Événement « livrée / payée » (serveur)" value={t.paidEvent} onChange={(v) => setT({ ...t, paidEvent: v.replace(/[^A-Za-z0-9_]/g, "") })} hint="N'utilisez pas « Purchase » ici si la soumission envoie déjà Purchase (double comptage)." />
          </div>
          <Toggle label="InitiateCheckout à l'ouverture du formulaire (navigateur + serveur, dédupliqué)" checked={t.initiateCheckout} onChange={(v) => setT({ ...t, initiateCheckout: v })} />
          <Toggle label="Envoyer PageView depuis KB COD (désactivez si le pixel est déjà installé par Shopify)" checked={t.sendPageView} onChange={(v) => setT({ ...t, sendPageView: v })} />
        </div>
      </Card>

      <Card title="Pixels" actions={<button className="btn primary" onClick={() => setEdit({ provider: "meta", name: "Pixel principal", enabled: true })}>Ajouter un pixel</button>}>
        {edit && (
          <div className="card" style={{ background: "#fafafa" }}>
            <div className="stack">
              <Select label="Plateforme" value={(edit.provider ?? "meta") as string} onChange={(v) => setEdit({ ...edit, provider: v })} options={PROVIDERS} />
              <div className="grid2">
                <Text label="Nom" value={edit.name ?? ""} onChange={(v) => setEdit({ ...edit, name: v })} />
                <Text label="ID du pixel" value={edit.pixel_id ?? ""} onChange={(v) => setEdit({ ...edit, pixel_id: v.trim() })} />
              </div>
              {edit.provider === "meta" && (
                <>
                  <Text
                    label={`Jeton d'accès Conversions API${edit.hasToken ? " (laisser vide pour conserver l'actuel)" : ""}`}
                    type="password"
                    value={edit.capiToken ?? ""}
                    onChange={(v) => setEdit({ ...edit, capiToken: v })}
                    hint="Gestionnaire d'événements > votre pixel > Paramètres > Générer un jeton d'accès. Stocké chiffré, jamais affiché."
                  />
                  <Text label="Code d'événement test (facultatif)" value={edit.test_event_code ?? ""} onChange={(v) => setEdit({ ...edit, test_event_code: v.trim() })} hint="Onglet « Tester les événements ». Videz-le en production." />
                </>
              )}
              <Toggle label="Actif" checked={edit.enabled ?? true} onChange={(v) => setEdit({ ...edit, enabled: v })} />
              <div className="row">
                <button
                  className="btn primary"
                  disabled={busy || !edit.pixel_id || !edit.name}
                  onClick={async () => {
                    const r = await run(() => api("/pixels", { body: { id: edit.id, provider: edit.provider, name: edit.name, pixelId: edit.pixel_id, capiToken: edit.capiToken || undefined, testEventCode: edit.test_event_code || null, enabled: edit.enabled ?? true } }), "Pixel enregistré");
                    if (r) {
                      setEdit(null);
                      void pixels.reload();
                    }
                  }}
                >
                  Enregistrer
                </button>
                <button className="btn" onClick={() => setEdit(null)}>Annuler</button>
              </div>
            </div>
          </div>
        )}
        <ErrorBanner error={pixels.error} />
        {!pixels.data ? <Loading /> : (
          <table>
            <thead><tr><th>Nom</th><th>Plateforme</th><th>ID</th><th>CAPI</th><th>Statut</th><th /></tr></thead>
            <tbody>
              {pixels.data.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{(PROVIDERS.find((x) => x.value === p.provider)?.label ?? p.provider).split(" —")[0]!.split(" (")[0]}</td>
                  <td><code>{p.pixel_id}</code></td>
                  <td>{p.provider === "meta" ? (p.hasToken ? <Badge tone="ok">Jeton configuré</Badge> : <Badge tone="warn">Navigateur seul</Badge>) : <span className="muted small">—</span>}{p.test_event_code && <Badge tone="info">Mode test</Badge>}</td>
                  <td>{p.enabled ? <Badge tone="ok">Actif</Badge> : <Badge>Inactif</Badge>}</td>
                  <td className="row">
                    <button className="btn sm" onClick={() => setEdit({ ...p })}>Modifier</button>
                    {p.provider === "meta" && p.hasToken && (
                      <button className="btn sm" disabled={busy} onClick={async () => {
                        const r = await run(() => api<{ ok: boolean; response: any }>(`/pixels/${p.id}/test`, { body: {} }));
                        if (r) alert(`Meta a répondu : ${JSON.stringify(r.response)}`);
                      }}>Tester</button>
                    )}
                    <button className="btn sm danger" disabled={busy} onClick={() => confirm("Supprimer ce pixel ?") && run(() => api(`/pixels/${p.id}`, { method: "DELETE" }), "Pixel supprimé").then(pixels.reload)}>Supprimer</button>
                  </td>
                </tr>
              ))}
              {!pixels.data.length && <tr><td colSpan={6} className="empty">Aucun pixel.</td></tr>}
            </tbody>
          </table>
        )}
        <p className="muted small">Meta : navigateur (fbq) + serveur (CAPI) avec le même event_name et event_id. Autres plateformes : événements navigateur si leur script est présent sur la boutique.</p>
      </Card>

      <Card title="Journal des événements serveur (Meta CAPI)" actions={<button className="btn" onClick={events.reload}>Actualiser</button>}>
        <ErrorBanner error={events.error} />
        {!events.data ? <Loading /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Événement</th><th>event_id</th><th>Commande</th><th>Pixel</th><th>Statut</th><th>Tentatives</th><th>Réponse / erreur</th></tr></thead>
              <tbody>
                {events.data.map((e) => (
                  <tr key={e.id}>
                    <td className="small">{date(e.created_at)}</td>
                    <td>{e.event_name}</td>
                    <td className="small"><code>{e.event_id}</code></td>
                    <td>{e.shopify_order_name ?? "—"}</td>
                    <td>{e.pixel_name}</td>
                    <td>{statusBadge(e.status)}</td>
                    <td>{e.attempts}</td>
                    <td className="small muted" style={{ maxWidth: 280 }}>{e.last_error ?? (e.response ? `events_received=${e.response.events_received ?? "?"} fbtrace=${e.response.fbtrace_id ?? ""}` : "")}</td>
                  </tr>
                ))}
                {!events.data.length && <tr><td colSpan={8} className="empty">Aucun événement.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

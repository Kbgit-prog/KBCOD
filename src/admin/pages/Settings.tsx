import { useState } from "react";
import { Card, Loading, Num, statusBadge, date, useAction, useLoad } from "../components/ui";
import { api } from "../lib/api";
import type { PageProps } from "../lib/types";

export function SettingsPage({ boot, reloadBoot }: PageProps) {
  const [retention, setRetention] = useState(boot.settings.dataRetentionDays);
  const [jobStatus, setJobStatus] = useState("");
  const jobs = useLoad<any[]>(`/jobs${jobStatus ? `?status=${jobStatus}` : ""}`, [jobStatus]);
  const { busy, run } = useAction();
  const exportConfig = async () => {
    const data = await run(() => api("/export"));
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `kbcod-config-${boot.shop.domain}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };
  const importConfig = async (file: File) => {
    const text = await file.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return alert("Fichier JSON invalide");
    }
    if (!confirm("Importer cette configuration ? Le formulaire principal sera remplacé (une version de sauvegarde est conservée) et les autres formulaires/offres seront ajoutés.")) return;
    await run(() => api("/import", { body: json }), "Configuration importée").then(reloadBoot);
  };
  return (
    <>
      <Card title="Sauvegarde et restauration">
        <p className="muted small">L'export contient formulaires, offres, pixels (sans jetons), paramètres et mapping Sheets. Aucun secret ni donnée client n'est exporté.</p>
        <div className="row">
          <button className="btn primary" disabled={busy} onClick={exportConfig}>Exporter la configuration</button>
          <label className="btn">
            Importer…
            <input type="file" accept="application/json" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && importConfig(e.target.files[0])} />
          </label>
        </div>
      </Card>
      <Card title="Confidentialité" actions={<button className="btn primary" disabled={busy} onClick={() => run(() => api("/settings", { method: "PUT", body: { dataRetentionDays: retention } }), "Enregistré").then(reloadBoot)}>Enregistrer</button>}>
        <Num label="Conservation des données de commande dans KB COD (jours)" value={retention} min={30} max={3650} onChange={(v) => setRetention(v ?? 365)} hint="Les commandes restent dans Shopify. Purge automatique quotidienne. Les demandes de suppression Shopify (RGPD) sont traitées automatiquement." />
      </Card>
      <Card title="File de travaux (diagnostic)" actions={
        <>
          <select value={jobStatus} onChange={(e) => setJobStatus(e.target.value)} style={{ width: 180 }}>
            <option value="">Tous</option>
            <option value="pending">En attente</option>
            <option value="failed">Échec temporaire</option>
            <option value="dead">Abandonnés</option>
            <option value="done">Terminés</option>
          </select>
          <button className="btn" onClick={jobs.reload}>Actualiser</button>
        </>
      }>
        <p className="muted small">Synchronisations Sheets, événements Meta, notifications et réconciliations. Nouvelles tentatives automatiques : 30 s, 2 min, 8 min, 30 min, 2 h, 6 h, 12 h, 24 h.</p>
        {!jobs.data ? <Loading /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Type</th><th>Statut</th><th>Tentatives</th><th>Prochaine</th><th>Erreur</th><th /></tr></thead>
              <tbody>
                {jobs.data.map((j) => (
                  <tr key={j.id}>
                    <td><code>{j.type}</code></td>
                    <td>{statusBadge(j.status)}</td>
                    <td>{j.attempts}/{j.max_attempts}</td>
                    <td className="small">{j.status === "done" ? "—" : date(j.run_at)}</td>
                    <td className="small muted" style={{ maxWidth: 320 }}>{j.last_error}</td>
                    <td>{(j.status === "dead" || j.status === "failed") && <button className="btn sm" disabled={busy} onClick={() => run(() => api(`/jobs/${j.id}/retry`, { body: {} }), "Relancé").then(jobs.reload)}>Relancer</button>}</td>
                  </tr>
                ))}
                {!jobs.data.length && <tr><td colSpan={6} className="empty">Aucun travail.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Informations">
        <p className="small">Boutique : <code>{boot.shop.domain}</code> · Application : <code>{boot.shop.appClientId}</code> · Devise : {boot.shop.currency}</p>
      </Card>
    </>
  );
}

import { Card, ErrorBanner, Loading, Num, Toggle, statusBadge, date, useAction, useLoad } from "../components/ui";
import { api } from "../lib/api";
import type { PageProps } from "../lib/types";
import { useState } from "react";

export function AbandonedPage({ boot, reloadBoot }: PageProps) {
  const { data, error, reload } = useLoad<any[]>("/abandoned");
  const [s, setS] = useState(boot.settings.abandoned);
  const { busy, run } = useAction();
  return (
    <>
      <Card title="Paramètres" actions={<button className="btn primary" disabled={busy} onClick={() => run(() => api("/settings", { method: "PUT", body: { abandoned: s } }), "Enregistré").then(reloadBoot)}>Enregistrer</button>}>
        <div className="grid3">
          <Toggle label="Détecter les formulaires abandonnés" checked={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} hint="Téléphone ou e-mail saisi, mais aucune commande envoyée." />
          <Num label="Délai d'abandon (minutes)" value={s.delayMinutes} min={5} max={1440} onChange={(v) => setS({ ...s, delayMinutes: v ?? 15 })} />
          <Num label="Conservation (jours)" value={s.retentionDays} min={1} max={365} onChange={(v) => setS({ ...s, retentionDays: v ?? 30 })} />
        </div>
        <p className="muted small">La relance SMS/WhatsApp (page SMS / WhatsApp) n'est envoyée qu'aux clients ayant coché le consentement marketing.</p>
      </Card>
      <Card title="Formulaires commencés" actions={<button className="btn" onClick={reload}>Actualiser</button>}>
        <ErrorBanner error={error} />
        {!data ? <Loading /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Activité</th><th>Nom</th><th>Téléphone</th><th>Consentement</th><th>Statut</th><th>Relancé</th><th /></tr></thead>
              <tbody>
                {data.map((a) => (
                  <tr key={a.id}>
                    <td className="small">{date(a.last_activity_at)}</td>
                    <td>{a.name ?? "—"}</td>
                    <td>{a.phone_e164 ? <a href={`https://wa.me/${String(a.phone_e164).replace("+", "")}`} target="_blank" rel="noreferrer">{a.phone_e164}</a> : a.email ?? "—"}</td>
                    <td>{a.consent ? "Oui" : "Non"}</td>
                    <td>{statusBadge(a.status)}</td>
                    <td className="small">{date(a.notified_at)}</td>
                    <td className="row">
                      {a.status === "abandoned" && <button className="btn sm" onClick={() => run(() => api(`/abandoned/${a.id}/status`, { body: { status: "recovered" } })).then(reload)}>Récupéré</button>}
                      {a.status !== "dismissed" && a.status !== "converted" && <button className="btn sm" onClick={() => run(() => api(`/abandoned/${a.id}/status`, { body: { status: "dismissed" } })).then(reload)}>Ignorer</button>}
                    </td>
                  </tr>
                ))}
                {!data.length && <tr><td colSpan={7} className="empty">Aucun formulaire abandonné.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

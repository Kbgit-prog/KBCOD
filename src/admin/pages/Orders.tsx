import { useState } from "react";
import { Card, ErrorBanner, Loading, money, statusBadge, date, useAction, useLoad } from "../components/ui";
import { api } from "../lib/api";
import type { PageProps } from "../lib/types";

export function OrdersPage({ boot }: PageProps) {
  const [status, setStatus] = useState("");
  const { data, error, reload } = useLoad<any[]>(`/submissions${status ? `?status=${status}` : ""}`, [status]);
  const { busy, run } = useAction();
  return (
    <Card
      title="Commandes du formulaire"
      actions={
        <>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 200 }}>
            <option value="">Tous les statuts</option>
            <option value="created">Créées</option>
            <option value="uncertain">Incertaines</option>
            <option value="failed">Échecs</option>
            <option value="blocked">Bloquées</option>
            <option value="otp_pending">OTP en attente</option>
          </select>
          <button className="btn" onClick={reload}>Actualiser</button>
        </>
      }
    >
      <p className="muted small">
        La commande Shopify fait foi. Google Sheets et Meta sont synchronisés ensuite par une file persistante. « Incertaine » = réponse Shopify perdue : la réconciliation retrouve la commande sans la dupliquer.
      </p>
      <ErrorBanner error={error} />
      {!data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Date</th><th>Commande</th><th>Client</th><th>Total</th><th>Statut</th><th>Sheets</th><th>Meta</th><th>Détail</th><th /></tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id}>
                  <td className="small">{date(s.created_at)}</td>
                  <td>
                    {s.shopify_order_gid ? (
                      <a href={`https://${boot.shop.domain}/admin/orders/${String(s.shopify_order_gid).split("/").pop()}`} target="_top">{s.shopify_order_name}</a>
                    ) : "—"}
                  </td>
                  <td>{s.name ?? "—"}<div className="muted small">{s.phone ?? ""}</div></td>
                  <td>{money(s.total, s.currency ?? boot.shop.currency)}</td>
                  <td>{statusBadge(s.status)}</td>
                  <td>{statusBadge(s.sheet_status)}</td>
                  <td className="small">{s.meta_status ?? "—"}</td>
                  <td className="small muted" style={{ maxWidth: 260 }}>{s.error ?? (Array.isArray(s.reasons) && s.reasons.length ? s.reasons.join(", ") : "")}</td>
                  <td>
                    <div className="row">
                      {s.status === "uncertain" && <button className="btn sm" disabled={busy} onClick={() => run(() => api(`/submissions/${s.id}/reconcile`, { body: {} }), "Réconciliation lancée").then(reload)}>Réconcilier</button>}
                      <button className="btn sm" disabled={busy} onClick={() => confirm("Bloquer ce numéro pour les prochaines commandes ?") && run(() => api(`/submissions/${s.id}/block`, { body: { kind: "phone" } }), "Numéro bloqué")}>Bloquer n°</button>
                      <button className="btn sm" disabled={busy} onClick={() => confirm("Bloquer l'adresse IP de cette commande ? (attention aux IP partagées)") && run(() => api(`/submissions/${s.id}/block`, { body: { kind: "ip" } }), "IP bloquée")}>Bloquer IP</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!data.length && <tr><td colSpan={9} className="empty">Aucune commande.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

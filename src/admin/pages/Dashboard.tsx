import { Badge, Card, ErrorBanner, Loading, money, statusBadge, date, useLoad } from "../components/ui";
import type { PageProps } from "../lib/types";

interface Stats {
  totals: Record<string, { count: number; amount: number }>;
  conversionRate: number | null;
  openConversionRate: number | null;
  averageOrderValue: number | null;
}

export function Dashboard({ boot, go }: PageProps) {
  const stats = useLoad<Stats>("/stats?days=30");
  const recent = useLoad<any[]>("/submissions");
  const pixels = useLoad<any[]>("/pixels");
  const cur = boot.shop.currency;
  const t = stats.data?.totals ?? {};
  const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)} %`);
  const embedUrl = `https://${boot.shop.domain}/admin/themes/current/editor?context=apps&activateAppId=${boot.shop.appClientId}/app-embed`;
  const a = boot.alerts;
  return (
    <>
      {a.uncertain > 0 && <div className="banner warn">{a.uncertain} commande(s) au statut incertain : réconciliation automatique en cours. <button className="btn sm" onClick={() => go("orders")}>Voir</button></div>}
      {a.sheets > 0 && <div className="banner err">{a.sheets} synchronisation(s) Google Sheets en échec. <button className="btn sm" onClick={() => go("sheets")}>Corriger</button></div>}
      {a.meta > 0 && <div className="banner err">{a.meta} événement(s) Meta en échec (7 jours). <button className="btn sm" onClick={() => go("tracking")}>Diagnostiquer</button></div>}
      {boot.google?.status === "revoked" && <div className="banner err">Connexion Google expirée ou révoquée : reconnectez votre compte.</div>}
      <Card title="Mise en route">
        <ol className="steps">
          <li>
            Activez l'intégration dans votre thème :{" "}
            <a className="btn sm" href={embedUrl} target="_top">
              Activer « KB COD Manager » (App embed)
            </a>{" "}
            <span className="muted small">ou ajoutez le bloc « Formulaire COD » dans la section produit.</span>
          </li>
          <li>
            Personnalisez votre formulaire : <button className="btn sm" onClick={() => go("forms")}>Constructeur</button>
          </li>
          <li>
            Google Sheets : {boot.google?.status === "connected" ? <Badge tone="ok">{boot.google.sheet_title ? `→ ${boot.google.sheet_title}` : "connecté, feuille à choisir"}</Badge> : <button className="btn sm" onClick={() => go("sheets")}>Connecter</button>}
          </li>
          <li>
            Meta Pixel / CAPI : {pixels.data?.some((p) => p.provider === "meta" && p.hasToken) ? <Badge tone="ok">configuré</Badge> : <button className="btn sm" onClick={() => go("tracking")}>Configurer</button>}
          </li>
          <li>
            Antifraude : <Badge tone={boot.settings.fraud.enabled ? "ok" : "warn"}>{boot.settings.fraud.enabled ? "actif" : "désactivé"}</Badge>
          </li>
        </ol>
      </Card>
      <Card title="30 derniers jours">
        <ErrorBanner error={stats.error} />
        <div className="grid3">
          <div className="kpi"><span className="muted">Commandes</span><b>{t.orders?.count ?? 0}</b></div>
          <div className="kpi"><span className="muted">Chiffre d'affaires (COD, non encaissé)</span><b>{money(t.orders?.amount ?? 0, cur)}</b></div>
          <div className="kpi"><span className="muted">Panier moyen</span><b>{money(stats.data?.averageOrderValue ?? null, cur)}</b></div>
          <div className="kpi"><span className="muted">Affichages du formulaire</span><b>{t.form_view?.count ?? 0}</b></div>
          <div className="kpi"><span className="muted">Conversion (commandes / affichages)</span><b>{pct(stats.data?.conversionRate)}</b></div>
          <div className="kpi"><span className="muted">Conversion après ouverture popup</span><b>{pct(stats.data?.openConversionRate)}</b></div>
          <div className="kpi"><span className="muted">Commandes bloquées</span><b>{t.blocked?.count ?? 0}</b></div>
          <div className="kpi"><span className="muted">Formulaires abandonnés</span><b>{t.abandoned?.count ?? 0}</b></div>
          <div className="kpi"><span className="muted">Upsells 1-Click acceptés</span><b>{t.post_purchase_accepted?.count ?? 0}</b></div>
        </div>
      </Card>
      <Card title="Dernières commandes" actions={<button className="btn sm" onClick={() => go("orders")}>Tout voir</button>}>
        {!recent.data ? <Loading /> : (
          <div className="table-wrap">
            <table>
              <tbody>
                {recent.data.slice(0, 8).map((s) => (
                  <tr key={s.id}>
                    <td>{s.shopify_order_name ?? "—"}</td>
                    <td>{s.name ?? "—"}</td>
                    <td>{money(s.total, s.currency ?? cur)}</td>
                    <td>{statusBadge(s.status)}</td>
                    <td className="small">{date(s.created_at)}</td>
                  </tr>
                ))}
                {!recent.data.length && <tr><td className="muted">Aucune commande pour l'instant.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

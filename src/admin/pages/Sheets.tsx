import { useEffect, useState } from "react";
import { Badge, Card, ErrorBanner, Loading, Select, Text, Toggle, statusBadge, date, useAction, useLoad } from "../components/ui";
import { api } from "../lib/api";
import type { PageProps } from "../lib/types";

interface GoogleState {
  connection: {
    status: string;
    email: string | null;
    spreadsheetId: string | null;
    spreadsheetTitle: string | null;
    sheetTitle: string | null;
    mapping: { header: string; source: string }[];
    rowMode: "order" | "product";
    enabled: boolean;
    includeBlocked: boolean;
    lastError: string | null;
  } | null;
  sources: Record<string, string>;
  syncs: { submission_id: string; status: string; attempts: number; last_error: string | null; synced_at: string | null; updated_at: string; shopify_order_name: string | null }[];
  configured: boolean;
}

export function SheetsPage(_: PageProps) {
  const { data, error, reload } = useLoad<GoogleState>("/google");
  const forms = useLoad<{ config: { elements: { type: string; key?: string; label?: string }[] } }[]>("/forms");
  const { busy, run } = useAction();
  const [url, setUrl] = useState("");
  const [sheetInfo, setSheetInfo] = useState<{ id: string; title: string; sheets: { id: string; title: string }[] } | null>(null);
  const [cfg, setCfg] = useState<NonNullable<GoogleState["connection"]> | null>(null);
  const [headers, setHeaders] = useState<string[] | null>(null);

  useEffect(() => {
    if (data?.connection) setCfg(data.connection);
  }, [data]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "kbcod-google") void reload();
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [reload]);

  if (!data) return error ? <ErrorBanner error={error} /> : <Loading />;
  const c = data.connection;
  const formFields = new Map<string, string>();
  for (const f of forms.data ?? []) for (const el of f.config.elements) if (el.type === "field" && el.key) formFields.set(el.key, el.label || el.key);
  const sourceOptions = [
    ...Object.entries(data.sources).map(([k, l]) => ({ value: k, label: l })),
    ...[...formFields.entries()].map(([k, l]) => ({ value: `field:${k}`, label: `Champ : ${l}` })),
  ];

  const connect = async () => {
    const win = window.open("about:blank", "kbcod-google", "width=520,height=680");
    const r = await run(() => api<{ url: string }>("/google/auth-url", { body: {} }));
    if (r && win) win.location.href = r.url;
    else win?.close();
  };

  return (
    <>
      {!data.configured && <div className="banner warn">GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET ne sont pas configurés sur le serveur (voir guide d'installation).</div>}
      <Card title="Compte Google">
        {c && c.status === "connected" ? (
          <div className="row between">
            <div>
              <Badge tone="ok">Connecté</Badge> {c.email}
            </div>
            <div className="row">
              <button className="btn" onClick={connect}>Changer de compte</button>
              <button className="btn danger" disabled={busy} onClick={() => confirm("Déconnecter Google ? Les nouvelles commandes ne seront plus envoyées.") && run(() => api("/google/disconnect", { body: {} }), "Déconnecté").then(reload)}>Déconnecter</button>
            </div>
          </div>
        ) : (
          <div className="row between">
            <div>{c?.status === "revoked" ? <Badge tone="err">Connexion expirée ou révoquée</Badge> : <span className="muted">Aucun compte connecté.</span>}</div>
            <button className="btn primary" disabled={busy || !data.configured} onClick={connect}>Connecter Google</button>
          </div>
        )}
        <p className="muted small">Autorisation demandée : lecture/écriture de vos feuilles Google Sheets. Le jeton est chiffré sur le serveur et n'est jamais envoyé au navigateur.</p>
      </Card>

      {c && cfg && (
        <Card title="Fichier et feuille" actions={<button className="btn primary" disabled={busy || !cfg.spreadsheetId || !cfg.sheetTitle} onClick={() => run(() => api("/google/config", { method: "PUT", body: { ...cfg, spreadsheetId: cfg.spreadsheetId, spreadsheetTitle: cfg.spreadsheetTitle ?? "", sheetTitle: cfg.sheetTitle } }), "Configuration Sheets enregistrée").then(reload)}>Enregistrer</button>}>
          <div className="stack">
            <div className="row">
              <span>Fichier actuel : {cfg.spreadsheetTitle ? <b>{cfg.spreadsheetTitle}</b> : <span className="muted">aucun</span>}</span>
              {cfg.sheetTitle && <Badge tone="info">Feuille : {cfg.sheetTitle}</Badge>}
            </div>
            <div className="row" style={{ alignItems: "flex-end" }}>
              <div style={{ flex: 1, minWidth: 260 }}>
                <Text label="Lien du fichier Google Sheets" value={url} onChange={setUrl} placeholder="https://docs.google.com/spreadsheets/d/…" />
              </div>
              <button className="btn" disabled={busy || !url} onClick={async () => {
                const r = await run(() => api<typeof sheetInfo>("/google/spreadsheet", { body: { url } }));
                if (r) { setSheetInfo(r); setCfg({ ...cfg, spreadsheetId: r.id, spreadsheetTitle: r.title, sheetTitle: r.sheets[0]?.title ?? null }); }
              }}>Ouvrir</button>
              <button className="btn" disabled={busy} onClick={async () => {
                const title = prompt("Nom du nouveau fichier", "Commandes COD");
                if (!title) return;
                const r = await run(() => api<typeof sheetInfo>("/google/create", { body: { title } }), "Fichier créé");
                if (r) { setSheetInfo(r); setCfg({ ...cfg, spreadsheetId: r.id, spreadsheetTitle: r.title, sheetTitle: r.sheets[0]?.title ?? null }); }
              }}>Créer un fichier</button>
            </div>
            {sheetInfo && (
              <Select label="Feuille (onglet)" value={cfg.sheetTitle ?? ""} onChange={(v) => setCfg({ ...cfg, sheetTitle: v })} options={sheetInfo.sheets.map((s) => ({ value: s.title, label: s.title }))} />
            )}
            <Select label="Format" value={cfg.rowMode} onChange={(v) => setCfg({ ...cfg, rowMode: v })} options={[{ value: "order", label: "Une ligne par commande" }, { value: "product", label: "Une ligne par produit" }]} />
            <Toggle label="Synchronisation automatique activée" checked={cfg.enabled} onChange={(v) => setCfg({ ...cfg, enabled: v })} />
            <Toggle label="Inclure aussi les commandes bloquées" checked={cfg.includeBlocked} onChange={(v) => setCfg({ ...cfg, includeBlocked: v })} />
            <h3>Correspondance des colonnes</h3>
            <p className="muted small">Chaque en-tête doit exister dans la ligne 1 de la feuille. Les nouvelles lignes sont toujours ajoutées à la fin : aucune donnée existante n'est écrasée.</p>
            {cfg.mapping.map((m, i) => (
              <div key={i} className="mapping-row">
                <input type="text" value={m.header} onChange={(e) => setCfg({ ...cfg, mapping: cfg.mapping.map((x, j) => (j === i ? { ...x, header: e.target.value } : x)) })} placeholder="En-tête de colonne" aria-label="En-tête" />
                <select value={m.source} onChange={(e) => setCfg({ ...cfg, mapping: cfg.mapping.map((x, j) => (j === i ? { ...x, source: e.target.value } : x)) })}>
                  {sourceOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  {!sourceOptions.some((o) => o.value === m.source) && <option value={m.source}>{m.source}</option>}
                </select>
                <button className="icon-btn" onClick={() => setCfg({ ...cfg, mapping: cfg.mapping.filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
            <div className="row">
              <button className="btn" onClick={() => setCfg({ ...cfg, mapping: [...cfg.mapping, { header: "Nouvelle colonne", source: "date" }] })}>+ Colonne</button>
              <button className="btn" disabled={busy || !c.spreadsheetId} onClick={async () => { const r = await run(() => api<{ headers: string[] }>("/google/headers", { body: {} })); if (r) setHeaders(r.headers); }}>Lire les en-têtes de la feuille</button>
              <button className="btn" disabled={busy || !c.spreadsheetId} onClick={() => run(() => api<{ written: boolean }>("/google/write-headers", { body: {} })).then((r) => r && alert(r.written ? "En-têtes écrits en ligne 1." : "La ligne 1 n'est pas vide : rien n'a été modifié."))}>Écrire les en-têtes (ligne 1 vide)</button>
            </div>
            {headers && (
              <div className="small">
                En-têtes trouvés : {headers.filter(Boolean).map((h) => <Badge key={h} tone={cfg.mapping.some((m) => m.header.trim().toLowerCase() === h.toLowerCase()) ? "ok" : undefined}>{h}</Badge>)}
                {cfg.mapping.filter((m) => !headers.some((h) => h.toLowerCase() === m.header.trim().toLowerCase())).map((m) => <Badge key={m.header} tone="err">manquant : {m.header}</Badge>)}
              </div>
            )}
          </div>
        </Card>
      )}

      <Card title="Historique des synchronisations" actions={<><button className="btn" onClick={reload}>Actualiser</button><button className="btn primary" disabled={busy} onClick={() => run(() => api("/google/retry-all", { body: {} }), "Relance effectuée").then(reload)}>Relancer les échecs</button></>}>
        {c?.lastError && <div className="banner err">Dernière erreur : {c.lastError}</div>}
        <div className="table-wrap">
          <table>
            <thead><tr><th>Commande</th><th>Statut</th><th>Tentatives</th><th>Erreur</th><th>Synchronisée</th></tr></thead>
            <tbody>
              {data.syncs.map((s) => (
                <tr key={s.submission_id}>
                  <td>{s.shopify_order_name ?? "—"}</td>
                  <td>{statusBadge(s.status)}</td>
                  <td>{s.attempts}</td>
                  <td className="small muted">{s.last_error ?? ""}</td>
                  <td className="small">{date(s.synced_at)}</td>
                </tr>
              ))}
              {!data.syncs.length && <tr><td colSpan={5} className="empty">Aucune synchronisation.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

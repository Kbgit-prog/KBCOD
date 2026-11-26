import { useState } from "react";
import { newId } from "../../shared/defaults";
import { Badge, Card, ErrorBanner, Loading, Num, Select, Text, Toggle, date, useAction, useLoad } from "../components/ui";
import { api } from "../lib/api";
import type { PageProps } from "../lib/types";

const IDENT = [
  { value: "phone", label: "Numéro de téléphone" },
  { value: "ip", label: "Adresse IP" },
  { value: "ip_phone", label: "IP + téléphone" },
  { value: "device", label: "Navigateur (identifiant local)" },
  { value: "email", label: "E-mail" },
] as const;

export function FraudPage({ boot, reloadBoot }: PageProps) {
  const [f, setF] = useState(boot.settings.fraud);
  const [otp, setOtp] = useState(boot.settings.otp);
  const lists = useLoad<any[]>("/lists");
  const events = useLoad<any[]>("/fraud/events");
  const [entry, setEntry] = useState({ list: "block", kind: "phone", value: "", reason: "", expiresInDays: null as number | null });
  const { busy, run } = useAction();
  const save = () => run(() => api("/settings", { method: "PUT", body: { fraud: f, otp } }), "Règles enregistrées").then(reloadBoot);

  return (
    <>
      <Card title="Protection des commandes" actions={<button className="btn primary" disabled={busy} onClick={save}>Enregistrer</button>}>
        <div className="stack">
          <Toggle label="Antifraude activé" checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} />
          <h3>Limites sur fenêtre glissante</h3>
          <p className="muted small">
            La période est calculée à partir de l'instant de la tentative (ex. 72 h = les 72 dernières heures), sans remise à zéro à minuit. Une IP pouvant être partagée (Wi-Fi, opérateur mobile), préférez « Signaler » pour l'IP.
          </p>
          {f.rules.map((r, i) => (
            <div key={r.id} className="card" style={{ background: "#fafafa", marginBottom: 0 }}>
              <div className="grid3">
                <Select label="Identifiant" value={r.identifier} onChange={(v) => setF({ ...f, rules: f.rules.map((x, j) => (j === i ? { ...x, identifier: v } : x)) })} options={IDENT as any} />
                <Num label="Commandes max." value={r.maxOrders} min={1} onChange={(v) => setF({ ...f, rules: f.rules.map((x, j) => (j === i ? { ...x, maxOrders: v ?? 1 } : x)) })} />
                <Num label="Sur les dernières … heures" value={r.windowHours} min={0.1} step={1} onChange={(v) => setF({ ...f, rules: f.rules.map((x, j) => (j === i ? { ...x, windowHours: v ?? 72 } : x)) })} />
                <Select label="Action" value={r.action} onChange={(v) => setF({ ...f, rules: f.rules.map((x, j) => (j === i ? { ...x, action: v } : x)) })} options={[{ value: "block", label: "Refuser la commande" }, { value: "otp", label: "Exiger un code OTP" }, { value: "flag", label: "Accepter et signaler (étiquette)" }]} />
                <Text label="Message au client (facultatif)" value={r.message} onChange={(v) => setF({ ...f, rules: f.rules.map((x, j) => (j === i ? { ...x, message: v } : x)) })} />
              </div>
              <div className="row">
                <Toggle label="Active" checked={r.enabled} onChange={(v) => setF({ ...f, rules: f.rules.map((x, j) => (j === i ? { ...x, enabled: v } : x)) })} />
                <button className="btn sm danger" onClick={() => setF({ ...f, rules: f.rules.filter((_, j) => j !== i) })}>Supprimer</button>
              </div>
            </div>
          ))}
          <button className="btn" onClick={() => setF({ ...f, rules: [...f.rules, { id: newId("r"), enabled: true, identifier: "phone", maxOrders: 2, windowHours: 72, action: "block", message: "" }] })}>+ Ajouter une limite</button>
          <h3>Autres protections</h3>
          <div className="grid3">
            <Num label="Quantité max. par commande" value={f.maxQuantityPerOrder} nullable min={1} onChange={(v) => setF({ ...f, maxQuantityPerOrder: v })} />
            <Num label="Tentatives max. par IP / 10 min" value={f.attemptsPer10Min} min={1} onChange={(v) => setF({ ...f, attemptsPer10Min: v ?? 15 })} />
            <Num label="Délai minimal de remplissage (ms)" value={f.minFillMs} min={0} max={60000} onChange={(v) => setF({ ...f, minFillMs: v ?? 0 })} hint="Envoi plus rapide = robot probable." />
            <Text label="Étiquette des commandes signalées" value={f.flagTag} onChange={(v) => setF({ ...f, flagTag: v })} />
            <Text label="Indicatifs autorisés (vide = tous)" value={f.allowedCallingCodes.join(", ")} onChange={(v) => setF({ ...f, allowedCallingCodes: v.split(/[,\s]+/).map((x) => x.replace(/\D/g, "")).filter(Boolean) })} hint="Ex. 225 pour la Côte d'Ivoire" />
          </div>
          <Toggle label="Champ piège invisible (anti-robot)" checked={f.honeypot} onChange={(v) => setF({ ...f, honeypot: v })} />
          <Toggle label="Cloudflare Turnstile (gratuit, nécessite TURNSTILE_SECRET sur le serveur)" checked={f.turnstile.enabled} onChange={(v) => setF({ ...f, turnstile: { ...f.turnstile, enabled: v } })} />
          {f.turnstile.enabled && <Text label="Clé de site Turnstile" value={f.turnstile.siteKey} onChange={(v) => setF({ ...f, turnstile: { ...f.turnstile, siteKey: v.trim() } })} />}
        </div>
      </Card>

      <Card title="Vérification OTP" actions={<button className="btn primary" disabled={busy} onClick={save}>Enregistrer</button>}>
        <div className="stack">
          <Toggle label="Activer l'OTP" checked={otp.enabled} onChange={(v) => setOtp({ ...otp, enabled: v })} hint="Nécessite un fournisseur SMS ou WhatsApp (page SMS / WhatsApp). Chaque code envoyé est facturé par le fournisseur." />
          <div className="grid3">
            <Select label="Quand" value={otp.mode} onChange={(v) => setOtp({ ...otp, mode: v })} options={[{ value: "rules", label: "Seulement si une règle l'exige" }, { value: "always", label: "Pour chaque commande" }]} />
            <Select label="Canal" value={otp.channel} onChange={(v) => setOtp({ ...otp, channel: v })} options={[{ value: "sms", label: "SMS" }, { value: "whatsapp", label: "WhatsApp" }]} />
            <Num label="Longueur du code" value={otp.codeLength} min={4} max={8} onChange={(v) => setOtp({ ...otp, codeLength: v ?? 4 })} />
            <Num label="Validité (minutes)" value={otp.ttlMinutes} min={1} max={30} onChange={(v) => setOtp({ ...otp, ttlMinutes: v ?? 10 })} />
            <Num label="Essais max." value={otp.maxAttempts} min={1} max={10} onChange={(v) => setOtp({ ...otp, maxAttempts: v ?? 5 })} />
            <Num label="Envois max." value={otp.maxSends} min={1} max={5} onChange={(v) => setOtp({ ...otp, maxSends: v ?? 3 })} />
            <Text label="Étiquette « vérifié »" value={otp.verifiedTag} onChange={(v) => setOtp({ ...otp, verifiedTag: v })} />
          </div>
          <Text label="Message" value={otp.template} onChange={(v) => setOtp({ ...otp, template: v })} hint="Variables : {code}, {shop_name}" />
          <p className="muted small">Si l'OTP est exigé mais qu'aucun fournisseur ne fonctionne, la commande est créée et signalée plutôt que perdue.</p>
        </div>
      </Card>

      <Card title="Listes noire et blanche">
        <div className="grid3" style={{ alignItems: "end" }}>
          <Select label="Liste" value={entry.list} onChange={(v) => setEntry({ ...entry, list: v })} options={[{ value: "block", label: "Liste noire (bloquer)" }, { value: "allow", label: "Liste blanche (toujours accepter)" }]} />
          <Select label="Type" value={entry.kind} onChange={(v) => setEntry({ ...entry, kind: v })} options={[{ value: "phone", label: "Téléphone" }, { value: "ip", label: "IP" }, { value: "email", label: "E-mail" }, { value: "phone_prefix", label: "Préfixe de téléphone (+22501…)" }, { value: "ip_prefix", label: "Préfixe IP (ex. 41.66.12.)" }]} />
          <Text label="Valeur" value={entry.value} onChange={(v) => setEntry({ ...entry, value: v })} />
          <Text label="Motif" value={entry.reason} onChange={(v) => setEntry({ ...entry, reason: v })} />
          <Num label="Expire dans (jours)" value={entry.expiresInDays} nullable min={1} onChange={(v) => setEntry({ ...entry, expiresInDays: v })} />
          <button className="btn primary" disabled={busy || !entry.value} onClick={() => run(() => api("/lists", { body: entry }), "Ajouté").then(() => (setEntry({ ...entry, value: "", reason: "" }), lists.reload()))}>Ajouter</button>
        </div>
        <p className="muted small">Téléphones, e-mails et IP sont stockés sous forme d'empreinte (non lisible) ; seul un affichage masqué est conservé.</p>
        <ErrorBanner error={lists.error} />
        {!lists.data ? <Loading /> : (
          <table>
            <tbody>
              {lists.data.map((l) => (
                <tr key={l.id}>
                  <td>{l.list === "block" ? <Badge tone="err">Bloqué</Badge> : <Badge tone="ok">Autorisé</Badge>}</td>
                  <td>{l.kind}</td>
                  <td><code>{l.display}</code></td>
                  <td className="small muted">{l.reason}</td>
                  <td className="small">{l.expires_at ? `expire ${date(l.expires_at)}` : "permanent"}</td>
                  <td><button className="icon-btn" onClick={() => run(() => api(`/lists/${l.id}`, { method: "DELETE" })).then(lists.reload)}>✕</button></td>
                </tr>
              ))}
              {!lists.data.length && <tr><td className="empty">Listes vides.</td></tr>}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Historique antifraude" actions={<button className="btn" onClick={events.reload}>Actualiser</button>}>
        {!events.data ? <Loading /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Règle</th><th>Action</th></tr></thead>
              <tbody>
                {events.data.map((e, i) => (
                  <tr key={i}>
                    <td className="small">{date(e.created_at)}</td>
                    <td><code>{e.rule}</code></td>
                    <td>{e.action === "block" || e.action === "limit" ? <Badge tone="err">{e.action}</Badge> : <Badge tone="warn">{e.action}</Badge>}</td>
                  </tr>
                ))}
                {!events.data.length && <tr><td colSpan={3} className="empty">Aucun événement.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

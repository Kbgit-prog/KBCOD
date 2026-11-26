import { useState } from "react";
import { Badge, Card, Loading, Select, Text, Toggle, date, useAction, useLoad } from "../components/ui";
import { api } from "../lib/api";
import type { PageProps } from "../lib/types";

export function MessagingPage({ boot, reloadBoot }: PageProps) {
  const [p, setP] = useState(boot.settings.providers);
  const [n, setN] = useState(boot.settings.notifications);
  const [secret, setSecret] = useState("");
  const [waToken, setWaToken] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const logs = useLoad<any[]>("/messages");
  const { busy, run } = useAction();
  const save = async () => {
    await run(async () => {
      await api("/settings", { method: "PUT", body: { providers: p, notifications: n } });
      if (secret || waToken) await api("/settings/secrets", { method: "PUT", body: { ...(secret ? { smsSecret: secret } : {}), ...(waToken ? { whatsappToken: waToken } : {}) } });
    }, "Enregistré");
    setSecret("");
    setWaToken("");
    await reloadBoot();
  };
  const tpl = (k: "orderConfirmation" | "shipping" | "abandoned", title: string) => (
    <div className="card" style={{ background: "#fafafa" }}>
      <div className="row between"><b>{title}</b><Toggle label="Actif" checked={n[k].enabled} onChange={(v) => setN({ ...n, [k]: { ...n[k], enabled: v } })} /></div>
      <Select label="Canal" value={n[k].channel} onChange={(v) => setN({ ...n, [k]: { ...n[k], channel: v } })} options={[{ value: "whatsapp", label: "WhatsApp" }, { value: "sms", label: "SMS" }]} />
      <Text label="Message" multiline value={n[k].template} onChange={(v) => setN({ ...n, [k]: { ...n[k], template: v } })} hint="Variables : {name}, {order_name}, {total}, {shop_name}, {order_status_url}" />
    </div>
  );
  return (
    <>
      <div className="banner warn">Les SMS et messages WhatsApp sont facturés par le fournisseur (Twilio, Meta…). Rien n'est envoyé tant qu'aucun fournisseur n'est configuré et activé.</div>
      <Card title="Fournisseurs" actions={<button className="btn primary" disabled={busy} onClick={save}>Enregistrer</button>}>
        <div className="stack">
          <Select label="Fournisseur SMS" value={p.smsProvider} onChange={(v) => setP({ ...p, smsProvider: v })} options={[{ value: "none", label: "Aucun" }, { value: "twilio", label: "Twilio" }, { value: "webhook", label: "Webhook (votre passerelle SMS)" }]} />
          {p.smsProvider === "twilio" && (
            <div className="grid3">
              <Text label="Account SID" value={p.twilioAccountSid} onChange={(v) => setP({ ...p, twilioAccountSid: v.trim() })} />
              <Text label="Numéro / Sender ID" value={p.twilioFrom} onChange={(v) => setP({ ...p, twilioFrom: v.trim() })} />
              <Text label={`Auth Token${p.hasSmsSecret ? " (enregistré)" : ""}`} type="password" value={secret} onChange={setSecret} />
            </div>
          )}
          {p.smsProvider === "webhook" && (
            <div className="grid2">
              <Text label="URL du webhook (POST JSON)" value={p.webhookUrl} onChange={(v) => setP({ ...p, webhookUrl: v.trim() })} />
              <Text label={`Secret de signature${p.hasSmsSecret ? " (enregistré)" : ""}`} type="password" value={secret} onChange={setSecret} hint="En-tête X-KBCOD-Signature = HMAC-SHA256 base64 du corps." />
            </div>
          )}
          <h3>WhatsApp Cloud API (Meta)</h3>
          <div className="grid3">
            <Text label="Phone number ID" value={p.whatsappPhoneNumberId} onChange={(v) => setP({ ...p, whatsappPhoneNumberId: v.trim() })} />
            <Text label="Langue du modèle" value={p.whatsappLanguage} onChange={(v) => setP({ ...p, whatsappLanguage: v.trim() })} />
            <Text label={`Jeton d'accès${p.hasWhatsappToken ? " (enregistré)" : ""}`} type="password" value={waToken} onChange={setWaToken} />
          </div>
          <Text label="Nom du modèle approuvé (recommandé)" value={n.whatsappTemplateName} onChange={(v) => setN({ ...n, whatsappTemplateName: v.trim() })} hint="Hors fenêtre de 24 h, WhatsApp n'autorise que des modèles approuvés. Le message est passé en paramètre {{1}}." />
          <div className="row" style={{ alignItems: "end" }}>
            <Text label="Numéro de test" value={testPhone} onChange={setTestPhone} />
            <button className="btn" disabled={busy || !testPhone} onClick={() => run(() => api("/messages/test", { body: { phone: testPhone, channel: "sms" } }), "SMS de test envoyé")}>Tester SMS</button>
            <button className="btn" disabled={busy || !testPhone} onClick={() => run(() => api("/messages/test", { body: { phone: testPhone, channel: "whatsapp" } }), "WhatsApp de test envoyé")}>Tester WhatsApp</button>
          </div>
        </div>
      </Card>
      <Card title="Notifications automatiques" actions={<button className="btn primary" disabled={busy} onClick={save}>Enregistrer</button>}>
        {tpl("orderConfirmation", "Confirmation de commande")}
        {tpl("shipping", "Expédition (traitement créé dans Shopify)")}
        {tpl("abandoned", "Relance de formulaire abandonné (clients ayant consenti)")}
      </Card>
      <Card title="Journal des messages" actions={<button className="btn" onClick={logs.reload}>Actualiser</button>}>
        {!logs.data ? <Loading /> : (
          <table>
            <tbody>
              {logs.data.map((l, i) => (
                <tr key={i}>
                  <td className="small">{date(l.created_at)}</td>
                  <td>{l.channel}</td>
                  <td>{l.template}</td>
                  <td>{l.to_masked}</td>
                  <td>{l.status === "sent" ? <Badge tone="ok">envoyé</Badge> : <Badge tone="err">échec</Badge>}</td>
                  <td className="small muted">{l.error}</td>
                </tr>
              ))}
              {!logs.data.length && <tr><td className="empty">Aucun message.</td></tr>}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

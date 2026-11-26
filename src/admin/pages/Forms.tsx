import { useState } from "react";
import { Badge, Card, ErrorBanner, Loading, date, useAction, useLoad } from "../components/ui";
import { api } from "../lib/api";
import type { PageProps } from "../lib/types";
import { FormBuilder, type FormRecord } from "./FormBuilder";

export function FormsPage(props: PageProps) {
  const { data, error, reload } = useLoad<(FormRecord & { updated_at: string })[]>("/forms");
  const [editing, setEditing] = useState<FormRecord | null>(null);
  const { busy, run } = useAction();

  if (editing) {
    return (
      <FormBuilder
        {...props}
        form={editing}
        onClose={() => {
          setEditing(null);
          void reload();
        }}
      />
    );
  }
  if (!data) return error ? <ErrorBanner error={error} /> : <Loading />;
  return (
    <Card
      title="Formulaires"
      actions={
        <button
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            const name = prompt("Nom du nouveau formulaire", "Formulaire produit");
            if (!name) return;
            const f = await run(() => api<FormRecord>("/forms", { body: { name } }), "Formulaire créé");
            if (f) setEditing({ ...f, products: [] });
          }}
        >
          Nouveau formulaire
        </button>
      }
    >
      <p className="muted small">
        Le formulaire principal s'applique à toute la boutique. Créez d'autres formulaires et associez-les à des produits précis (onglet « Produits » du constructeur).
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nom</th>
              <th>Type</th>
              <th>Produits</th>
              <th>Statut</th>
              <th>Modifié</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map((f) => (
              <tr key={f.id}>
                <td>
                  <b>{f.name}</b> {f.is_default && <Badge tone="info">Principal</Badge>}
                </td>
                <td>{f.config.settings.mode === "popup" ? "Popup" : "Embedded"}</td>
                <td>{f.is_default ? <span className="muted">Tous les autres</span> : f.products.length}</td>
                <td>{f.active ? <Badge tone="ok">Actif</Badge> : <Badge>Inactif</Badge>}</td>
                <td className="small">{date(f.updated_at)}</td>
                <td>
                  <div className="row">
                    <button className="btn sm primary" onClick={() => setEditing(f)}>
                      Modifier
                    </button>
                    <button className="btn sm" disabled={busy} onClick={() => run(() => api(`/forms/${f.id}/duplicate`, { body: {} }), "Formulaire dupliqué").then(reload)}>
                      Dupliquer
                    </button>
                    {!f.is_default && (
                      <>
                        <button className="btn sm" disabled={busy} onClick={() => run(() => api(`/forms/${f.id}`, { method: "PUT", body: { active: !f.active } }), f.active ? "Désactivé" : "Activé").then(reload)}>
                          {f.active ? "Désactiver" : "Activer"}
                        </button>
                        {f.active && (
                          <button className="btn sm" disabled={busy} onClick={() => confirm("Définir comme formulaire principal ?") && run(() => api(`/forms/${f.id}/default`, { body: {} }), "Formulaire principal modifié").then(reload)}>
                            Définir principal
                          </button>
                        )}
                        <button className="btn sm danger" disabled={busy} onClick={() => confirm(`Supprimer « ${f.name} » ?`) && run(() => api(`/forms/${f.id}`, { method: "DELETE" }), "Formulaire supprimé").then(reload)}>
                          Supprimer
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

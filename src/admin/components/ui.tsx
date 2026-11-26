import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, errorText, toast } from "../lib/api";

export function Card({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && (
        <div className="row between" style={{ marginBottom: 12 }}>
          {title ? <h2 style={{ margin: 0 }}>{title}</h2> : <span />}
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Text({ label, value, onChange, hint, placeholder, type = "text", multiline, code, maxLength }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
  placeholder?: string;
  type?: string;
  multiline?: boolean;
  code?: boolean;
  maxLength?: number;
}) {
  return (
    <label className="field">
      {label}
      {multiline ? (
        <textarea className={code ? "code" : ""} value={value} placeholder={placeholder} maxLength={maxLength} spellCheck={!code} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input type={type} value={value} placeholder={placeholder} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />
      )}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Num({ label, value, onChange, min, max, step = 1, hint, nullable }: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: ReactNode;
  nullable?: boolean;
}) {
  return (
    <label className="field">
      {label}
      <input
        type="number"
        value={value ?? ""}
        min={min}
        max={max}
        step={step}
        placeholder={nullable ? "—" : undefined}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "" && nullable) return onChange(null);
          const n = Number(raw);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode }) {
  return (
    <div>
      <label className="check">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
      </label>
      {hint && <div className="muted small" style={{ marginLeft: 24 }}>{hint}</div>}
    </div>
  );
}

export function Select<T extends string>({ label, value, onChange, options, hint }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; hint?: ReactNode }) {
  return (
    <label className="field">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Color({ label, value, onChange, nullable }: { label: string; value: string | null; onChange: (v: string | null) => void; nullable?: boolean }) {
  const hex = value && /^#[0-9a-fA-F]{6}/.test(value) ? value.slice(0, 7) : "#000000";
  return (
    <label className="field">
      {label}
      <div className="color-row">
        <input type="color" value={hex} onChange={(e) => onChange(e.target.value + (value && value.length === 9 ? value.slice(7) : ""))} />
        <input type="text" value={value ?? ""} placeholder={nullable ? "Par défaut" : ""} onChange={(e) => onChange(e.target.value || (nullable ? null : "#000000"))} />
        {nullable && value && (
          <button type="button" className="icon-btn" onClick={() => onChange(null)} title="Réinitialiser">
            ↺
          </button>
        )}
      </div>
    </label>
  );
}

export function Badge({ tone, children }: { tone?: "ok" | "warn" | "err" | "info"; children: ReactNode }) {
  return <span className={`badge ${tone ?? ""}`}>{children}</span>;
}

export function statusBadge(status: string | null | undefined) {
  const map: Record<string, ["ok" | "warn" | "err" | "info" | undefined, string]> = {
    created: ["ok", "Créée"],
    processing: ["info", "En cours"],
    uncertain: ["warn", "Incertaine"],
    failed: ["err", "Échec"],
    blocked: ["err", "Bloquée"],
    otp_pending: ["warn", "OTP en attente"],
    synced: ["ok", "Synchronisée"],
    pending: ["info", "En attente"],
    running: ["info", "En cours"],
    retrying: ["warn", "Échec temporaire"],
    action_required: ["err", "Intervention requise"],
    sent: ["ok", "Envoyé"],
    skipped: [undefined, "Ignoré"],
    done: ["ok", "Terminé"],
    dead: ["err", "Abandonné"],
    open: ["info", "En cours"],
    abandoned: ["warn", "Abandonné"],
    converted: ["ok", "Converti"],
    recovered: ["ok", "Récupéré"],
    dismissed: [undefined, "Ignoré"],
    connected: ["ok", "Connecté"],
    revoked: ["err", "Révoqué"],
  };
  if (!status) return <span className="muted">—</span>;
  const [tone, label] = map[status] ?? [undefined, status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function useLoad<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, setData, error, loading, reload };
}

export function useAction() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setBusy(true);
    try {
      const r = await fn();
      if (success) toast(success);
      return r;
    } catch (e) {
      toast(errorText(e), true);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, run };
}

export function Loading() {
  return (
    <div className="empty">
      <span className="spinner" />
    </div>
  );
}

export function ErrorBanner({ error }: { error: string | null }) {
  return error ? <div className="banner err">{error}</div> : null;
}

export function money(minor: number | null | undefined, currency = "XOF") {
  if (minor === null || minor === undefined) return "—";
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: 2 }).format(minor / 100);
  } catch {
    return (minor / 100).toFixed(2);
  }
}

export function date(d: string | null | undefined) {
  return d ? new Date(d).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—";
}

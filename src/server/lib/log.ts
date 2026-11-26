type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE = /(token|secret|password|authorization|phone|email|address|code)/i;

function scrub(v: unknown, depth = 0): unknown {
  if (depth > 4 || v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => scrub(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = SENSITIVE.test(k) ? "[masqué]" : scrub(val, depth + 1);
  }
  return out;
}

/** Journal JSON sans données personnelles (les clés sensibles sont masquées). */
export function log(level: Level, msg: string, data?: Record<string, unknown>): void {
  const min = (process.env.LOG_LEVEL as Level) ?? "info";
  if (order[level] < (order[min] ?? 20)) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(data ? (scrub(data) as object) : {}) });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

import { sql } from "../db";
import { errMsg, log } from "../lib/log";

export interface JobRow {
  id: string;
  shop_id: string | null;
  type: string;
  dedupe_key: string;
  payload: any;
  status: string;
  attempts: number;
  max_attempts: number;
  run_at: Date;
  last_error: string | null;
}

/** Erreur définitive : pas de nouvelle tentative (intervention requise). */
export class PermanentJobError extends Error {}

export type JobHandler = (job: JobRow) => Promise<unknown>;
const handlers = new Map<string, JobHandler>();

export function registerJob(type: string, handler: JobHandler): void {
  handlers.set(type, handler);
}

/** Ajoute un travail. La clé de déduplication rend l'ajout idempotent. */
export async function enqueue(
  type: string,
  dedupeKey: string,
  payload: Record<string, unknown>,
  opts: { shopId?: string | null; runAt?: Date; maxAttempts?: number } = {},
): Promise<string | null> {
  const [row] = await sql()<{ id: string }[]>`
    INSERT INTO jobs (shop_id, type, dedupe_key, payload, run_at, max_attempts)
    VALUES (${opts.shopId ?? null}, ${type}, ${dedupeKey}, ${sql().json(payload as any)}, ${opts.runAt ?? new Date()}, ${opts.maxAttempts ?? 8})
    ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`;
  return row?.id ?? null;
}

/** Délai progressif : 30 s, 2 min, 8 min, 30 min, 2 h, 6 h, 12 h, 24 h. */
export function backoffMs(attempt: number): number {
  const steps = [30_000, 120_000, 480_000, 1_800_000, 7_200_000, 21_600_000, 43_200_000, 86_400_000];
  return steps[Math.min(Math.max(attempt - 1, 0), steps.length - 1)]!;
}

async function claim(limit: number, ids?: string[]): Promise<JobRow[]> {
  // Les verrous de plus de 5 min (fonction interrompue) sont repris.
  return sql()<JobRow[]>`
    UPDATE jobs SET status = 'running', locked_at = now(), attempts = attempts + 1, updated_at = now()
    WHERE id IN (
      SELECT id FROM jobs
      WHERE ((status IN ('pending','failed') AND run_at <= now())
         OR (status = 'running' AND locked_at < now() - interval '5 minutes'))
        ${ids ? sql()`AND id = ANY(${ids})` : sql()``}
      ORDER BY run_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *`;
}

export async function runJob(job: JobRow): Promise<"done" | "failed" | "dead"> {
  const handler = handlers.get(job.type);
  try {
    if (!handler) throw new PermanentJobError(`Type de travail inconnu : ${job.type}`);
    const result = await handler(job);
    await sql()`UPDATE jobs SET status = 'done', locked_at = NULL, last_error = NULL,
      result = ${result === undefined ? null : sql().json(result as any)}, updated_at = now() WHERE id = ${job.id}`;
    return "done";
  } catch (e) {
    const permanent = e instanceof PermanentJobError;
    const dead = permanent || job.attempts >= job.max_attempts;
    const next = new Date(Date.now() + backoffMs(job.attempts));
    await sql()`UPDATE jobs SET status = ${dead ? "dead" : "failed"}, locked_at = NULL, last_error = ${errMsg(e).slice(0, 2000)},
      run_at = ${next}, updated_at = now() WHERE id = ${job.id}`;
    log(dead ? "error" : "warn", "job.failed", { id: job.id, type: job.type, attempts: job.attempts, dead, error: errMsg(e) });
    return dead ? "dead" : "failed";
  }
}

/** Traite les travaux dus pendant au plus `budgetMs`. */
export async function processDueJobs(opts: { budgetMs?: number; batch?: number; ids?: string[] } = {}) {
  const deadline = Date.now() + (opts.budgetMs ?? 20_000);
  const stats = { done: 0, failed: 0, dead: 0 };
  while (Date.now() < deadline) {
    const jobs = await claim(opts.batch ?? 5, opts.ids);
    if (!jobs.length) break;
    const results = await Promise.all(jobs.map(runJob));
    for (const r of results) stats[r]++;
    if (opts.ids) break;
  }
  return stats;
}

/** Relance manuelle (depuis l'admin) d'un travail échoué ou mort, sans changer sa clé. */
export async function retryJob(shopId: string, jobId: string): Promise<boolean> {
  const rows = await sql()`UPDATE jobs SET status = 'pending', run_at = now(), attempts = 0, last_error = NULL, updated_at = now()
    WHERE id = ${jobId} AND shop_id = ${shopId} AND status IN ('failed','dead') RETURNING id`;
  return rows.length > 0;
}

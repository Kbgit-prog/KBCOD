import { sql } from "../db";
import { checkAbandoned } from "./abandoned";
import { registerJob } from "./jobs";
import { sendStage, type Stage } from "./meta";
import { notifyOrder, type NotifyKind } from "./notify";
import { reconcileSubmission } from "./orders";
import { syncSubmissionToSheet } from "./sheets";
import { shopSettings, type ShopRow } from "./shops";

let registered = false;

export function registerAllJobs(): void {
  if (registered) return;
  registered = true;
  registerJob("sheets.sync", (j) => syncSubmissionToSheet(j.shop_id!, j.payload.submissionId));
  registerJob("meta.stage", (j) => sendStage(j.shop_id!, j.payload.submissionId, j.payload.stage as Stage));
  registerJob("notify.order", (j) => notifyOrder(j.shop_id!, j.payload.submissionId, j.payload.kind as NotifyKind));
  registerJob("order.reconcile", (j) => reconcileSubmission(j.shop_id!, j.payload.submissionId));
  registerJob("abandoned.check", (j) => checkAbandoned(j.shop_id!, j.payload.id));
}

/** Purge selon les durées de conservation (exécutée par le cron). */
export async function maintenance(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  out.jobs = (await sql()`DELETE FROM jobs WHERE status IN ('done','cancelled') AND updated_at < now() - interval '14 days' RETURNING id`).length;
  out.attempts = (await sql()`DELETE FROM attempts WHERE created_at < now() - interval '30 days' RETURNING id`).length;
  out.otp = (await sql()`DELETE FROM otp_challenges WHERE created_at < now() - interval '7 days' RETURNING id`).length;
  out.receipts = (await sql()`DELETE FROM webhook_receipts WHERE received_at < now() - interval '7 days' RETURNING webhook_id`).length;
  const shops = await sql()<ShopRow[]>`SELECT * FROM shops`;
  let subs = 0;
  let ab = 0;
  for (const s of shops) {
    const st = shopSettings(s);
    subs += (await sql()`DELETE FROM submissions WHERE shop_id = ${s.id} AND created_at < now() - make_interval(days => ${st.dataRetentionDays}) RETURNING id`).length;
    ab += (await sql()`DELETE FROM abandoned WHERE shop_id = ${s.id} AND created_at < now() - make_interval(days => ${st.abandoned.retentionDays}) RETURNING id`).length;
  }
  out.submissions = subs;
  out.abandoned = ab;
  return out;
}

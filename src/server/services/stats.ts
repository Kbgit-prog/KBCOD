import { sql } from "../db";

export const METRICS = ["form_view", "form_open", "orders", "blocked", "abandoned", "upsell_accepted", "post_purchase_accepted", "downsell_accepted"] as const;

/** Incrémente un compteur journalier (UTC). */
export async function bumpStat(shopId: string, formId: string | null, metric: string, amountMinor = 0, count = 1): Promise<void> {
  await sql()`INSERT INTO stats_daily (shop_id, day, form_id, metric, count, amount_minor)
    VALUES (${shopId}, (now() AT TIME ZONE 'utc')::date, ${formId}, ${metric}, ${count}, ${amountMinor})
    ON CONFLICT (shop_id, day, coalesce(form_id, '00000000-0000-0000-0000-000000000000'::uuid), metric)
    DO UPDATE SET count = stats_daily.count + EXCLUDED.count, amount_minor = stats_daily.amount_minor + EXCLUDED.amount_minor`;
}

export async function statsSummary(shopId: string, days: number) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await sql()<{ day: string; metric: string; count: number; amount: number }[]>`
    SELECT to_char(day, 'YYYY-MM-DD') AS day, metric, sum(count)::int AS count, sum(amount_minor)::bigint::float8 AS amount
    FROM stats_daily WHERE shop_id = ${shopId} AND day >= ${since}::date GROUP BY day, metric ORDER BY day`;
  const totals: Record<string, { count: number; amount: number }> = {};
  for (const r of rows) {
    const t = (totals[r.metric] ??= { count: 0, amount: 0 });
    t.count += r.count;
    t.amount += Number(r.amount);
  }
  const views = totals.form_view?.count ?? 0;
  const opens = totals.form_open?.count ?? 0;
  const orders = totals.orders?.count ?? 0;
  return {
    days,
    series: rows,
    totals,
    /** Conversion = commandes / affichages du formulaire. */
    conversionRate: views ? orders / views : null,
    /** Conversion après ouverture (popup) = commandes / ouvertures. */
    openConversionRate: opens ? orders / opens : null,
    averageOrderValue: orders ? (totals.orders?.amount ?? 0) / orders : null,
  };
}

/**
 * Applique les migrations SQL (dossier migrations/) dans l'ordre, une seule fois chacune.
 * Usage : DATABASE_URL=postgres://... npm run migrate
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

export async function migrate(url: string, log = console.log): Promise<string[]> {
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => undefined });
  try {
    await sql`CREATE SCHEMA IF NOT EXISTS kbcod`;
    await sql`CREATE TABLE IF NOT EXISTS kbcod.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const done = new Set((await sql<{ name: string }[]>`SELECT name FROM kbcod.schema_migrations`).map((r) => r.name));
    const dir = join(import.meta.dirname ?? __dirname, "../migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const applied: string[] = [];
    for (const f of files) {
      if (done.has(f)) continue;
      await sql.begin(async (tx) => {
        await tx.unsafe(readFileSync(join(dir, f), "utf8"));
        await tx`INSERT INTO kbcod.schema_migrations (name) VALUES (${f})`;
      });
      applied.push(f);
      log(`Migration appliquée : ${f}`);
    }
    if (!applied.length) log("Base à jour.");
    return applied;
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL manquant");
    process.exit(1);
  }
  migrate(url).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

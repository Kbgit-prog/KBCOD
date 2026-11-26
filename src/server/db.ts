import postgres from "postgres";
import { env } from "./env";

export type Sql = postgres.Sql<Record<string, unknown>>;
let client: Sql | null = null;

export function sql(): Sql {
  if (!client) {
    const url = env().DATABASE_URL;
    client = postgres(url, {
      max: Number(process.env.DB_POOL_MAX ?? 3),
      idle_timeout: 20,
      connect_timeout: 10,
      // Requis avec le pooler Supabase en mode transaction (pas de requêtes préparées nommées).
      prepare: false,
      connection: { search_path: "kbcod" },
      types: { bigint: postgres.BigInt },
      transform: { undefined: null },
    }) as unknown as Sql;
  }
  return client;
}

export async function closeDb(): Promise<void> {
  if (client) await client.end({ timeout: 5 });
  client = null;
}

export function setSqlForTests(s: Sql | null): void {
  client = s;
}

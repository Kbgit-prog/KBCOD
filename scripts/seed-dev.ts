// Développement local uniquement : crée une boutique de démonstration (jeton factice) pour tester l’admin sans Shopify.
import postgres from "postgres";
import { loadEnv, setEnvForTests } from "../src/server/env";
import { encrypt } from "../src/server/lib/crypto";
(async () => {
  setEnvForTests(loadEnv());
  const sql = postgres(process.env.DATABASE_URL!, { connection: { search_path: "kbcod" } });
  await sql`INSERT INTO shops (shop_domain, app_client_id, access_token_enc, name, currency, money_format, app_installation_gid, timezone)
   VALUES (${"demo-kb.myshopify.com"}, ${"client_aaaaaaaaaaaa"}, ${encrypt("shpat_fake")}, ${"Boutique Démo"}, ${"XOF"}, ${"{{amount_no_decimals_with_space_separator}} FCFA"}, ${"gid://shopify/AppInstallation/1"}, ${"Africa/Abidjan"})
   ON CONFLICT DO NOTHING`;
  await sql.end();
  console.log("shop ok");
})();

// Génère les secrets du serveur à copier dans Vercel (Settings > Environment Variables).
// À exécuter sur VOTRE machine : node scripts/generate-secrets.mjs — ne commitez jamais le résultat.
import { randomBytes } from "node:crypto";
const r = (n) => randomBytes(n).toString("base64url");
console.log(`ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`);
console.log(`HASH_SALT=${r(24)}`);
console.log(`CRON_SECRET=${r(32)}`);
console.log(`DB_PASSWORD=${r(24)}   # mot de passe du rôle kbcod_app (voir docs/GUIDE_INSTALLATION.md)`);

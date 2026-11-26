// Construit le script de vitrine dans l'extension de thème (IIFE minifiée, sans dépendance externe).
import { build } from "esbuild";

await build({
  entryPoints: ["src/storefront/main.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2019", "safari14.1"],
  outfile: "extensions/kbcod-theme/assets/kbcod.js",
  legalComments: "none",
  charset: "ascii",
  // zod n'est pas nécessaire côté vitrine : seuls les types sont importés.
  external: [],
  logLevel: "info",
});

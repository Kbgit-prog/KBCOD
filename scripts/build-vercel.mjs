// Construit la sortie Vercel (Build Output API v3) : admin statique + une seule fonction Node.js.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";

const out = ".vercel/output";
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/static`, { recursive: true });
cpSync("dist/admin", `${out}/static`, { recursive: true });

const fn = `${out}/functions/api.func`;
mkdirSync(fn, { recursive: true });
await build({
  entryPoints: ["src/server/vercel-entry.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: `${fn}/index.mjs`,
  // css-tree charge des JSON via require() : on utilise sa version pré-assemblée.
  alias: { "css-tree": "css-tree/dist/csstree.esm" },
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  logLevel: "info",
});
writeFileSync(`${fn}/package.json`, JSON.stringify({ type: "module" }));
writeFileSync(
  `${fn}/.vc-config.json`,
  JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: false, maxDuration: 60, regions: ["dub1"] }, null, 2),
);
writeFileSync(
  `${out}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: "^/(health|webhooks|cron/jobs|google/callback)$", dest: "/api" },
        { src: "^/(api/admin|sf)/.*$", dest: "/api" },
        { handle: "filesystem" },
        { src: "^/app(/.*)?$", dest: "/index.html", headers: { "Cache-Control": "no-store" } },
        { src: "^/$", status: 302, headers: { Location: "https://admin.shopify.com" } },
      ],
    },
    null,
    2,
  ),
);
console.log("Sortie Vercel prête :", out);

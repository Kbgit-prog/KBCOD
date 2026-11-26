import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFileSync } from "node:fs";
import { createApp } from "./app";

const app = createApp();
app.use("/assets/*", serveStatic({ root: "./dist/admin" }));
app.get("/app/*", (c) => c.html(readFileSync("./dist/admin/index.html", "utf8")));
const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port });
console.log(`KB COD Manager : http://localhost:${port}`);

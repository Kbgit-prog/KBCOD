import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import handler from "../src/server/vercel-entry";

// Le lanceur Vercel « Nodejs » appelle handler(req, res) : le gestionnaire doit répondre sur `res`.
describe("Point d'entrée Vercel", () => {
  it("répond comme un gestionnaire Node (req, res)", async () => {
    const server = createServer(handler as any);
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(5000) });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, service: "kb-cod-manager" });
    } finally {
      server.close();
    }
  });
});

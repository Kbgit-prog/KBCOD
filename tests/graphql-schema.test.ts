import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildClientSchema, parse, validate } from "graphql";
import { describe, expect, it } from "vitest";

const SCHEMA = join(__dirname, "../.cache/admin_2026-10.json");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith(".ts") ? [p] : [];
  });
}

const documents = sources(join(__dirname, "../src/server")).flatMap((file) => {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/`#graphql([\s\S]*?)`/g)].map((m) => ({ file, doc: m[1]! }));
});

describe.skipIf(!existsSync(SCHEMA))("Requêtes Admin GraphQL (schéma 2026-10)", () => {
  const json = JSON.parse(readFileSync(SCHEMA, "utf8"));
  const schema = buildClientSchema(json.data ?? json);

  it("trouve des documents GraphQL", () => {
    expect(documents.length).toBeGreaterThan(8);
  });

  for (const { file, doc } of documents) {
    const name = /(query|mutation)\s+(\w+)/.exec(doc)?.[2] ?? "anonyme";
    it(`${name} est valide (${file.split("/src/")[1]})`, () => {
      const errors = validate(schema, parse(doc));
      expect(errors.map((e) => e.message)).toEqual([]);
    });
  }
});

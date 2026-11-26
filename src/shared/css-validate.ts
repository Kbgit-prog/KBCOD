import * as csstree from "css-tree";

export interface CssValidation {
  ok: boolean;
  errors: { line: number; column: number; message: string }[];
}

const FORBIDDEN = [
  { re: /@import/i, msg: "@import est interdit" },
  { re: /expression\s*\(/i, msg: "expression() est interdit" },
  { re: /javascript\s*:/i, msg: "Les URL javascript: sont interdites" },
  { re: /behavior\s*:/i, msg: "La propriété behavior est interdite" },
  { re: /-moz-binding/i, msg: "-moz-binding est interdit" },
  { re: /<\/?\s*(style|script)/i, msg: "Les balises HTML sont interdites" },
];

/** Valide la syntaxe et refuse les constructions dangereuses. Aucun JavaScript n'est exécuté. */
export function validateCustomCss(css: string): CssValidation {
  const errors: CssValidation["errors"] = [];
  for (const f of FORBIDDEN) {
    const m = f.re.exec(css);
    if (m) {
      const before = css.slice(0, m.index);
      const line = before.split("\n").length;
      errors.push({ line, column: m.index - before.lastIndexOf("\n"), message: f.msg });
    }
  }
  csstree.parse(css, {
    positions: true,
    onParseError(err: { line?: number; column?: number; message: string; rawMessage?: string }) {
      errors.push({ line: err.line ?? 0, column: err.column ?? 0, message: err.rawMessage ?? err.message });
    },
  });
  return { ok: errors.length === 0, errors };
}

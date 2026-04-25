import { CompletionItem, CompletionItemKind, InsertTextFormat, Position } from "vscode-languageserver";
import type { CompilerIndex } from "../server/types";
import { KEYWORD_COMPLETIONS } from "./keywords";
import { enclosingObject } from "./symbolLookup";

// ---------------------------------------------------------------------------
// Top-level detection
// ---------------------------------------------------------------------------

/**
 * True when the cursor line is outside all routine and object bodies in the
 * index, i.e. at the top level where directives and pseudo-directives appear.
 */
export function isAtTopLevel(
  index: CompilerIndex,
  filePath: string,
  line: number, // 1-based
): boolean {
  if (index.routines.some((r) => r.file === filePath && r.start_line <= line && line <= r.end_line))
    return false;
  if (index.objects.some((o) => o.file === filePath && o.start_line <= line && line <= o.end_line))
    return false;
  return true;
}

/** Snippet templates offered at the top level. */
const TOPLEVEL_SNIPPETS: CompletionItem[] = [
  {
    label: "[ (routine)",
    kind: CompletionItemKind.Snippet,
    insertText: "[ ${1:Name};\n\t$0\n];\n",
    insertTextFormat: InsertTextFormat.Snippet,
    detail: "routine definition",
  },
  {
    label: "Object (with body)",
    kind: CompletionItemKind.Snippet,
    insertText: "Object ${1:Name} \"${2:short name}\"\n  with\n    description \"${3:Description.}\",\n  has ${4:light}\n;\n",
    insertTextFormat: InsertTextFormat.Snippet,
    detail: "object definition",
  },
  {
    label: "Class (with body)",
    kind: CompletionItemKind.Snippet,
    insertText: "Class ${1:Name}\n  with\n    ${2}\n;\n",
    insertTextFormat: InsertTextFormat.Snippet,
    detail: "class definition",
  },
];

// ---------------------------------------------------------------------------
// provides-expression detection
// ---------------------------------------------------------------------------

/**
 * Shared helper: strip the partial word being typed, trim trailing whitespace,
 * then strip any trailing `identifier or` chains so that
 * `obj provides p1 or p2 or ^` reduces to `obj provides`.
 */
function stripOrChain(lineText: string, col: number): string {
  let s = lineText.slice(0, col).replace(/\w*$/, "").trimEnd();
  // Remove zero or more trailing " word or" groups (right to left).
  while (true) {
    const m = s.match(/^(.*\S)\s+\w+\s+or$/s);
    if (!m) break;
    s = m[1];
  }
  return s;
}

/**
 * True when the cursor is in a `provides` expression (including `or` chains).
 * Single-line check only — `provides` is always an inline expression.
 */
export function isAfterProvides(lineText: string, col: number): boolean {
  return /\bprovides$/.test(stripOrChain(lineText, col));
}

/**
 * True when the cursor is in an `ofclass` expression (including `or` chains).
 */
export function isAfterOfclass(lineText: string, col: number): boolean {
  return /\bofclass$/.test(stripOrChain(lineText, col));
}

/**
 * True when the cursor immediately follows `##` (Inform 6 action reference).
 */
export function isAfterHashHash(lineText: string, col: number): boolean {
  return lineText.slice(0, col).replace(/\w*$/, "").endsWith("##");
}

// ---------------------------------------------------------------------------
// has-clause detection
// ---------------------------------------------------------------------------

const SCAN_LIMIT = 15;

function lastWordIndex(text: string, word: string): number {
  const re = new RegExp(`\\b${word}\\b`, "gi");
  let last = -1, m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) last = m.index;
  return last;
}

/**
 * True when the cursor appears to be inside an Inform 6 `has` attribute
 * clause.  Scans backwards up to SCAN_LIMIT lines, stripping comments and
 * string literals, then checks whether `has`/`hasnt` appears more recently
 * than any clause terminator (`;`, `with`, `private`, `class`).
 */
export function isInHasClause(
  lines: string[],
  cursorLine: number,
  cursorCol: number,
): boolean {
  const startLine = Math.max(0, cursorLine - SCAN_LIMIT);
  const chunks: string[] = [];
  for (let i = startLine; i <= cursorLine; i++) {
    let line = lines[i] ?? "";
    if (i === cursorLine) line = line.slice(0, cursorCol);
    const ci = line.indexOf("!");
    if (ci !== -1) line = line.slice(0, ci);
    line = line.replace(/"[^"]*"/g, "");
    chunks.push(line);
  }
  const text = chunks.join("\n");
  const hasIdx  = Math.max(lastWordIndex(text, "has"), lastWordIndex(text, "hasnt"));
  const termIdx = Math.max(
    lastWordIndex(text, "with"),
    lastWordIndex(text, "private"),
    lastWordIndex(text, "class"),
    text.lastIndexOf(";"),
  );
  return hasIdx !== -1 && hasIdx > termIdx;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Return completion items for the cursor position.
 *
 * Modes (in priority order):
 *
 * 1. **Dot completion** (`ObjName.` / `self.`): properties and attributes.
 * 2. **`##`**: action names.
 * 3. **`provides` / `provides … or`**: property names.
 * 4. **`ofclass` / `ofclass … or`**: class names.
 * 5. **`has`/`hasnt` clause**: attribute names.
 * 6. **Top-top** (first token at col 0, outside all bodies): directives,
 *    class names, snippet templates.
 * 7. **General**: in-scope locals, then all user symbols and keywords.
 */
export function getCompletions(
  index: CompilerIndex,
  filePath: string,
  position: Position,
  lineText: string,
  lines: string[],
): CompletionItem[] {
  const col = position.character;

  // ── Dot completion ──────────────────────────────────────────────────────
  if (col > 0 && lineText[col - 1] === ".") {
    const end = col - 1;
    let start = end;
    while (start > 0 && isIdChar(lineText[start - 1])) start--;
    const rawName = lineText.slice(start, end).toLowerCase();
    const objName = rawName === "self"
      ? (enclosingObject(index, filePath, position.line + 1)?.name.toLowerCase() ?? rawName)
      : rawName;

    const obj = index.objects.find((o) => o.name.toLowerCase() === objName);
    if (!obj) return [];

    const items: CompletionItem[] = [];
    for (const p of obj.properties) items.push({ label: p.name, kind: CompletionItemKind.Field });
    for (const p of obj.private_properties) items.push({ label: p.name, kind: CompletionItemKind.Field });
    for (const a of obj.attributes) items.push({ label: a.name, kind: CompletionItemKind.EnumMember });
    return items;
  }

  // ── ## action reference ──────────────────────────────────────────────────
  if (isAfterHashHash(lineText, col)) {
    const seen = new Set<string>();
    const items: CompletionItem[] = [];
    for (const s of index.symbols) {
      if (s.type !== "fake_action") continue;
      const name = s.name.toLowerCase().endsWith("__a") ? s.name.slice(0, -3) : s.name;
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      items.push({ label: name, kind: CompletionItemKind.EnumMember });
    }
    return items;
  }

  // ── Provides expression: properties only (supports `or` chains) ─────────
  if (isAfterProvides(lineText, col)) {
    const seen = new Set<string>();
    const items: CompletionItem[] = [];
    for (const s of index.symbols) {
      if (s.type !== "property" && s.type !== "individual_property") continue;
      const key = s.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ label: s.name, kind: CompletionItemKind.Field });
    }
    return items;
  }

  // ── Ofclass expression: class names only (supports `or` chains) ─────────
  if (isAfterOfclass(lineText, col)) {
    const seen = new Set<string>();
    const items: CompletionItem[] = [];
    for (const s of index.symbols) {
      if (s.type !== "class") continue;
      const key = s.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ label: s.name, kind: CompletionItemKind.Class });
    }
    return items;
  }

  // ── Has clause: attributes only ─────────────────────────────────────────
  if (isInHasClause(lines, position.line, col)) {
    const seen = new Set<string>();
    const items: CompletionItem[] = [];
    for (const s of index.symbols) {
      if (s.type !== "attribute") continue;
      const key = s.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ label: s.name, kind: CompletionItemKind.EnumMember });
    }
    return items;
  }

  // ── Top level: directives, pseudo-directive class names, snippets ────────
  // Only when typing the first token on the line (nothing before the cursor
  // except the partial word being typed) — mid-directive positions need the
  // full symbol list.
  // Only trigger when the directive starts at column 0 (no leading whitespace).
  const lineBeforeCursor = lineText.slice(0, col).replace(/\w*$/, "");
  if (lineBeforeCursor === "" && isAtTopLevel(index, filePath, position.line + 1)) {
    const items: CompletionItem[] = [...TOPLEVEL_SNIPPETS];
    const seen = new Set<string>(TOPLEVEL_SNIPPETS.map((s) => s.label.toLowerCase()));

    for (const kw of KEYWORD_COMPLETIONS) {
      if (kw.kind !== "directive") continue;
      const key = kw.label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ label: kw.label, kind: CompletionItemKind.Struct });
    }

    for (const o of index.objects) {
      if (!o.is_class) continue;
      const key = o.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ label: o.name, kind: CompletionItemKind.Class });
    }

    return items;
  }

  // ── General completion ──────────────────────────────────────────────────
  const items: CompletionItem[] = [];
  const seen = new Set<string>();

  const add = (label: string, kind: CompletionItemKind, detail?: string) => {
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    items.push(detail ? { label, kind, detail } : { label, kind });
  };

  // Locals of the enclosing routine (1-based line numbers in the index).
  const curLine = position.line + 1;
  for (const r of index.routines) {
    if (r.file !== filePath) continue;
    if (curLine < r.start_line || curLine > r.end_line) continue;
    for (const local of r.locals) add(local, CompletionItemKind.Variable);
    break; // only one routine can enclose the cursor
  }

  // Routines (non-embedded only — embedded are not callable by bare name).
  for (const r of index.routines) {
    if (r.embedded) continue;
    const detail = r.locals.length ? `(${r.locals.join(", ")})` : undefined;
    add(r.name, CompletionItemKind.Function, detail);
  }

  // Objects and classes.
  for (const o of index.objects) add(o.name, o.is_class ? CompletionItemKind.Class : CompletionItemKind.Module);

  // Globals.
  for (const g of index.globals) add(g.name, CompletionItemKind.Variable);

  // Constants.
  for (const c of index.constants) add(c.name, CompletionItemKind.Constant);

  // Arrays.
  for (const a of index.arrays) add(a.name, CompletionItemKind.Variable);

  // Language keywords and directives.
  for (const kw of KEYWORD_COMPLETIONS)
    add(kw.label, kw.kind === "keyword" ? CompletionItemKind.Keyword : CompletionItemKind.Struct);

  return items;
}

const isIdChar = (c: string) => /\w/.test(c);

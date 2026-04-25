import { CompletionItem, CompletionItemKind, Position } from "vscode-languageserver";
import type { CompilerIndex } from "../server/types";
import { KEYWORD_COMPLETIONS } from "./keywords";

const isIdChar = (c: string) => /\w/.test(c);

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
 * string literals, then checks whether `has` appears more recently than any
 * clause terminator (`;`, `with`, `private`, `class`).
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
 * Three modes:
 *
 * 1. **Dot completion** (`ObjName.`): the character immediately before the
 *    cursor is `.`.  Look up the object and return its properties, private
 *    properties, and attributes.
 *
 * 2. **Has clause**: cursor is inside a `has` attribute block.  Return only
 *    attribute names (all objects' attributes + attribute symbols).
 *
 * 3. **General completion**: return all in-scope locals (from the enclosing
 *    routine) followed by every user-defined routine, object, global,
 *    constant, and array in the index.
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
    const objName = lineText.slice(start, end).toLowerCase();

    const obj = index.objects.find((o) => o.name.toLowerCase() === objName);
    if (!obj) return [];

    const items: CompletionItem[] = [];
    for (const p of obj.properties) items.push({ label: p.name, kind: CompletionItemKind.Field });
    for (const p of obj.private_properties) items.push({ label: p.name, kind: CompletionItemKind.Field });
    for (const a of obj.attributes) items.push({ label: a.name, kind: CompletionItemKind.EnumMember });
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

import { CompletionItem, CompletionItemKind, Position } from "vscode-languageserver";
import type { CompilerIndex } from "../server/types";
import { KEYWORD_COMPLETIONS } from "./keywords";

const isIdChar = (c: string) => /\w/.test(c);

/**
 * Return completion items for the cursor position.
 *
 * Two modes:
 *
 * 1. **Dot completion** (`ObjName.`): the character immediately before the
 *    cursor is `.`.  Look up the object and return its properties, private
 *    properties, and attributes.
 *
 * 2. **General completion**: return all in-scope locals (from the enclosing
 *    routine) followed by every user-defined routine, object, global,
 *    constant, and array in the index.
 */
export function getCompletions(
  index: CompilerIndex,
  filePath: string,
  position: Position,
  lineText: string,
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

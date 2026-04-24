import { SymbolInformation, SymbolKind, Location, Range } from "vscode-languageserver";
import { URI } from "vscode-uri";
import type { CompilerIndex } from "../server/types";

function loc(file: string, line: number): Location {
  const uri = URI.file(file).toString();
  const pos = { line: Math.max(0, line - 1), character: 0 };
  return Location.create(uri, Range.create(pos, pos));
}

/**
 * Return workspace symbols matching `query` (case-insensitive substring).
 * Empty query returns all symbols (VS Code uses this to populate the picker
 * before the user starts typing).
 *
 * Covers routines, objects/classes, globals, constants, and arrays.
 * Embedded routines (ObjName.prop) are skipped — they appear under their
 * parent in the document outline instead.
 */
export function getWorkspaceSymbols(
  index: CompilerIndex,
  query: string,
): SymbolInformation[] {
  const q = query.toLowerCase();
  const matches = (name: string) => !q || name.toLowerCase().includes(q);
  const results: SymbolInformation[] = [];

  for (const r of index.routines) {
    if (r.embedded) continue;
    if (!matches(r.name)) continue;
    results.push({ name: r.name, kind: SymbolKind.Function, location: loc(r.file, r.start_line) });
  }

  for (const o of index.objects) {
    if (!matches(o.name)) continue;
    results.push({
      name: o.name,
      kind: o.is_class ? SymbolKind.Class : SymbolKind.Object,
      location: loc(o.file, o.start_line),
    });
  }

  for (const g of index.globals) {
    if (!matches(g.name)) continue;
    results.push({ name: g.name, kind: SymbolKind.Variable, location: loc(g.file, g.line) });
  }

  for (const c of index.constants) {
    if (!matches(c.name)) continue;
    results.push({ name: c.name, kind: SymbolKind.Constant, location: loc(c.file, c.line) });
  }

  for (const a of index.arrays) {
    if (!matches(a.name)) continue;
    results.push({ name: a.name, kind: SymbolKind.Array, location: loc(a.file, a.line) });
  }

  return results;
}

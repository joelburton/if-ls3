import { SymbolInformation, SymbolKind } from "vscode-languageserver";
import type { CompilerIndex } from "../server/types";
import { loc } from "./symbolLookup";

/**
 * Return workspace symbols matching `query` (case-insensitive substring)
 * across all compilations.  Symbols that appear in multiple compilations
 * (e.g. from a shared include file) are deduplicated by name.
 *
 * Covers routines, objects/classes, globals, constants, and arrays.
 * Embedded routines (ObjName.prop) are skipped — they appear under their
 * parent in the document outline instead.
 */
export function getWorkspaceSymbols(indices: CompilerIndex[], query: string): SymbolInformation[] {
  const q = query.toLowerCase();
  const matches = (name: string) => !q || name.toLowerCase().includes(q);
  const results: SymbolInformation[] = [];
  const seen = new Set<string>(); // deduplicate by lowercase name

  const add = (item: SymbolInformation) => {
    const key = item.name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    results.push(item);
  };

  for (const index of indices) {
    for (const r of index.routines) {
      if (r.embedded) continue;
      if (!matches(r.name)) continue;
      add({ name: r.name, kind: SymbolKind.Function, location: loc(r.file, r.start_line) });
    }

    for (const o of index.objects) {
      if (!matches(o.name)) continue;
      add({
        name: o.name,
        kind: o.is_class ? SymbolKind.Class : SymbolKind.Object,
        location: loc(o.file, o.start_line),
      });
    }

    for (const g of index.globals) {
      if (!matches(g.name)) continue;
      add({ name: g.name, kind: SymbolKind.Variable, location: loc(g.file, g.line) });
    }

    for (const c of index.constants) {
      if (!matches(c.name)) continue;
      add({ name: c.name, kind: SymbolKind.Constant, location: loc(c.file, c.line) });
    }

    for (const a of index.arrays) {
      if (!matches(a.name)) continue;
      add({ name: a.name, kind: SymbolKind.Array, location: loc(a.file, a.line) });
    }
  }

  return results;
}

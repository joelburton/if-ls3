import { DocumentSymbol, SymbolKind, Range } from "vscode-languageserver";
import { URI } from "vscode-uri";
import type { CompilerIndex } from "../server/types";

function makeRange(startLine: number, endLine: number): Range {
  return Range.create(
    Math.max(0, startLine - 1),
    0,
    Math.max(0, endLine - 1),
    0,
  );
}

/**
 * Build the document outline for `documentUri`.
 *
 * - Objects/classes → top-level SymbolKind.Object / SymbolKind.Class
 * - Embedded routines (name contains `::` or `.`) → nested under their parent object
 * - Standalone routines → top-level SymbolKind.Function
 * - Globals → SymbolKind.Variable
 * - Constants → SymbolKind.Constant
 */
export function getDocumentSymbols(
  index: CompilerIndex,
  documentUri: string,
): DocumentSymbol[] {
  const filePath = URI.parse(documentUri).fsPath;
  const result: DocumentSymbol[] = [];

  // --- Objects and classes ---
  const objectSymbols = new Map<string, DocumentSymbol>();
  for (const obj of index.objects) {
    if (obj.file !== filePath) continue;
    const range = makeRange(obj.start_line, obj.end_line);
    const sym: DocumentSymbol = {
      name: obj.name,
      detail: obj.shortname,
      kind: obj.is_class ? SymbolKind.Class : SymbolKind.Object,
      range,
      selectionRange: range,
      children: [],
    };
    result.push(sym);
    objectSymbols.set(obj.name, sym);
  }

  // --- Routines ---
  for (const routine of index.routines) {
    if (routine.file !== filePath) continue;
    const range = makeRange(routine.start_line, routine.end_line);
    const sym: DocumentSymbol = {
      name: routine.name,
      kind: SymbolKind.Function,
      range,
      selectionRange: range,
      children: [],
    };

    if (routine.embedded) {
      // Name is "ObjName::prop" (class-defined) or "ObjName.prop" (object)
      const sep = routine.name.includes("::")
        ? routine.name.indexOf("::")
        : routine.name.indexOf(".");
      if (sep >= 0) {
        const parentName = routine.name.slice(0, sep);
        const parent = objectSymbols.get(parentName);
        if (parent) {
          (parent.children ??= []).push(sym);
          continue;
        }
      }
    }

    result.push(sym);
  }

  // --- Globals ---
  for (const g of index.globals) {
    if (g.file !== filePath) continue;
    const range = makeRange(g.line, g.line);
    result.push({
      name: g.name,
      kind: SymbolKind.Variable,
      range,
      selectionRange: range,
    });
  }

  // --- Constants ---
  for (const c of index.constants) {
    if (c.file !== filePath) continue;
    const range = makeRange(c.line, c.line);
    result.push({
      name: c.name,
      kind: SymbolKind.Constant,
      range,
      selectionRange: range,
    });
  }

  return result;
}

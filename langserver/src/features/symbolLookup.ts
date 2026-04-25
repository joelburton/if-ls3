import { Location, Range } from "vscode-languageserver";
import { URI } from "vscode-uri";
import type {
  CompilerIndex,
  RoutineInfo,
  ObjectInfo,
  GlobalInfo,
  ConstantInfo,
  ArrayInfo,
  SymbolInfo,
} from "../server/types";

/**
 * Return the object/class whose source body contains the given position.
 * Used to resolve `self` inside embedded routines — `self` refers to the
 * object that owns the routine.
 */
export function enclosingObject(
  index: CompilerIndex,
  filePath: string,
  line: number, // 1-based
): ObjectInfo | undefined {
  return index.objects.find(
    (o) => o.file === filePath && o.start_line <= line && line <= o.end_line,
  );
}

/** Build an LSP Location from an absolute file path and a 1-based line number. */
export function loc(file: string, line: number): Location {
  const uri = URI.file(file).toString();
  const pos = { line: Math.max(0, line - 1), character: 0 };
  return Location.create(uri, Range.create(pos, pos));
}

export type ResolvedSymbol =
  | { kind: "routine"; item: RoutineInfo }
  | { kind: "object"; item: ObjectInfo }
  | { kind: "global"; item: GlobalInfo }
  | { kind: "constant"; item: ConstantInfo }
  | { kind: "array"; item: ArrayInfo }
  | { kind: "symbol"; item: SymbolInfo };

/**
 * Find the first user-visible symbol whose name matches `word`
 * (case-insensitive).
 *
 * Lookup order: routines → objects → globals → constants → arrays →
 * symbols[] fallback (covers library properties, attributes, etc.).
 * System-only symbols (is_system=true, no file) are excluded from the
 * fallback; hover.ts intentionally includes them and so keeps its own lookup.
 *
 * **Adding a new symbol category**: add a new variant to ResolvedSymbol, add
 * one find() here, then handle the new `kind` in each consumer (definition.ts,
 * workspaceSymbols.ts) rather than updating each file independently.
 */
export function resolveSymbol(index: CompilerIndex, word: string): ResolvedSymbol | null {
  const lower = word.toLowerCase();

  const routine = index.routines.find((r) => r.name.toLowerCase() === lower);
  if (routine) return { kind: "routine", item: routine };

  const obj = index.objects.find((o) => o.name.toLowerCase() === lower);
  if (obj) return { kind: "object", item: obj };

  const global_ = index.globals.find((g) => g.name.toLowerCase() === lower);
  if (global_) return { kind: "global", item: global_ };

  const constant = index.constants.find((c) => c.name.toLowerCase() === lower);
  if (constant) return { kind: "constant", item: constant };

  const array = index.arrays.find((a) => a.name.toLowerCase() === lower);
  if (array) return { kind: "array", item: array };

  const sym = index.symbols.find((s) => !s.is_system && s.name.toLowerCase() === lower && s.file);
  if (sym) return { kind: "symbol", item: sym };

  return null;
}

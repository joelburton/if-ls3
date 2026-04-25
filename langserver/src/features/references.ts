import { Location, Range } from "vscode-languageserver";
import { URI } from "vscode-uri";
import type { CompilerIndex, SymbolReference } from "../server/types";

/**
 * Parse a loc string `"fileIndex:line:col"` into an LSP Location.
 * fileIndex is 0-based into files[], line is 1-based, col is 0-based.
 * Returns null if the string is malformed or the file index is out of range.
 */
function locFromRef(files: string[], locStr: string): Location | null {
  const parts = locStr.split(":");
  if (parts.length !== 3) return null;
  const fileIndex = parseInt(parts[0], 10);
  const line = parseInt(parts[1], 10);
  const col = parseInt(parts[2], 10);
  if (isNaN(fileIndex) || isNaN(line) || isNaN(col)) return null;
  const file = files[fileIndex];
  if (!file) return null;
  const uri = URI.file(file).toString();
  const pos = { line: line - 1, character: col };
  return Location.create(uri, Range.create(pos, pos));
}

/**
 * Find the reference entry whose token span covers the cursor position.
 *
 * fileIndex is 0-based (matching files[]), line is 1-based, col is 0-based.
 * A reference at column C spans [C, C + sym.length), so any cursor column
 * within that range is a hit.
 *
 * Returns undefined when references[] is absent (older binary) or no token
 * covers the position.
 */
export function refAtPosition(
  index: CompilerIndex,
  fileIndex: number,
  line: number,
  col: number,
): SymbolReference | undefined {
  if (!index.references) return undefined;
  const locPrefix = `${fileIndex}:${line}:`;
  for (const ref of index.references) {
    for (const locStr of ref.locs) {
      if (!locStr.startsWith(locPrefix)) continue;
      const refCol = parseInt(locStr.slice(locPrefix.length), 10);
      if (col >= refCol && col < refCol + ref.sym.length) return ref;
    }
  }
  return undefined;
}

/**
 * Find all source locations where `word` is referenced, according to the
 * compiler's reference index.
 *
 * Matching is case-insensitive on `sym`.  Returns an empty array if the index
 * has no `references` field (older compiler binary) or if no entry matches.
 */
export function findReferences(index: CompilerIndex, word: string): Location[] {
  if (!index.references) return [];
  const lower = word.toLowerCase();
  const locations: Location[] = [];

  for (const ref of index.references) {
    if (ref.sym.toLowerCase() !== lower) continue;
    for (const locStr of ref.locs) {
      const location = locFromRef(index.files, locStr);
      if (location) locations.push(location);
    }
  }

  return locations;
}

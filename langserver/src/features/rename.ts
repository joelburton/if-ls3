import { Range, TextEdit, WorkspaceEdit, Position } from "vscode-languageserver";
import { URI } from "vscode-uri";
import type { CompilerIndex } from "../server/types";
import { wordAtPosition, isInComment } from "./wordAtPosition";
import { refAtPosition } from "./references";
import { resolveSymbol } from "./symbolLookup";
import { inactiveLineRange } from "./conditionals";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Return all source ranges where `sym` is referenced, with proper width
 * [col, col + sym.length).  Uses references[] for exact compiler positions.
 */
function useRangesForSym(
  index: CompilerIndex,
  sym: string,
): Array<{ uri: string; range: Range }> {
  const lower = sym.toLowerCase();
  const results: Array<{ uri: string; range: Range }> = [];

  for (const ref of index.references ?? []) {
    if (ref.sym.toLowerCase() !== lower) continue;
    for (const locStr of ref.locs) {
      const parts = locStr.split(":");
      if (parts.length !== 3) continue;
      const fileIndex = parseInt(parts[0], 10);
      const line      = parseInt(parts[1], 10); // 1-based
      const col       = parseInt(parts[2], 10); // 0-based
      const file = index.files[fileIndex];
      if (!file) continue;
      results.push({
        uri: URI.file(file).toString(),
        range: Range.create(
          { line: line - 1, character: col },
          { line: line - 1, character: col + sym.length },
        ),
      });
    }
  }

  return results;
}

/**
 * Find the precise range of `name` on the given 1-based source line.
 * Returns null when the file can't be read or the name isn't on that line.
 */
function definitionRange(
  name: string,
  file: string,
  line: number, // 1-based
  getFileText: (path: string) => string | null,
): Range | null {
  const text = getFileText(file);
  if (!text) return null;
  const lineText = text.split("\n")[line - 1] ?? "";
  const col = lineText.toLowerCase().indexOf(name.toLowerCase());
  if (col === -1) return null;
  return Range.create(
    { line: line - 1, character: col },
    { line: line - 1, character: col + name.length },
  );
}

interface Companion {
  sym: string;
  /** Derive the companion's new name from the primary's new name, or null to skip. */
  newName: (base: string) => string | null;
}

/**
 * Return the action/Sub companion for a symbol, or null if none.
 *
 * - action `Foozle`   → companion routine `FoozleSub`
 * - routine `FoozleSub` → companion action `Foozle` (only if references[]
 *   contains an action entry for the base name)
 */
function companion(index: CompilerIndex, sym: string, type: string): Companion | null {
  if (type === "action") {
    const companionName = sym + "Sub";
    if (!index.routines.some((r) => r.name.toLowerCase() === companionName.toLowerCase()))
      return null;
    return { sym: companionName, newName: (base) => base + "Sub" };
  }

  if (type === "routine" && sym.toLowerCase().endsWith("sub")) {
    const actionName = sym.slice(0, -3);
    const hasAction = (index.references ?? []).some(
      (r) => r.sym.toLowerCase() === actionName.toLowerCase() && r.type === "action",
    );
    if (!hasAction) return null;
    return {
      sym: actionName,
      newName: (base) => (base.toLowerCase().endsWith("sub") ? base.slice(0, -3) : null),
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Exported: affectedFiles + hasInactiveBranches (used by server.ts)
// ---------------------------------------------------------------------------

export function affectedFiles(edit: WorkspaceEdit): Set<string> {
  const files = new Set<string>();
  for (const uri of Object.keys(edit.changes ?? {}))
    files.add(URI.parse(uri).fsPath);
  return files;
}

export function hasInactiveBranches(index: CompilerIndex, files: Set<string>): boolean {
  return (index.conditionals ?? []).some(
    (c) => files.has(c.file) && inactiveLineRange(c) !== null,
  );
}

// ---------------------------------------------------------------------------
// Exported: prepareRename
// ---------------------------------------------------------------------------

/**
 * Validate that the cursor is on a renameable symbol and return the current
 * name's range + placeholder for VS Code to pre-select.
 *
 * Returns null when:
 * - cursor is not on an identifier
 * - cursor is inside a comment
 * - symbol is a system/built-in symbol
 * - word is not a known symbol at all
 */
export function prepareRename(
  index: CompilerIndex,
  filePath: string,
  position: Position,
  sourceText: string,
): { range: Range; placeholder: string } | null {
  const hit = wordAtPosition(sourceText, position);
  if (!hit) return null;
  if (isInComment(hit.lineText, position.character)) return null;

  const fileIndex = index.files.indexOf(filePath);
  const line1 = position.line + 1;
  const ref =
    fileIndex >= 0
      ? refAtPosition(index, fileIndex, line1, position.character)
      : undefined;

  const symName = ref?.sym ?? hit.word;

  // Reject system symbols.
  const symEntry = index.symbols.find(
    (s) => s.name.toLowerCase() === symName.toLowerCase(),
  );
  if (symEntry?.is_system) return null;

  // Must be a compiler-tracked reference OR a resolvable user symbol.
  if (!ref && !resolveSymbol(index, hit.word)) return null;

  return {
    range: Range.create(
      { line: position.line, character: hit.start },
      { line: position.line, character: hit.end },
    ),
    placeholder: hit.word,
  };
}

// ---------------------------------------------------------------------------
// Exported: computeRename
// ---------------------------------------------------------------------------

/**
 * Compute the WorkspaceEdit for renaming the symbol under the cursor.
 *
 * Collects:
 *   - all use-site ranges from references[] (exact compiler positions)
 *   - the definition-site range (indexOf on the definition line)
 *
 * Action/Sub tandem: renaming action `Foozle` also renames `FoozleSub` to
 * `${newName}Sub`, and vice versa (if the new Sub name ends with "Sub").
 */
export function computeRename(
  index: CompilerIndex,
  filePath: string,
  position: Position,
  newName: string,
  getFileText: (path: string) => string | null,
): WorkspaceEdit | null {
  const sourceText = getFileText(filePath);
  if (!sourceText) return null;

  const hit = wordAtPosition(sourceText, position);
  if (!hit) return null;

  const fileIndex = index.files.indexOf(filePath);
  const line1 = position.line + 1;
  const ref =
    fileIndex >= 0
      ? refAtPosition(index, fileIndex, line1, position.character)
      : undefined;

  const sym  = ref?.sym  ?? hit.word;
  const type = ref?.type ?? "unknown";

  if (!ref && !resolveSymbol(index, sym)) return null;

  // Reject system symbols.
  const symEntry = index.symbols.find((s) => s.name.toLowerCase() === sym.toLowerCase());
  if (symEntry?.is_system) return null;

  const allEdits: Array<{ uri: string; range: Range; newText: string }> = [];

  function addEditsForSymbol(name: string, replaceName: string, isAction: boolean): void {
    // Use-sites.
    for (const { uri, range } of useRangesForSym(index, name))
      allEdits.push({ uri, range, newText: replaceName });

    // Definition site.
    if (isAction) {
      // Action symbols live in symbols[] as "Foozle__A".
      const actionSym = index.symbols.find(
        (s) => s.name.toLowerCase() === (name + "__a"),
      );
      if (actionSym?.file && actionSym.line != null) {
        const range = definitionRange(name, actionSym.file, actionSym.line, getFileText);
        if (range) allEdits.push({ uri: URI.file(actionSym.file).toString(), range, newText: replaceName });
      }
    } else {
      const resolved = resolveSymbol(index, name);
      if (resolved) {
        let file: string | undefined;
        let line: number | undefined;
        switch (resolved.kind) {
          case "routine":  file = resolved.item.file; line = resolved.item.start_line; break;
          case "object":   file = resolved.item.file; line = resolved.item.start_line; break;
          case "global":   file = resolved.item.file; line = resolved.item.line;       break;
          case "constant": file = resolved.item.file; line = resolved.item.line;       break;
          case "array":    file = resolved.item.file; line = resolved.item.line;       break;
          case "symbol":   file = resolved.item.file; line = resolved.item.line;       break;
        }
        if (file && line != null) {
          const range = definitionRange(name, file, line, getFileText);
          if (range) allEdits.push({ uri: URI.file(file).toString(), range, newText: replaceName });
        }
      }
    }
  }

  const isAction = type === "action";
  addEditsForSymbol(sym, newName, isAction);

  // Tandem action/Sub rename.
  const comp = companion(index, sym, type);
  if (comp) {
    const compNewName = comp.newName(newName);
    if (compNewName !== null)
      addEditsForSymbol(comp.sym, compNewName, !isAction && type === "routine");
  }

  if (allEdits.length === 0) return null;

  const changes: Record<string, TextEdit[]> = {};
  for (const e of allEdits) {
    (changes[e.uri] ??= []).push(TextEdit.replace(e.range, e.newText));
  }
  return { changes };
}

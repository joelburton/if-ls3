import { Location } from "vscode-languageserver";
import type { CompilerIndex, IncludeInfo } from "../server/types";
import { loc, resolveSymbol } from "./symbolLookup";

/**
 * Return the includes[] entry whose `from_file` and `from_line` match the
 * cursor position, or undefined if the cursor is not on an Include line.
 */
export function includeAtLine(
  index: CompilerIndex,
  filePath: string,
  line1: number, // 1-based
): IncludeInfo | undefined {
  return index.includes?.find((inc) => inc.from_file === filePath && inc.from_line === line1);
}

/**
 * Find the definition location for `word`.
 *
 * When `objectContext` is non-null (caller detected `ObjName.word`), we first
 * try to resolve the property/attribute line inside that specific object body.
 *
 * When `isActionRef` is true (caller detected `Word:`, `##Word`, `<Word>`, or
 * grammar `-> Word`), we look up `WordSub` — the action routine for action
 * `Word`. When `isExplicitAction` is also true (`##`, `<>`, or `-> `), a miss
 * returns null. When only the colon triggered the flag (`Word:` in a switch),
 * a miss falls through to normal lookup so that value labels like object names
 * still resolve.
 *
 * General lookup order: routines → objects → globals → constants → arrays →
 * symbols[] fallback (covers library properties/attributes).
 */
export function findDefinition(
  index: CompilerIndex,
  word: string,
  objectContext: string | null,
  isActionRef = false,
  isExplicitAction = false,
): Location | null {
  const lower = word.toLowerCase();

  if (isActionRef) {
    const subLower = lower + "sub";
    const sub =
      index.routines.find((r) => r.name.toLowerCase() === subLower) ??
      index.symbols.find((s) => s.name.toLowerCase() === subLower && s.file);
    if (sub && "start_line" in sub) return loc(sub.file, sub.start_line);
    if (sub && "line" in sub && sub.file) return loc(sub.file, sub.line ?? 1);
    // Fall through: `Word:` in a switch may be a value label (e.g. an object),
    // not an action reference.  `##Word` is unambiguously an action, so stop.
    if (isExplicitAction) return null;
  }

  if (objectContext) {
    const objLower = objectContext.toLowerCase();
    const obj = index.objects.find((o) => o.name.toLowerCase() === objLower);
    if (obj) {
      const all = [...obj.properties, ...obj.private_properties, ...obj.attributes];
      const prop = all.find((p) => p.name.toLowerCase() === lower);
      if (prop) return loc(obj.file, prop.line);
    }
  }

  const resolved = resolveSymbol(index, lower);
  if (!resolved) return null;

  switch (resolved.kind) {
    case "routine":
      return loc(resolved.item.file, resolved.item.start_line);
    case "object":
      return loc(resolved.item.file, resolved.item.start_line);
    case "global":
      return loc(resolved.item.file, resolved.item.line);
    case "constant":
      return loc(resolved.item.file, resolved.item.line);
    case "array":
      return loc(resolved.item.file, resolved.item.line);
    case "symbol":
      return resolved.item.file ? loc(resolved.item.file, resolved.item.line ?? 1) : null;
  }
}

import { Location, Range } from "vscode-languageserver";
import { URI } from "vscode-uri";
import type { CompilerIndex } from "../server/types";

function loc(file: string, line: number): Location {
  const uri = URI.file(file).toString();
  const pos = { line: Math.max(0, line - 1), character: 0 };
  return Location.create(uri, Range.create(pos, pos));
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
    const sub = index.routines.find((r) => r.name.toLowerCase() === subLower)
      ?? index.symbols.find((s) => s.name.toLowerCase() === subLower && s.file);
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

  const routine = index.routines.find((r) => r.name.toLowerCase() === lower);
  if (routine) return loc(routine.file, routine.start_line);

  const obj = index.objects.find((o) => o.name.toLowerCase() === lower);
  if (obj) return loc(obj.file, obj.start_line);

  const global_ = index.globals.find((g) => g.name.toLowerCase() === lower);
  if (global_) return loc(global_.file, global_.line);

  const constant = index.constants.find((c) => c.name.toLowerCase() === lower);
  if (constant) return loc(constant.file, constant.line);

  const array = index.arrays.find((a) => a.name.toLowerCase() === lower);
  if (array) return loc(array.file, array.line);

  // Fallback: non-system symbols (properties, attributes, etc.)
  const sym = index.symbols.find(
    (s) => !s.is_system && s.name.toLowerCase() === lower && s.file,
  );
  if (sym?.file) return loc(sym.file, sym.line ?? 1);

  return null;
}

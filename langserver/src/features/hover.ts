import * as path from "node:path";
import { Hover, MarkupKind } from "vscode-languageserver";
import type { CompilerIndex, IncludeInfo } from "../server/types";
import { findKeywordHover, findPrintRuleHover } from "./keywords";

function md(parts: string[]): Hover {
  return { contents: { kind: MarkupKind.Markdown, value: parts.join("\n\n") } };
}

/**
 * Return a display path for filePath relative to workspaceRoot.
 * If the relative path requires more than 2 leading "../" segments it's
 * more confusing than helpful, so fall back to the absolute path.
 */
function rel(filePath: string, workspaceRoot: string): string {
  const relative = path.relative(workspaceRoot, filePath);
  const leadingUps = relative.split(path.sep).filter((s) => s === "..").length;
  return leadingUps > 2 ? filePath : relative;
}

/**
 * Build a hover response for an `Include "..."` directive line.
 * Shows the resolved absolute path and the path relative to the workspace.
 */
export function findIncludeHover(inc: IncludeInfo, workspaceRoot: string): Hover {
  const display = rel(inc.resolved, workspaceRoot);
  return md([`**Include** \`"${inc.given}"\``, `→ *${display}*`]);
}

/**
 * Build a hover response for `word` using the compiler index.
 *
 * Lookup order: routines (richest data) → objects → constants → globals →
 * arrays → symbols[] fallback (covers library properties/attributes).
 */
export function findHover(
  index: CompilerIndex,
  word: string,
  workspaceRoot: string,
  lineText?: string,
  wordStart?: number,
  filePath?: string,
  line1?: number,
  objectContext?: string | null,
  skipSymbols = false,
): Hover | null {
  const lower = word.toLowerCase();

  // Print-rule keywords — checked first because in `print (The) obj` the
  // compiler always treats `The` as a print rule, regardless of any symbol
  // with that name.
  const printRuleHelp = findPrintRuleHover(word, lineText, wordStart);
  if (printRuleHelp) return md([printRuleHelp]);

  // Local variables — checked before globals so locals shadow outer names.
  // Locals are not in references[], so this runs even in the fallback path.
  if (filePath && line1 != null) {
    const enclosing = index.routines.find((r) => r.file === filePath && line1 >= r.start_line && line1 <= r.end_line);
    if (enclosing) {
      const localMatch = enclosing.locals.find((l) => l.toLowerCase() === lower);
      if (localMatch) {
        return md([`**${localMatch}** (local variable in **${enclosing.name}**)`]);
      }
    }
  }

  if (!skipSymbols) {
    // Object-context property lookup — ObjName.prop hover shows the property
    // as it appears inside that specific object body, not the global declaration.
    if (objectContext) {
      const objLower = objectContext.toLowerCase();
      const obj = index.objects.find((o) => o.name.toLowerCase() === objLower);
      if (obj) {
        const all = [...obj.properties, ...obj.private_properties, ...obj.attributes];
        const prop = all.find((p) => p.name.toLowerCase() === lower);
        if (prop) {
          const parts = [`**${prop.name}** (property of **${obj.name}**)`];
          parts.push(`*${rel(obj.file, workspaceRoot)}:${prop.line}*`);
          return md(parts);
        }
      }
    }

    // Routines
    const routine = index.routines.find((r) => r.name.toLowerCase() === lower);
    if (routine) {
      const sig =
        routine.locals.length > 0 ? `**${routine.name}**(${routine.locals.join(", ")})` : `**${routine.name}**()`;
      const parts = [sig];
      if (routine.doc) parts.push(routine.doc);
      parts.push(`*${rel(routine.file, workspaceRoot)}:${routine.start_line}*`);
      return md(parts);
    }

    // Objects / classes
    const obj = index.objects.find((o) => o.name.toLowerCase() === lower);
    if (obj) {
      const kind = obj.is_class ? "class" : "object";
      const header = obj.shortname ? `**${obj.name}** "${obj.shortname}" (${kind})` : `**${obj.name}** (${kind})`;
      const parts = [header];
      if (obj.parent) parts.push(`parent: ${obj.parent}`);
      if (obj.attributes.length > 0) parts.push(`attributes: ${obj.attributes.map((a) => a.name).join(", ")}`);
      if (obj.doc) parts.push(obj.doc);
      parts.push(`*${rel(obj.file, workspaceRoot)}:${obj.start_line}*`);
      return md(parts);
    }

    // Constants — look up numeric value from symbols[] for richer display
    const constant = index.constants.find((c) => c.name.toLowerCase() === lower);
    if (constant) {
      const sym = index.symbols.find((s) => s.name.toLowerCase() === lower);
      const header = sym !== undefined ? `**${constant.name}** = ${sym.value}` : `**${constant.name}** (constant)`;
      const parts = [header];
      if (constant.doc) parts.push(constant.doc);
      parts.push(`*${rel(constant.file, workspaceRoot)}:${constant.line}*`);
      return md(parts);
    }

    // Globals
    const global_ = index.globals.find((g) => g.name.toLowerCase() === lower);
    if (global_) {
      const parts = [`**${global_.name}** (global variable)`];
      if (global_.doc) parts.push(global_.doc);
      parts.push(`*${rel(global_.file, workspaceRoot)}:${global_.line}*`);
      return md(parts);
    }

    // Arrays
    const array = index.arrays.find((a) => a.name.toLowerCase() === lower);
    if (array) {
      const parts = [`**${array.name}** (array, ${array.size} entries)`];
      if (array.doc) parts.push(array.doc);
      parts.push(`*${rel(array.file, workspaceRoot)}:${array.line}*`);
      return md(parts);
    }

    // Symbol fallback (properties, attributes, system symbols)
    const sym = index.symbols.find((s) => s.name.toLowerCase() === lower);
    if (sym) {
      const parts = [`**${sym.name}** (${sym.type})`];
      if (sym.doc) parts.push(sym.doc);
      if (sym.file) parts.push(`*${rel(sym.file, workspaceRoot)}:${sym.line}*`);
      return md(parts);
    }
  } // end if (!skipSymbols)

  // Keyword/directive fallback — checked last so user-defined symbols win.
  // Runs even when skipSymbols=true (e.g. hovering a keyword inside a string
  // falls through here via the heuristic path, but case rules prevent false
  // positives — see findKeywordHover).
  const kw = findKeywordHover(word);
  if (kw) return md([kw]);

  return null;
}

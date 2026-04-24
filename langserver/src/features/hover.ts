import * as path from "node:path";
import { Hover, MarkupKind } from "vscode-languageserver";
import type { CompilerIndex } from "../server/types";
import { findKeywordHover } from "./keywords";

function md(parts: string[]): Hover {
  return { contents: { kind: MarkupKind.Markdown, value: parts.join("\n\n") } };
}

/**
 * Build a hover response for `word` using the compiler index.
 *
 * Lookup order: routines (richest data) → objects → constants → globals →
 * arrays → symbols[] fallback (covers library properties/attributes).
 */
function rel(filePath: string, workspaceRoot: string): string {
  return path.relative(workspaceRoot, filePath);
}

export function findHover(index: CompilerIndex, word: string, workspaceRoot: string): Hover | null {
  const lower = word.toLowerCase();

  // Routines
  const routine = index.routines.find((r) => r.name.toLowerCase() === lower);
  if (routine) {
    const sig =
      routine.locals.length > 0
        ? `**${routine.name}**(${routine.locals.join(", ")})`
        : `**${routine.name}**()`;
    const parts = [sig];
    if (routine.doc) parts.push(routine.doc);
    parts.push(`*${rel(routine.file, workspaceRoot)}:${routine.start_line}*`);
    return md(parts);
  }

  // Objects / classes
  const obj = index.objects.find((o) => o.name.toLowerCase() === lower);
  if (obj) {
    const kind = obj.is_class ? "class" : "object";
    const parts = [`**${obj.name}** (${kind})`];
    if (obj.parent) parts.push(`parent: ${obj.parent}`);
    if (obj.attributes.length > 0)
      parts.push(`attributes: ${obj.attributes.map((a) => a.name).join(", ")}`);
    if (obj.doc) parts.push(obj.doc);
    parts.push(`*${rel(obj.file, workspaceRoot)}:${obj.start_line}*`);
    return md(parts);
  }

  // Constants — look up numeric value from symbols[] for richer display
  const constant = index.constants.find((c) => c.name.toLowerCase() === lower);
  if (constant) {
    const sym = index.symbols.find((s) => s.name.toLowerCase() === lower);
    const header =
      sym !== undefined
        ? `**${constant.name}** = ${sym.value}`
        : `**${constant.name}** (constant)`;
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

  // Keyword/directive fallback — checked last so user-defined symbols win
  const kw = findKeywordHover(word);
  if (kw) return md([kw]);

  return null;
}

import type { CompilerIndex, ConditionalInfo } from "../server/types";

export interface InactiveLineRange {
  startLine: number; // 0-based, inclusive
  endLine: number; // 0-based, inclusive
}

/**
 * Returns the 0-based line range that should be grayed for a conditional, or
 * null if no part of it is inactive (active="if" with no else clause).
 *
 * active="none"  → whole block (start..end)
 * active="if"    → else..end  (else branch; requires else_line)
 * active="else"  → start..else (if branch)
 */
export function inactiveLineRange(c: ConditionalInfo): InactiveLineRange | null {
  if (c.active === "none") {
    return { startLine: c.start_line - 1, endLine: c.end_line - 1 };
  }
  if (c.active === "if" && c.else_line !== undefined) {
    return { startLine: c.else_line - 1, endLine: c.end_line - 1 };
  }
  if (c.active === "else") {
    return { startLine: c.start_line - 1, endLine: (c.else_line ?? c.end_line) - 1 };
  }
  return null;
}

export function getConditionalsForFile(index: CompilerIndex, filePath: string): ConditionalInfo[] {
  return (index.conditionals ?? []).filter((c) => c.file === filePath);
}

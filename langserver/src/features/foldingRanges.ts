import { FoldingRange, FoldingRangeKind } from "vscode-languageserver/node";
import type { CompilerIndex } from "../server/types";

export function getFoldingRanges(index: CompilerIndex, filePath: string): FoldingRange[] {
  const conditionals = index.conditionals;
  if (!conditionals || conditionals.length === 0) return [];

  const ranges: FoldingRange[] = [];

  for (const c of conditionals) {
    if (c.file !== filePath) continue;
    // LSP lines are 0-based; compiler lines are 1-based.
    // Set endLine to the line before #EndIf so the closing directive stays
    // visible when folded — the reader can see both #IfDef and #EndIf.
    const startLine = c.start_line - 1;
    const endLine = c.end_line - 2;
    if (endLine <= startLine) continue;

    ranges.push({
      startLine,
      endLine,
      kind: FoldingRangeKind.Region,
    });
  }

  return ranges;
}

import { describe, it, expect } from "vitest";
import { getFoldingRanges } from "../features/foldingRanges";
import { testIndex, FILE } from "./fixture";
import type { CompilerIndex, ConditionalInfo } from "../server/types";

function withConditionals(conditionals: ConditionalInfo[]): CompilerIndex {
  return { ...testIndex, conditionals };
}

describe("getFoldingRanges", () => {
  it("returns empty array when no conditionals", () => {
    expect(getFoldingRanges(testIndex, FILE)).toEqual([]);
  });

  it("returns empty array when conditionals is empty", () => {
    expect(getFoldingRanges(withConditionals([]), FILE)).toEqual([]);
  });

  it("converts 1-based lines to 0-based LSP lines, stopping before #EndIf", () => {
    const ranges = getFoldingRanges(
      withConditionals([
        { directive: "ifdef", file: FILE, start_line: 10, start_col: 0, end_line: 20, end_col: 0, active: "if" },
      ]),
      FILE,
    );
    expect(ranges).toHaveLength(1);
    expect(ranges[0].startLine).toBe(9);   // #IfDef line (visible)
    expect(ranges[0].endLine).toBe(18);    // line before #EndIf (last hidden)
  });

  it("skips conditionals from other files", () => {
    const ranges = getFoldingRanges(
      withConditionals([
        { directive: "ifdef", file: "/other/file.inf", start_line: 1, start_col: 0, end_line: 5, end_col: 0, active: "if" },
        { directive: "ifdef", file: FILE, start_line: 10, start_col: 0, end_line: 20, end_col: 0, active: "none" },
      ]),
      FILE,
    );
    expect(ranges).toHaveLength(1);
    expect(ranges[0].startLine).toBe(9);
  });

  it("skips empty conditionals (#IfDef immediately followed by #EndIf)", () => {
    const ranges = getFoldingRanges(
      withConditionals([
        { directive: "ifdef", file: FILE, start_line: 5, start_col: 0, end_line: 6, end_col: 0, active: "none" },
      ]),
      FILE,
    );
    expect(ranges).toHaveLength(0);
  });

  it("returns region kind", () => {
    const ranges = getFoldingRanges(
      withConditionals([
        { directive: "ifdef", file: FILE, start_line: 1, start_col: 0, end_line: 10, end_col: 0, active: "if" },
      ]),
      FILE,
    );
    expect(ranges[0].kind).toBe("region");
  });
});

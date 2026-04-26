import { describe, it, expect } from "vitest";
import { inactiveLineRange, getConditionalsForFile } from "../features/conditionals";
import type { ConditionalInfo, CompilerIndex } from "../server/types";
import { testIndex, FILE } from "./fixture";

// ---------------------------------------------------------------------------
// inactiveLineRange
// ---------------------------------------------------------------------------

describe("inactiveLineRange", () => {
  describe('active="none" (dead — nested in inactive parent, or fully skipped)', () => {
    it("returns the full start→end span", () => {
      const r = inactiveLineRange({
        directive: "ifdef",
        file: FILE,
        start_line: 10,
        start_col: 0,
        end_line: 20,
        end_col: 0,
        active: "none",
      });
      expect(r).toEqual({ startLine: 9, endLine: 19 });
    });

    it("converts 1-based compiler lines to 0-based LSP lines", () => {
      const r = inactiveLineRange({
        directive: "ifdef",
        file: FILE,
        start_line: 1,
        start_col: 0,
        end_line: 3,
        end_col: 0,
        active: "none",
      });
      expect(r).toEqual({ startLine: 0, endLine: 2 });
    });

    it("includes else_line in the span when present", () => {
      const r = inactiveLineRange({
        directive: "ifdef",
        file: FILE,
        start_line: 10,
        start_col: 0,
        else_line: 15,
        else_col: 0,
        end_line: 20,
        end_col: 0,
        active: "none",
      });
      expect(r).toEqual({ startLine: 9, endLine: 19 });
    });
  });

  describe('active="if" (first branch compiled)', () => {
    it("returns null when there is no else clause", () => {
      const r = inactiveLineRange({
        directive: "ifdef",
        file: FILE,
        start_line: 10,
        start_col: 0,
        end_line: 20,
        end_col: 0,
        active: "if",
      });
      expect(r).toBeNull();
    });

    it("returns else_line→end_line when an else clause is present", () => {
      const r = inactiveLineRange({
        directive: "ifdef",
        file: FILE,
        start_line: 10,
        start_col: 0,
        else_line: 15,
        else_col: 0,
        end_line: 20,
        end_col: 0,
        active: "if",
      });
      expect(r).toEqual({ startLine: 14, endLine: 19 });
    });
  });

  describe('active="else" (else branch compiled)', () => {
    it("returns start_line→else_line when else_line is present", () => {
      const r = inactiveLineRange({
        directive: "ifdef",
        file: FILE,
        start_line: 10,
        start_col: 0,
        else_line: 15,
        else_col: 0,
        end_line: 20,
        end_col: 0,
        active: "else",
      });
      expect(r).toEqual({ startLine: 9, endLine: 14 });
    });

    it("falls back to end_line when else_line is absent (malformed but safe)", () => {
      const r = inactiveLineRange({
        directive: "ifdef",
        file: FILE,
        start_line: 10,
        start_col: 0,
        end_line: 20,
        end_col: 0,
        active: "else",
      });
      expect(r).toEqual({ startLine: 9, endLine: 19 });
    });
  });

  it("handles all directive types without error", () => {
    const directives = ["ifdef", "ifndef", "ifv3", "ifv5", "iftrue", "iffalse"] as const;
    for (const directive of directives) {
      expect(() =>
        inactiveLineRange({
          directive,
          file: FILE,
          start_line: 1,
          start_col: 0,
          end_line: 5,
          end_col: 0,
          active: "none",
        }),
      ).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// getConditionalsForFile
// ---------------------------------------------------------------------------

const OTHER = "/project/other.inf";

const sampleConditionals: ConditionalInfo[] = [
  { directive: "ifdef", file: FILE, start_line: 10, start_col: 0, end_line: 15, end_col: 0, active: "if" },
  { directive: "ifdef", file: OTHER, start_line: 20, start_col: 0, end_line: 25, end_col: 0, active: "none" },
  { directive: "ifv5", file: FILE, start_line: 30, start_col: 0, end_line: 35, end_col: 0, active: "none" },
];

function withConditionals(conditionals: ConditionalInfo[]): CompilerIndex {
  return { ...testIndex, conditionals };
}

describe("getConditionalsForFile", () => {
  it("returns only conditionals for the requested file", () => {
    const result = getConditionalsForFile(withConditionals(sampleConditionals), FILE);
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.file === FILE)).toBe(true);
  });

  it("returns empty array when no conditionals match the file", () => {
    const result = getConditionalsForFile(withConditionals(sampleConditionals), "/no/match.inf");
    expect(result).toEqual([]);
  });

  it("returns empty array when conditionals is absent from the index", () => {
    const result = getConditionalsForFile(testIndex, FILE);
    expect(result).toEqual([]);
  });

  it("returns empty array when conditionals is empty", () => {
    const result = getConditionalsForFile(withConditionals([]), FILE);
    expect(result).toEqual([]);
  });

  it("preserves order", () => {
    const result = getConditionalsForFile(withConditionals(sampleConditionals), FILE);
    expect(result[0].start_line).toBe(10);
    expect(result[1].start_line).toBe(30);
  });
});

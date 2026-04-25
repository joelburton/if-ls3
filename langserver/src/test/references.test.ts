import { describe, it, expect } from "vitest";
import { URI } from "vscode-uri";
import { findReferences } from "../features/references";
import type { CompilerIndex } from "../server/types";
import { FILE, testIndex } from "./fixture";

const FILE2 = "/project/library.h";

const uri = URI.file(FILE).toString();
const uri2 = URI.file(FILE2).toString();

/** Expected Location at a given file URI, line (1-based), and col (0-based). */
function loc(fileUri: string, line1: number, col = 0) {
  const pos = { line: line1 - 1, character: col };
  return { uri: fileUri, range: { start: pos, end: pos } };
}

/** Base index with two files and a set of references entries. */
const indexWithRefs: CompilerIndex = {
  ...testIndex,
  files: [FILE, FILE2],
  references: [
    { sym: "MyFunc", type: "routine", locs: ["0:30:2"] },
    { sym: "description", type: "property", locs: ["0:15:4", "0:25:24"] },
    { sym: "NOPE", type: "constant", locs: ["0:29:13"] },
    { sym: "TheRoom", type: "object", locs: ["0:40:0", "1:7:3"] },
    { sym: "c", type: "global_variable", locs: ["0:50:8"] },
  ],
};

describe("findReferences", () => {
  it("returns empty array when references field is absent", () => {
    expect(findReferences(testIndex, "MyFunc")).toEqual([]);
  });

  it("returns empty array for an unknown symbol", () => {
    expect(findReferences(indexWithRefs, "Nonexistent")).toEqual([]);
  });

  it("finds a single reference location", () => {
    expect(findReferences(indexWithRefs, "MyFunc")).toEqual([loc(uri, 30, 2)]);
  });

  it("finds multiple reference locations for one symbol", () => {
    expect(findReferences(indexWithRefs, "description")).toEqual([
      loc(uri, 15, 4),
      loc(uri, 25, 24),
    ]);
  });

  it("is case-insensitive", () => {
    expect(findReferences(indexWithRefs, "myfunc")).toEqual([loc(uri, 30, 2)]);
    expect(findReferences(indexWithRefs, "MYFUNC")).toEqual([loc(uri, 30, 2)]);
    expect(findReferences(indexWithRefs, "myFunc")).toEqual([loc(uri, 30, 2)]);
  });

  it("resolves references across multiple files", () => {
    // TheRoom has one loc in FILE (index 0) and one in FILE2 (index 1).
    expect(findReferences(indexWithRefs, "TheRoom")).toEqual([
      loc(uri, 40, 0),
      loc(uri2, 7, 3),
    ]);
  });

  it("only returns locations for the matching symbol", () => {
    const locs = findReferences(indexWithRefs, "NOPE");
    expect(locs).toHaveLength(1);
    expect(locs[0]).toEqual(loc(uri, 29, 13));
  });

  it("preserves column position", () => {
    const locs = findReferences(indexWithRefs, "c");
    expect(locs[0].range.start.character).toBe(8);
  });

  it("converts 1-based line to 0-based in the LSP location", () => {
    // MyFunc ref is at line 30 (1-based) → line 29 (0-based) in LSP.
    const locs = findReferences(indexWithRefs, "MyFunc");
    expect(locs[0].range.start.line).toBe(29);
  });

  it("skips malformed loc strings", () => {
    const idx: CompilerIndex = {
      ...indexWithRefs,
      references: [
        { sym: "Broken", type: "routine", locs: ["not-a-loc", "0:10:0", "bad"] },
      ],
    };
    // Only the valid loc "0:10:0" should be returned.
    expect(findReferences(idx, "Broken")).toEqual([loc(uri, 10, 0)]);
  });

  it("skips locs with out-of-range file index", () => {
    const idx: CompilerIndex = {
      ...indexWithRefs,
      references: [
        { sym: "Ghost", type: "routine", locs: ["99:5:0", "0:5:0"] },
      ],
    };
    // File index 99 does not exist; only the valid loc should be returned.
    expect(findReferences(idx, "Ghost")).toEqual([loc(uri, 5, 0)]);
  });

  it("returns empty array for a symbol with no locs", () => {
    const idx: CompilerIndex = {
      ...indexWithRefs,
      references: [{ sym: "Empty", type: "routine", locs: [] }],
    };
    expect(findReferences(idx, "Empty")).toEqual([]);
  });
});

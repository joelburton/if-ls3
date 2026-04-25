import { describe, it, expect } from "vitest";
import { URI } from "vscode-uri";
import { includeAtLine } from "../features/definition";
import { findIncludeHover } from "../features/hover";
import { FILE, testIndex } from "./fixture";
import type { CompilerIndex, IncludeInfo } from "../server/types";

const LIB = "/lib/parser.h";

const parserInc: IncludeInfo = {
  from_file: FILE,
  from_line: 3,
  from_col: 8,
  given: "Parser",
  resolved: LIB,
  file_index: 1,
};

const localInc: IncludeInfo = {
  from_file: FILE,
  from_line: 5,
  from_col: 8,
  given: ">local_defs",
  resolved: "/project/local_defs.h",
  file_index: 2,
};

function makeIndex(incs: IncludeInfo[]): CompilerIndex {
  return { ...testIndex, files: [FILE, LIB], includes: incs };
}

// ── includeAtLine ────────────────────────────────────────────────────────────

describe("includeAtLine", () => {
  it("returns undefined when includes field is absent", () => {
    expect(includeAtLine(testIndex, FILE, 3)).toBeUndefined();
  });

  it("returns undefined when includes is empty", () => {
    expect(includeAtLine(makeIndex([]), FILE, 3)).toBeUndefined();
  });

  it("finds an include on the matching line", () => {
    const result = includeAtLine(makeIndex([parserInc]), FILE, 3);
    expect(result).toMatchObject({ given: "Parser", resolved: LIB });
  });

  it("returns undefined for a different line", () => {
    expect(includeAtLine(makeIndex([parserInc]), FILE, 4)).toBeUndefined();
  });

  it("returns undefined when the file path does not match", () => {
    expect(includeAtLine(makeIndex([parserInc]), "/other/file.inf", 3)).toBeUndefined();
  });

  it("picks the correct entry when multiple includes are present", () => {
    const idx = makeIndex([parserInc, localInc]);
    expect(includeAtLine(idx, FILE, 3)).toMatchObject({ given: "Parser" });
    expect(includeAtLine(idx, FILE, 5)).toMatchObject({ given: ">local_defs" });
  });

  it("matches on from_file and from_line exactly", () => {
    // from_line 3 → line 3 matches; line 2 and 4 do not.
    const idx = makeIndex([parserInc]);
    expect(includeAtLine(idx, FILE, 2)).toBeUndefined();
    expect(includeAtLine(idx, FILE, 3)).toBeDefined();
    expect(includeAtLine(idx, FILE, 4)).toBeUndefined();
  });
});

// ── findIncludeHover ─────────────────────────────────────────────────────────

describe("findIncludeHover", () => {
  it("returns a Hover object", () => {
    const hover = findIncludeHover(parserInc, "/project");
    expect(hover).toBeDefined();
    expect(hover.contents).toBeDefined();
  });

  it("includes the given filename in the hover text", () => {
    const hover = findIncludeHover(parserInc, "/project");
    const text = JSON.stringify(hover.contents);
    expect(text).toContain("Parser");
  });

  it("includes the resolved path (or its relative form) in the hover text", () => {
    const hover = findIncludeHover(parserInc, "/project");
    const text = JSON.stringify(hover.contents);
    // The resolved path is /lib/parser.h; relative to /project it's ../lib/parser.h
    expect(text).toContain("parser.h");
  });

  it("preserves the > prefix in the given name for local includes", () => {
    const hover = findIncludeHover(localInc, "/project");
    const text = JSON.stringify(hover.contents);
    expect(text).toContain(">local_defs");
  });
});

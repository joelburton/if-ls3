import { describe, it, expect } from "vitest";
import { getSemanticTokens } from "../features/semanticTokens";
import { FILE, testIndex } from "./fixture";

// Token type indices from semanticTokens.ts (must match the legend in server.ts).
const VAR   = 0;  // local variable
const PROP  = 1;  // global variable
const ENUM  = 2;  // constant

/** Decode the raw number[] into readable token objects for easier assertions. */
function decode(data: number[]): { line: number; char: number; len: number; type: number }[] {
  const tokens = [];
  let line = 0;
  let char = 0;
  for (let i = 0; i < data.length; i += 5) {
    const deltaLine = data[i];
    const deltaChar = data[i + 1];
    const len       = data[i + 2];
    const type      = data[i + 3];
    line += deltaLine;
    char = deltaLine === 0 ? char + deltaChar : deltaChar;
    tokens.push({ line, char, len, type });
  }
  return tokens;
}

describe("getSemanticTokens", () => {
  it("returns an empty array for empty source", () => {
    expect(getSemanticTokens(testIndex, FILE, "")).toEqual([]);
  });

  it("returns an empty array when the file has no matching symbols", () => {
    // Source with identifiers that don't match any index symbol.
    expect(getSemanticTokens(testIndex, FILE, "bogus = other;\n")).toEqual([]);
  });

  describe("global variable highlighting", () => {
    it("emits a PROP token for a global", () => {
      // "c" is a global in testIndex.
      const tokens = decode(getSemanticTokens(testIndex, FILE, "c = 1;\n"));
      expect(tokens).toContainEqual({ line: 0, char: 0, len: 1, type: PROP });
    });

    it("emits tokens for multiple globals on one line", () => {
      // "c" and "location" are both globals.
      const tokens = decode(getSemanticTokens(testIndex, FILE, "c = location;\n"));
      const types = tokens.map(t => t.type);
      expect(types).toContain(PROP);
      expect(tokens.filter(t => t.type === PROP)).toHaveLength(2);
    });

    it("highlights the same global on multiple lines", () => {
      const src = "c = 1;\nc = 2;\n";
      const tokens = decode(getSemanticTokens(testIndex, FILE, src));
      const props = tokens.filter(t => t.type === PROP);
      expect(props).toHaveLength(2);
      expect(props[0].line).toBe(0);
      expect(props[1].line).toBe(1);
    });
  });

  describe("constant highlighting", () => {
    it("emits an ENUM token for a constant", () => {
      // "NOPE" is a constant in testIndex.
      const tokens = decode(getSemanticTokens(testIndex, FILE, "x = NOPE;\n"));
      expect(tokens).toContainEqual(expect.objectContaining({ type: ENUM }));
      const nope = tokens.find(t => t.type === ENUM);
      expect(nope?.len).toBe(4); // "NOPE"
    });
  });

  describe("local variable highlighting", () => {
    it("emits VAR tokens for locals within the routine range", () => {
      // MyFunc spans lines 58-66 (1-based) = 57-65 (0-based).
      // Provide source with enough lines to reach line 57.
      const src = "\n".repeat(57) + "  a = b;\n";
      const tokens = decode(getSemanticTokens(testIndex, FILE, src));
      const vars = tokens.filter(t => t.type === VAR);
      // "a" and "b" are locals of MyFunc.
      expect(vars.length).toBeGreaterThanOrEqual(2);
    });

    it("does NOT highlight locals outside their routine's line range", () => {
      // "a" and "b" are locals of MyFunc (lines 58-66).
      // On line 1 they should not be colored.
      const src = "a = b;\n";
      const tokens = decode(getSemanticTokens(testIndex, FILE, src));
      const vars = tokens.filter(t => t.type === VAR);
      expect(vars).toHaveLength(0);
    });
  });

  describe("local shadows global/constant", () => {
    it("emits VAR (not PROP) when a local name matches a global", () => {
      // "c" is a global; add a routine whose local is also named "c".
      const idx = {
        ...testIndex,
        routines: [
          { name: "Shadow", file: FILE, start_line: 1, end_line: 2, locals: ["c"] },
        ],
      };
      // Line 0 (0-based) is inside Shadow (start_line=1, end_line=2 → 0-based 0-1).
      const tokens = decode(getSemanticTokens(idx, FILE, "c = 1;\n"));
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({ char: 0, len: 1, type: VAR });
    });

    it("emits VAR (not ENUM) when a local name matches a constant", () => {
      // "NOPE" is a constant; add a routine with a local also named "NOPE".
      const idx = {
        ...testIndex,
        routines: [
          { name: "Shadow", file: FILE, start_line: 1, end_line: 2, locals: ["NOPE"] },
        ],
      };
      const tokens = decode(getSemanticTokens(idx, FILE, "NOPE = 0;\n"));
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({ type: VAR });
    });

    it("reverts to PROP outside the routine where the local was declared", () => {
      // "c" is a local of Shadow which spans lines 0-1 (0-based).
      // On line 2 (outside Shadow) the same name should be highlighted as PROP.
      const idx = {
        ...testIndex,
        routines: [
          { name: "Shadow", file: FILE, start_line: 1, end_line: 2, locals: ["c"] },
        ],
      };
      // line 0: inside Shadow → VAR; line 2: outside → PROP
      const src = "c;\n\nc;\n";
      const tokens = decode(getSemanticTokens(idx, FILE, src));
      expect(tokens).toHaveLength(2);
      expect(tokens[0]).toMatchObject({ line: 0, type: VAR });
      expect(tokens[1]).toMatchObject({ line: 2, type: PROP });
    });
  });

  describe("comment and string skipping", () => {
    it("does not emit a token for a global inside a ! comment", () => {
      const src = "! c = location;\n";
      expect(decode(getSemanticTokens(testIndex, FILE, src))).toHaveLength(0);
    });

    it("does not emit a token for a global inside a string literal", () => {
      const src = `print "c location";\n`;
      const tokens = decode(getSemanticTokens(testIndex, FILE, src));
      expect(tokens).toHaveLength(0);
    });

    it("highlights an identifier immediately after a closing string quote", () => {
      // Scanner must resume after the closing " — "str"location → location is PROP.
      //   0123456789012
      //   "str"location
      // location starts at char 5, len 8.
      const src = `"str"location;\n`;
      const tokens = decode(getSemanticTokens(testIndex, FILE, src));
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({ char: 5, len: 8, type: PROP });
    });

    it("does not emit a token for a global inside a dictionary word", () => {
      const src = `if (noun == 'c') print "ok";\n`;
      // 'c' inside single quotes should not be colored.
      const tokens = decode(getSemanticTokens(testIndex, FILE, src));
      // "noun" might not be in the index; only check no token covers the 'c'.
      const cTokens = tokens.filter(t => t.char === src.indexOf("'c'") + 1 && t.len === 1);
      expect(cTokens).toHaveLength(0);
    });

    it("highlights a global that appears after a comment on the same line is irrelevant (global before !)", () => {
      // Global before the comment should still be highlighted.
      const src = "c = 1; ! c is also here\n";
      const tokens = decode(getSemanticTokens(testIndex, FILE, src));
      const props = tokens.filter(t => t.type === PROP);
      // Only the first "c" (before !) should be highlighted.
      expect(props).toHaveLength(1);
      expect(props[0].char).toBe(0);
    });
  });

  describe("LSP delta encoding", () => {
    it("encodes the first token with absolute line and char", () => {
      const src = "  c = 1;\n";
      const raw = getSemanticTokens(testIndex, FILE, src);
      // First token: [deltaLine=0, deltaChar=2, len=1, type=PROP, modifiers=0]
      expect(raw[0]).toBe(0); // deltaLine
      expect(raw[1]).toBe(2); // deltaChar (absolute for first token)
    });

    it("encodes a second token on the same line with a relative char delta", () => {
      // "c = location;" — c at char 0, location at char 4.
      const src = "c = location;\n";
      const raw = getSemanticTokens(testIndex, FILE, src);
      // Token 0: line=0, char=0, len=1 (c)
      // Token 1: line=0, char=4, len=8 (location) — delta char = 4-0 = 4
      expect(raw.length).toBe(10); // 2 tokens × 5 integers
      expect(raw[5]).toBe(0); // deltaLine = 0 (same line)
      expect(raw[6]).toBe(4); // deltaChar = 4 - 0
    });

    it("encodes a token on a new line with deltaLine > 0 and absolute char", () => {
      const src = "c = 1;\nlocation = 2;\n";
      const raw = getSemanticTokens(testIndex, FILE, src);
      // Token 0: line 0, char 0, len 1 (c) → [0, 0, 1, PROP, 0]
      // Token 1: line 1, char 0, len 8 (location) → [1, 0, 8, PROP, 0]
      expect(raw[5]).toBe(1); // deltaLine = 1
      expect(raw[6]).toBe(0); // deltaChar = 0 (absolute since new line)
    });

    it("produces 5 integers per token", () => {
      const src = "c = NOPE;\n";
      const raw = getSemanticTokens(testIndex, FILE, src);
      expect(raw.length % 5).toBe(0);
    });
  });

  describe("sort before encoding", () => {
    it("produces tokens in line order even when routines are listed out of order in the index", () => {
      // Index lists Late (lines 5-6) BEFORE Early (lines 1-2).
      // collectLocalTokens runs in index order, so without the sort step Late's
      // tokens would precede Early's in the array, producing a negative deltaLine
      // in the encoded output (which the LSP spec forbids).
      const idx = {
        ...testIndex,
        globals: [],
        constants: [],
        routines: [
          { name: "Late",  file: FILE, start_line: 5, end_line: 6, locals: ["late_var"] },
          { name: "Early", file: FILE, start_line: 1, end_line: 2, locals: ["early_var"] },
        ],
      };
      const src = [
        "early_var;", // line 0 — inside Early (1-based 1-2 → 0-based 0-1)
        "",
        "",
        "",
        "late_var;",  // line 4 — inside Late  (1-based 5-6 → 0-based 4-5)
        "",
      ].join("\n");

      const raw = getSemanticTokens(idx, FILE, src);
      const decoded = decode(raw);

      // Correct order: early_var first, late_var second.
      expect(decoded).toHaveLength(2);
      expect(decoded[0]).toMatchObject({ line: 0, type: VAR }); // early_var
      expect(decoded[1]).toMatchObject({ line: 4, type: VAR }); // late_var

      // deltaLine values in the raw output must all be non-negative.
      for (let i = 0; i < raw.length; i += 5)
        expect(raw[i]).toBeGreaterThanOrEqual(0);
    });
  });

  describe("file filtering", () => {
    it("does not highlight symbols from a different file", () => {
      // Use a file path not in testIndex — no routines/globals match.
      const tokens = decode(getSemanticTokens(testIndex, "/other/file.inf", "c = location;\n"));
      // Globals are matched by name regardless of file, but locals would be wrong file.
      // The global/constant scan doesn't filter by file — this is expected behavior.
      // Just verify no locals from MyFunc (which is on FILE) bleed into other files.
      const vars = tokens.filter(t => t.type === VAR);
      expect(vars).toHaveLength(0);
    });
  });
});

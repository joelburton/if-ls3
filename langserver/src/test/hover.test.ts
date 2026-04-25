import { describe, it, expect } from "vitest";
import { findHover } from "../features/hover";
import { FILE, testIndex } from "./fixture";

const ROOT = "/project";

/** Extract the markdown value string from a hover result. */
function md(hover: ReturnType<typeof findHover>): string {
  if (!hover) throw new Error("expected non-null hover");
  const c = hover.contents;
  if (typeof c === "string") return c;
  if ("value" in c) return c.value;
  return "";
}

describe("findHover", () => {
  it("returns null for unknown word", () => {
    expect(findHover(testIndex, "nonexistent", ROOT)).toBeNull();
  });

  describe("routines", () => {
    it("shows signature with locals", () => {
      const text = md(findHover(testIndex, "MyFunc", ROOT));
      expect(text).toContain("**MyFunc**(a, b, x)");
    });

    it("includes source location", () => {
      const text = md(findHover(testIndex, "MyFunc", ROOT));
      expect(text).toContain("game.inf:58");
    });

    it("handles routine with no locals (parens only)", () => {
      const text = md(findHover(testIndex, "FoozleSub", ROOT));
      expect(text).toContain("**FoozleSub**()");
    });
  });

  describe("objects", () => {
    it("shows object name with shortname and kind", () => {
      const text = md(findHover(testIndex, "TheRoom", ROOT));
      expect(text).toContain('**TheRoom** "The Room" (object)');
    });

    it("includes attributes", () => {
      const text = md(findHover(testIndex, "TheRoom", ROOT));
      expect(text).toContain("light");
    });

    it("includes doc comment", () => {
      const text = md(findHover(testIndex, "TheRoom", ROOT));
      expect(text).toContain("doc comment for TheRoom");
    });

    it("shows class kind for a class", () => {
      const text = md(findHover(testIndex, "Room", ROOT));
      expect(text).toContain("(class)");
    });
  });

  describe("constants", () => {
    it("shows constant value from symbols[]", () => {
      // NOPE has value 0 in symbols[].
      const text = md(findHover(testIndex, "NOPE", ROOT));
      expect(text).toContain("**NOPE** = 0");
    });

    it("includes doc comment if present", () => {
      // NOPE has no doc; Foozle has value 10.
      const text = md(findHover(testIndex, "Foozle", ROOT));
      expect(text).toContain("**Foozle** = 10");
    });
  });

  describe("globals", () => {
    it("shows global variable label", () => {
      const text = md(findHover(testIndex, "c", ROOT));
      expect(text).toContain("**c** (global variable)");
    });

    it("includes doc comment", () => {
      const text = md(findHover(testIndex, "c", ROOT));
      expect(text).toContain("Doc comment for c");
    });
  });

  describe("arrays", () => {
    it("shows array label with size", () => {
      const text = md(findHover(testIndex, "WordArray", ROOT));
      expect(text).toContain("**WordArray** (array, 10 entries)");
    });
  });

  describe("symbol fallback", () => {
    it("shows type for symbols not in other categories", () => {
      // "description" is only in symbols[].
      const text = md(findHover(testIndex, "description", ROOT));
      expect(text).toContain("**description** (property)");
    });
  });

  describe("local variables", () => {
    it("returns local variable hover when cursor is inside a routine", () => {
      // MyFunc spans lines 58-66; cursor at line 60 (1-based).
      const text = md(findHover(testIndex, "a", ROOT, undefined, undefined, FILE, 60));
      expect(text).toContain("**a** (local variable in **MyFunc**)");
    });

    it("does not return local hover when cursor is outside the routine", () => {
      // Line 1 is outside MyFunc (58-66).
      const result = findHover(testIndex, "a", ROOT, undefined, undefined, FILE, 1);
      // "a" is not a known global/constant/etc., so should be null.
      expect(result).toBeNull();
    });
  });

  describe("keyword fallback", () => {
    it("returns keyword help for a known keyword", () => {
      const text = md(findHover(testIndex, "if", ROOT));
      expect(text).toContain("**if**");
    });

    it("keyword fallback only fires when no user symbol matches", () => {
      // "c" is a global — should get global hover, not keyword help.
      const text = md(findHover(testIndex, "c", ROOT));
      expect(text).toContain("(global variable)");
    });
  });
});

import { describe, it, expect } from "vitest";
import { findHover } from "../features/hover";
import { enclosingObject } from "../features/symbolLookup";
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

  describe("object context (dot hover)", () => {
    it("shows property in object context with body line, not declaration line", () => {
      // my_test is at line 22 inside TheRoom, but line 4 in symbols[].
      const text = md(findHover(testIndex, "my_test", ROOT, undefined, undefined, undefined, undefined, "TheRoom"));
      expect(text).toContain("property of **TheRoom**");
      expect(text).toContain("game.inf:22");
      expect(text).not.toContain("game.inf:4");
    });

    it("falls back to normal hover when objectContext is null", () => {
      const text = md(findHover(testIndex, "my_test", ROOT));
      expect(text).toContain("individual_property");
      expect(text).toContain("game.inf:4");
    });

    it("falls back to normal hover when object is not found", () => {
      const text = md(findHover(testIndex, "MyFunc", ROOT, undefined, undefined, undefined, undefined, "Bogus"));
      expect(text).toContain("**MyFunc**");
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

    it("keywords are case-sensitive: uppercase first letter gets no match", () => {
      expect(findHover(testIndex, "If", ROOT)).toBeNull();
      expect(findHover(testIndex, "IF", ROOT)).toBeNull();
    });

    it("directives match only with lead-cap", () => {
      const upper = md(findHover(testIndex, "Verb", ROOT));
      expect(upper).toContain("**Verb**");
      expect(findHover(testIndex, "verb", ROOT)).toBeNull();
    });
  });

  describe("self hover (enclosingObject)", () => {
    // TheRoom spans lines 10-20 in the fixture; TheRoom.before (embedded) 16-19.

    it("enclosingObject returns the object containing the line", () => {
      const obj = enclosingObject(testIndex, FILE, 15);
      expect(obj?.name).toBe("TheRoom");
    });

    it("enclosingObject returns undefined outside any object", () => {
      expect(enclosingObject(testIndex, FILE, 5)).toBeUndefined();
    });

    it("enclosingObject returns undefined for a different file", () => {
      expect(enclosingObject(testIndex, "/other/file.inf", 15)).toBeUndefined();
    });

    it("hovering 'self' inside an object body shows the object hover", () => {
      // Simulate the resolution server.ts does: look up obj.name instead of "self".
      const obj = enclosingObject(testIndex, FILE, 15)!;
      const text = md(findHover(testIndex, obj.name, ROOT));
      expect(text).toContain('**TheRoom** "The Room" (object)');
    });

    it("hovering a property with self-context shows property-of-object info", () => {
      // "description" with objectContext resolved from "self" → "TheRoom".
      const obj = enclosingObject(testIndex, FILE, 15)!;
      const text = md(findHover(testIndex, "description", ROOT, undefined, undefined, undefined, undefined, obj.name));
      expect(text).toContain("property of **TheRoom**");
    });
  });

  describe("skipSymbols flag", () => {
    it("returns null for a known symbol when skipSymbols=true", () => {
      // "description" is in symbols[] — should be hidden in fallback path.
      expect(findHover(testIndex, "description", ROOT, undefined, undefined, undefined, undefined, undefined, true)).toBeNull();
    });

    it("still returns keyword help when skipSymbols=true", () => {
      const text = md(findHover(testIndex, "if", ROOT, undefined, undefined, undefined, undefined, undefined, true));
      expect(text).toContain("**if**");
    });

    it("still returns local variable hover when skipSymbols=true", () => {
      // Local "a" in MyFunc (lines 58-66), filePath and line1 still provided.
      const text = md(
        findHover(testIndex, "a", ROOT, undefined, undefined, FILE, 60, undefined, true),
      );
      expect(text).toContain("**a** (local variable in **MyFunc**)");
    });

    it("still returns print-rule hover when skipSymbols=true", () => {
      const lineText = 'print (string) x;';
      const text = md(
        findHover(testIndex, "string", ROOT, lineText, 7, undefined, undefined, undefined, true),
      );
      expect(text).toContain("**print (string)**");
    });
  });
});

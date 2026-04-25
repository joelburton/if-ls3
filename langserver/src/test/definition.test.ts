import { describe, it, expect } from "vitest";
import { URI } from "vscode-uri";
import { findDefinition } from "../features/definition";
import { FILE, testIndex } from "./fixture";

const uri = URI.file(FILE).toString();

/** Expected Location at FILE, 1-based line converted to 0-based. */
function loc(line1: number) {
  const pos = { line: line1 - 1, character: 0 };
  return { uri, range: { start: pos, end: pos } };
}

describe("findDefinition", () => {
  it("finds a routine by name", () => {
    expect(findDefinition(testIndex, "MyFunc", null)).toEqual(loc(58));
  });

  it("is case-insensitive", () => {
    expect(findDefinition(testIndex, "myfunc", null)).toEqual(loc(58));
    expect(findDefinition(testIndex, "MYFUNC", null)).toEqual(loc(58));
  });

  it("finds an object by name", () => {
    expect(findDefinition(testIndex, "TheRoom", null)).toEqual(loc(10));
  });

  it("finds a constant by name", () => {
    expect(findDefinition(testIndex, "NOPE", null)).toEqual(loc(29));
  });

  it("finds a global by name", () => {
    expect(findDefinition(testIndex, "c", null)).toEqual(loc(40));
  });

  it("finds an array by name", () => {
    expect(findDefinition(testIndex, "WordArray", null)).toEqual(loc(98));
  });

  it("falls back to symbols[] for properties not in other categories", () => {
    // "description" is only in symbols[], not in routines/objects/globals/constants/arrays.
    expect(findDefinition(testIndex, "description", null)).toEqual(loc(14));
  });

  it("returns null for unknown names", () => {
    expect(findDefinition(testIndex, "nonexistent", null)).toBeNull();
  });

  it("returns null for system-only symbols", () => {
    // "nothing" is in symbols[] but is_system=true, so should not resolve.
    expect(findDefinition(testIndex, "nothing", null)).toBeNull();
  });

  describe("object context (dot navigation)", () => {
    it("resolves a property inside an object body", () => {
      expect(findDefinition(testIndex, "description", "TheRoom")).toEqual(loc(14));
    });

    it("resolves a private property inside an object body", () => {
      expect(findDefinition(testIndex, "super_secret", "TheRoom")).toEqual(loc(13));
    });

    it("resolves an attribute inside an object body", () => {
      expect(findDefinition(testIndex, "light", "TheRoom")).toEqual(loc(11));
    });

    it("falls through to normal lookup for unknown context object", () => {
      // Object "Bogus" does not exist — fall through to normal lookup.
      expect(findDefinition(testIndex, "MyFunc", "Bogus")).toEqual(loc(58));
    });
  });

  describe("action references", () => {
    it("resolves ##Action to ActionSub routine (isExplicitAction=true)", () => {
      // "FoozleSub" exists — ##Foozle should navigate there.
      expect(findDefinition(testIndex, "Foozle", null, true, true)).toEqual(loc(89));
    });

    it("returns null for unknown explicit action", () => {
      // No "BoggleSub" routine exists.
      expect(findDefinition(testIndex, "Boggle", null, true, true)).toBeNull();
    });

    it("falls through to normal lookup for switch-case label (isExplicitAction=false)", () => {
      // "TheRoom:" in a switch — no "TheRoomSub" exists, so falls through to object.
      expect(findDefinition(testIndex, "TheRoom", null, true, false)).toEqual(loc(10));
    });
  });
});

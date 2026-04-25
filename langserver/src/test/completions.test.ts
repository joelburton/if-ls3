import { describe, it, expect } from "vitest";
import { CompletionItemKind } from "vscode-languageserver";
import { getCompletions } from "../features/completions";
import { FILE, testIndex } from "./fixture";

/** Position helper — vitest line numbers are 0-based. */
const pos = (line: number, character: number) => ({ line, character });

describe("getCompletions", () => {
  describe("general completions (no dot)", () => {
    const items = getCompletions(testIndex, FILE, pos(0, 0), "");

    it("includes non-embedded routines", () => {
      const labels = items.map((i) => i.label);
      expect(labels).toContain("MyFunc");
      expect(labels).toContain("FoozleSub");
    });

    it("excludes embedded routines", () => {
      const labels = items.map((i) => i.label);
      expect(labels).not.toContain("TheRoom_before");
    });

    it("includes objects", () => {
      const labels = items.map((i) => i.label);
      expect(labels).toContain("TheRoom");
      expect(labels).toContain("Room");
    });

    it("marks objects with Module kind and classes with Class kind", () => {
      const theRoom = items.find((i) => i.label === "TheRoom");
      expect(theRoom?.kind).toBe(CompletionItemKind.Module);
      const room = items.find((i) => i.label === "Room");
      expect(room?.kind).toBe(CompletionItemKind.Class);
    });

    it("includes globals", () => {
      const labels = items.map((i) => i.label);
      expect(labels).toContain("c");
      expect(labels).toContain("location");
    });

    it("includes constants", () => {
      const labels = items.map((i) => i.label);
      expect(labels).toContain("NOPE");
      expect(labels).toContain("Foozle");
    });

    it("includes arrays", () => {
      const labels = items.map((i) => i.label);
      expect(labels).toContain("WordArray");
    });

    it("includes keyword completions", () => {
      const labels = items.map((i) => i.label);
      expect(labels).toContain("if");
      expect(labels).toContain("Object");
    });

    it("does not include duplicate labels", () => {
      const labels = items.map((i) => i.label.toLowerCase());
      const unique = new Set(labels);
      expect(labels.length).toBe(unique.size);
    });

    it("includes function signature as detail", () => {
      const myFunc = items.find((i) => i.label === "MyFunc");
      expect(myFunc?.detail).toBe("(a, b, x)");
    });
  });

  describe("local variable completions", () => {
    it("includes locals of the enclosing routine", () => {
      // MyFunc spans lines 58-66 (1-based). Position.line is 0-based, so line 60 = index 59.
      const items = getCompletions(testIndex, FILE, pos(59, 0), "");
      const labels = items.map((i) => i.label);
      expect(labels).toContain("a");
      expect(labels).toContain("b");
      expect(labels).toContain("x");
    });

    it("locals appear before other symbols", () => {
      const items = getCompletions(testIndex, FILE, pos(59, 0), "");
      const firstNonLocal = items.findIndex(
        (i) => i.kind !== CompletionItemKind.Variable || !["a", "b", "x"].includes(i.label),
      );
      const lastLocal = items.reduce(
        (idx, item, i) =>
          ["a", "b", "x"].includes(item.label) && item.kind === CompletionItemKind.Variable ? i : idx,
        -1,
      );
      expect(lastLocal).toBeLessThan(firstNonLocal);
    });

    it("does not include locals when cursor is outside the routine", () => {
      // Line 0 is outside MyFunc (which starts at line 58, i.e., index 57).
      const items = getCompletions(testIndex, FILE, pos(0, 0), "");
      const labels = items.map((i) => i.label);
      // "a" and "b" are locals only; they shouldn't appear unless there's a
      // global/constant/etc. with the same name.
      expect(labels).not.toContain("a");
      expect(labels).not.toContain("b");
    });
  });

  describe("dot completion", () => {
    it("returns object properties and attributes after a dot", () => {
      const lineText = "TheRoom.";
      const items = getCompletions(testIndex, FILE, pos(0, 8), lineText);
      const labels = items.map((i) => i.label);
      expect(labels).toContain("description");
      expect(labels).toContain("before");
      expect(labels).toContain("super_secret");
      expect(labels).toContain("light");
    });

    it("marks properties as Field and attributes as EnumMember", () => {
      const lineText = "TheRoom.";
      const items = getCompletions(testIndex, FILE, pos(0, 8), lineText);
      expect(items.find((i) => i.label === "description")?.kind).toBe(CompletionItemKind.Field);
      expect(items.find((i) => i.label === "light")?.kind).toBe(CompletionItemKind.EnumMember);
    });

    it("returns empty list for unknown object", () => {
      const lineText = "Bogus.";
      const items = getCompletions(testIndex, FILE, pos(0, 6), lineText);
      expect(items).toEqual([]);
    });
  });
});

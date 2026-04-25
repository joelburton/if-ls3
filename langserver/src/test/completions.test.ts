import { describe, it, expect } from "vitest";
import { CompletionItemKind } from "vscode-languageserver";
import { getCompletions, isInHasClause, isAfterProvides } from "../features/completions";
import { FILE, testIndex } from "./fixture";

/** Position helper — vitest line numbers are 0-based. */
const pos = (line: number, character: number) => ({ line, character });

/** Single-line source stub — sufficient for tests that don't need has-clause context. */
const singleLine = (text: string) => [text];

describe("getCompletions", () => {
  describe("general completions (no dot)", () => {
    const items = getCompletions(testIndex, FILE, pos(0, 0), "", singleLine(""));

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
      const items = getCompletions(testIndex, FILE, pos(59, 0), "", singleLine(""));
      const labels = items.map((i) => i.label);
      expect(labels).toContain("a");
      expect(labels).toContain("b");
      expect(labels).toContain("x");
    });

    it("locals appear before other symbols", () => {
      const items = getCompletions(testIndex, FILE, pos(59, 0), "", singleLine(""));
      const firstNonLocal = items.findIndex(
        (i) => i.kind !== CompletionItemKind.Variable || !["a", "b", "x"].includes(i.label),
      );
      const lastLocal = items.reduce(
        (idx, item, i) => (["a", "b", "x"].includes(item.label) && item.kind === CompletionItemKind.Variable ? i : idx),
        -1,
      );
      expect(lastLocal).toBeLessThan(firstNonLocal);
    });

    it("does not include locals when cursor is outside the routine", () => {
      // Line 0 is outside MyFunc (which starts at line 58, i.e., index 57).
      const items = getCompletions(testIndex, FILE, pos(0, 0), "", singleLine(""));
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
      const items = getCompletions(testIndex, FILE, pos(0, 8), lineText, singleLine(lineText));
      const labels = items.map((i) => i.label);
      expect(labels).toContain("description");
      expect(labels).toContain("before");
      expect(labels).toContain("super_secret");
      expect(labels).toContain("light");
    });

    it("marks properties as Field and attributes as EnumMember", () => {
      const lineText = "TheRoom.";
      const items = getCompletions(testIndex, FILE, pos(0, 8), lineText, singleLine(lineText));
      expect(items.find((i) => i.label === "description")?.kind).toBe(CompletionItemKind.Field);
      expect(items.find((i) => i.label === "light")?.kind).toBe(CompletionItemKind.EnumMember);
    });

    it("returns empty list for unknown object", () => {
      const lineText = "Bogus.";
      const items = getCompletions(testIndex, FILE, pos(0, 6), lineText, singleLine(lineText));
      expect(items).toEqual([]);
    });

    it("resolves 'self.' to the enclosing object's properties", () => {
      // TheRoom spans lines 10-20 (1-based); pos(14, 5) is inside it (0-based line 14 = 1-based line 15).
      const lineText = "self.";
      const items = getCompletions(testIndex, FILE, pos(14, 5), lineText, singleLine(lineText));
      const labels = items.map((i) => i.label);
      expect(labels).toContain("description");
      expect(labels).toContain("before");
      expect(labels).toContain("light");
    });

    it("returns empty list for 'self.' when cursor is outside any object", () => {
      // Line 0 is outside all objects.
      const lineText = "self.";
      const items = getCompletions(testIndex, FILE, pos(0, 5), lineText, singleLine(lineText));
      expect(items).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // has clause completions
  // ---------------------------------------------------------------------------

  describe("has clause completions", () => {
    it("returns only attributes when cursor is on the same line as 'has'", () => {
      const lines = ["Object O", "  has "];
      const items = getCompletions(testIndex, FILE, pos(1, 6), "  has ", lines);
      const labels = items.map((i) => i.label);
      expect(labels).toContain("light");
      expect(labels).toContain("container");
      expect(labels).toContain("concealed");
      // Must NOT include routines, objects, keywords, etc.
      expect(labels).not.toContain("MyFunc");
      expect(labels).not.toContain("TheRoom");
      expect(labels).not.toContain("if");
    });

    it("returns only attributes when 'has' is on the preceding line", () => {
      const lines = ["Object O", "  has", "    "];
      const items = getCompletions(testIndex, FILE, pos(2, 4), "    ", lines);
      const labels = items.map((i) => i.label);
      expect(labels).toContain("light");
      expect(labels).toContain("concealed");
      expect(labels).not.toContain("MyFunc");
    });

    it("returns only attributes mid-clause with existing attributes on the line", () => {
      const lines = ["Object O", "  has light", "    "];
      const items = getCompletions(testIndex, FILE, pos(2, 4), "    ", lines);
      const labels = items.map((i) => i.label);
      expect(labels).toContain("concealed");
      expect(labels).not.toContain("MyFunc");
    });

    it("returns all items (not just attributes) when 'has' is in a comment", () => {
      const lines = ["Object O", "  with name 'o', ! has prop", "    "];
      const items = getCompletions(testIndex, FILE, pos(2, 4), "    ", lines);
      const labels = items.map((i) => i.label);
      expect(labels).toContain("MyFunc");
      expect(labels).toContain("TheRoom");
    });

    it("returns all items when 'has' is in a string literal", () => {
      const lines = ['Object O', '  with description "has light",', "  "];
      const items = getCompletions(testIndex, FILE, pos(2, 2), "  ", lines);
      const labels = items.map((i) => i.label);
      expect(labels).toContain("MyFunc");
    });

    it("returns all items after the semicolon that closes the has clause", () => {
      const lines = ["Object O", "  has light;", ""];
      const items = getCompletions(testIndex, FILE, pos(2, 0), "", lines);
      const labels = items.map((i) => i.label);
      expect(labels).toContain("MyFunc");
      expect(labels).toContain("Object");
    });

    it("returns all items inside a 'with' clause even when 'has' appears later in source", () => {
      // Cursor is in the 'with' block; 'has' comes after on next line — not yet scanned.
      const lines = ["Object O", "  with name 'o',", "    "];
      const items = getCompletions(testIndex, FILE, pos(2, 4), "    ", lines);
      const labels = items.map((i) => i.label);
      expect(labels).toContain("MyFunc");
    });

    it("all returned items have EnumMember kind", () => {
      const lines = ["Object O", "  has "];
      const items = getCompletions(testIndex, FILE, pos(1, 6), "  has ", lines);
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((i) => i.kind === CompletionItemKind.EnumMember)).toBe(true);
    });

    it("includes system attributes (e.g. 'light', 'container')", () => {
      const lines = ["Object O", "  has "];
      const items = getCompletions(testIndex, FILE, pos(1, 6), "  has ", lines);
      expect(items.find((i) => i.label === "light")).toBeDefined();
      expect(items.find((i) => i.label === "container")).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// provides completions
// ---------------------------------------------------------------------------

describe("provides completions", () => {
  it("returns only properties after 'provides'", () => {
    const line = "if (TheRoom provides ";
    const items = getCompletions(testIndex, FILE, pos(0, line.length), line, singleLine(line));
    const labels = items.map((i) => i.label);
    expect(labels).toContain("description");
    expect(labels).toContain("my_test");
    expect(labels).not.toContain("MyFunc");
    expect(labels).not.toContain("TheRoom");
    expect(labels).not.toContain("light");
    expect(labels).not.toContain("if");
  });

  it("works when a partial property name is already typed", () => {
    const line = "if (self provides des";
    const items = getCompletions(testIndex, FILE, pos(0, line.length), line, singleLine(line));
    const labels = items.map((i) => i.label);
    expect(labels).toContain("description");
    expect(labels).not.toContain("MyFunc");
  });

  it("returns Field kind for all items", () => {
    const line = "if (obj provides ";
    const items = getCompletions(testIndex, FILE, pos(0, line.length), line, singleLine(line));
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.kind === CompletionItemKind.Field)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isAfterProvides unit tests
// ---------------------------------------------------------------------------

describe("isAfterProvides", () => {
  it("true immediately after 'provides '", () => {
    expect(isAfterProvides("if (obj provides ", 17)).toBe(true);
  });

  it("true with a partial word already typed", () => {
    expect(isAfterProvides("if (obj provides des", 20)).toBe(true);
  });

  it("true with self as the object", () => {
    expect(isAfterProvides("if (self provides ", 18)).toBe(true);
  });

  it("false when 'provides' is not the preceding keyword", () => {
    expect(isAfterProvides("if (obj has ", 12)).toBe(false);
  });

  it("false when cursor is on the object before provides", () => {
    expect(isAfterProvides("if (obj ", 8)).toBe(false);
  });

  it("false when 'provides' appears only in a word (e.g. 'notprovides')", () => {
    expect(isAfterProvides("if (x notprovides ", 18)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isInHasClause unit tests
// ---------------------------------------------------------------------------

describe("isInHasClause", () => {
  it("true when cursor is after 'has' on the same line", () => {
    expect(isInHasClause(["  has "], 0, 6)).toBe(true);
  });

  it("true when 'has' is on a preceding line", () => {
    expect(isInHasClause(["  has", "    "], 1, 4)).toBe(true);
  });

  it("true with existing attributes on the has line", () => {
    expect(isInHasClause(["  has light", "    "], 1, 4)).toBe(true);
  });

  it("false when ';' follows 'has' before the cursor", () => {
    expect(isInHasClause(["  has light;", ""], 1, 0)).toBe(false);
  });

  it("false when 'with' appears after 'has' in the scan window", () => {
    // Cursor is in a 'with' block that follows 'has' — but scanning backwards
    // from cursor, 'with' is more recent than 'has'.
    expect(isInHasClause(["  has light,", "  with name 'o',", "    "], 2, 4)).toBe(false);
  });

  it("false when 'has' only appears in a comment", () => {
    expect(isInHasClause(["  with prop, ! has attr", "  "], 1, 2)).toBe(false);
  });

  it("false when 'has' only appears inside a string", () => {
    expect(isInHasClause(['  with desc "has light",', "  "], 1, 2)).toBe(false);
  });

  it("false when no 'has' is found within the scan window", () => {
    expect(isInHasClause(["Object O", "  "], 1, 2)).toBe(false);
  });

  it("true for the multi-line form with comment on the has line", () => {
    const lines = ["Object O", "  has light    ! lit up", "    "];
    expect(isInHasClause(lines, 2, 4)).toBe(true);
  });

  it("true after 'hasnt' keyword (e.g. if (x hasnt ^))", () => {
    expect(isInHasClause(["if (x hasnt "], 0, 12)).toBe(true);
  });
});

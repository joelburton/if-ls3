import { describe, it, expect } from "vitest";
import { CompletionItemKind } from "vscode-languageserver";
import { getCompletions, isInHasClause, isAfterProvides, isAfterOfclass, isAfterHashHash, isAfterClassKeyword, isAfterArrow, isAtTopLevel } from "../features/completions";
import { FILE, testIndex } from "./fixture";

/** Position helper — vitest line numbers are 0-based. */
const pos = (line: number, character: number) => ({ line, character });

/** Single-line source stub — sufficient for tests that don't need has-clause context. */
const singleLine = (text: string) => [text];

describe("getCompletions", () => {
  describe("general completions (no dot)", () => {
    // pos(11, 0) = 1-based line 12, inside TheRoom (10-20) but outside all routines → general completions.
    const items = getCompletions(testIndex, FILE, pos(11, 0), "", singleLine(""));

    it("includes non-embedded routines", () => {
      const labels = items.map((i) => i.label);
      expect(labels).toContain("MyFunc");
      expect(labels).toContain("FoozleSub");
    });

    it("excludes embedded routines", () => {
      const labels = items.map((i) => i.label);
      expect(labels).not.toContain("TheRoom.before");
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
      // pos(11, 0) = inside TheRoom but outside all routines — still general completions, no locals.
      const items = getCompletions(testIndex, FILE, pos(11, 0), "", singleLine(""));
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
      const items = getCompletions(testIndex, FILE, pos(11, 4), "    ", lines);
      const labels = items.map((i) => i.label);
      expect(labels).toContain("MyFunc");
      expect(labels).toContain("TheRoom");
    });

    it("returns all items when 'has' is in a string literal", () => {
      const lines = ['Object O', '  with description "has light",', "  "];
      const items = getCompletions(testIndex, FILE, pos(11, 2), "  ", lines);
      const labels = items.map((i) => i.label);
      expect(labels).toContain("MyFunc");
    });

    it("returns all items after the semicolon that closes the has clause", () => {
      const lines = ["Object O", "  has light;", ""];
      const items = getCompletions(testIndex, FILE, pos(11, 0), "", lines);
      const labels = items.map((i) => i.label);
      expect(labels).toContain("MyFunc");
      expect(labels).toContain("Object");
    });

    it("returns all items inside a 'with' clause even when 'has' appears later in source", () => {
      // Cursor is in the 'with' block; 'has' comes after on next line — not yet scanned.
      const lines = ["Object O", "  with name 'o',", "    "];
      const items = getCompletions(testIndex, FILE, pos(11, 4), "    ", lines);
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
// top-level completions
// ---------------------------------------------------------------------------

// testIndex: objects at lines 10-20 and 24-24; routines at 16-19, 58-66, 89-89.
// Line 5 (1-based) is outside all of them → top level.
// Line 30 (1-based) is also between objects/routines → top level.

describe("isAtTopLevel", () => {
  it("true when cursor is outside all routines and objects", () => {
    expect(isAtTopLevel(testIndex, FILE, 5)).toBe(true);
    expect(isAtTopLevel(testIndex, FILE, 30)).toBe(true);
  });

  it("false when cursor is inside a routine", () => {
    expect(isAtTopLevel(testIndex, FILE, 60)).toBe(false); // inside MyFunc (58-66)
  });

  it("false when cursor is inside an object body", () => {
    expect(isAtTopLevel(testIndex, FILE, 12)).toBe(false); // inside TheRoom (10-20)
  });

  it("true for a file path not in the index (treated as top level)", () => {
    expect(isAtTopLevel(testIndex, "/other/file.inf", 10)).toBe(true);
  });
});

describe("top-level completions", () => {
  // pos(4, 0) → 1-based line 5, which is outside all objects and routines.
  const items = getCompletions(testIndex, FILE, pos(4, 0), "", singleLine(""));
  const labels = items.map((i) => i.label);

  it("includes directives", () => {
    expect(labels).toContain("Object");
    expect(labels).toContain("Class");
    expect(labels).toContain("Global");
    expect(labels).toContain("Constant");
    expect(labels).toContain("Array");
    expect(labels).toContain("Verb");
    expect(labels).toContain("#Ifdef");
  });

  it("includes user-defined class names for pseudo-directives", () => {
    expect(labels).toContain("Room"); // is_class: true in testIndex
  });

  it("includes snippet items", () => {
    expect(labels).toContain("[ (routine)");
    expect(labels).toContain("Object (with body)");
    expect(labels).toContain("Class (with body)");
  });

  it("snippet items have insertText and InsertTextFormat.Snippet", () => {
    const { CompletionItemKind, InsertTextFormat } = require("vscode-languageserver");
    const snippet = items.find((i) => i.label === "[ (routine)");
    expect(snippet).toBeDefined();
    expect(snippet!.kind).toBe(CompletionItemKind.Snippet);
    expect(snippet!.insertTextFormat).toBe(InsertTextFormat.Snippet);
    expect(snippet!.insertText).toContain("${1:");
  });

  it("does NOT include statement keywords", () => {
    expect(labels).not.toContain("if");
    expect(labels).not.toContain("for");
    expect(labels).not.toContain("while");
    expect(labels).not.toContain("return");
  });

  it("does NOT include user routines, globals, or constants", () => {
    expect(labels).not.toContain("MyFunc");
    expect(labels).not.toContain("location");
    expect(labels).not.toContain("NOPE");
  });

  it("does NOT include non-class objects", () => {
    expect(labels).not.toContain("TheRoom"); // is_class: false
  });

  it("falls back to general completions mid-directive (content already on the line)", () => {
    // "Global " before cursor → lineBeforeCursor is not empty → general completions.
    const line = "Global ";
    const midItems = getCompletions(testIndex, FILE, pos(4, line.length), line, singleLine(line));
    const midLabels = midItems.map((i) => i.label);
    expect(midLabels).toContain("MyFunc");
    expect(midLabels).toContain("NOPE");
  });

  it("applies top-top filter when typing the first word at column 0", () => {
    const line = "Ob";
    const firstWordItems = getCompletions(testIndex, FILE, pos(4, line.length), line, singleLine(line));
    const firstLabels = firstWordItems.map((i) => i.label);
    expect(firstLabels).toContain("Object");
    expect(firstLabels).not.toContain("MyFunc");
  });

  it("does NOT apply top-top filter when first word is indented", () => {
    const line = "  with";
    const indentedItems = getCompletions(testIndex, FILE, pos(4, line.length), line, singleLine(line));
    const indentedLabels = indentedItems.map((i) => i.label);
    expect(indentedLabels).toContain("MyFunc"); // general completions
    expect(indentedLabels).toContain("with");   // keyword now in general list
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

  it("still returns properties after an 'or' chain", () => {
    const line = "if (o provides description or ";
    const items = getCompletions(testIndex, FILE, pos(0, line.length), line, singleLine(line));
    const labels = items.map((i) => i.label);
    expect(labels).toContain("description");
    expect(labels).not.toContain("MyFunc");
  });
});

// ---------------------------------------------------------------------------
// ofclass completions
// ---------------------------------------------------------------------------

describe("ofclass completions", () => {
  it("returns only class names after 'ofclass'", () => {
    const line = "if (x ofclass ";
    const items = getCompletions(testIndex, FILE, pos(0, line.length), line, singleLine(line));
    const labels = items.map((i) => i.label);
    expect(labels).toContain("Room");
    expect(labels).not.toContain("TheRoom"); // not a class
    expect(labels).not.toContain("MyFunc");
  });

  it("still returns class names after an 'or' chain", () => {
    const line = "if (x ofclass Room or ";
    const items = getCompletions(testIndex, FILE, pos(0, line.length), line, singleLine(line));
    const labels = items.map((i) => i.label);
    expect(labels).toContain("Room");
    expect(labels).not.toContain("MyFunc");
  });

  it("returns Class kind for all items", () => {
    const line = "if (x ofclass ";
    const items = getCompletions(testIndex, FILE, pos(0, line.length), line, singleLine(line));
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.kind === CompletionItemKind.Class)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ## action completions
// ---------------------------------------------------------------------------

describe("## action completions", () => {
  it("returns action names after ##", () => {
    const line = "if (action == ##";
    const items = getCompletions(testIndex, FILE, pos(0, line.length), line, singleLine(line));
    const labels = items.map((i) => i.label);
    expect(labels).toContain("Take");
    expect(labels).toContain("Foozle");
    expect(labels).not.toContain("Take__A"); // raw symbol name should not appear
    expect(labels).not.toContain("MyFunc");
  });

  it("works with partial action name typed", () => {
    const line = "if (action == ##Foo";
    const items = getCompletions(testIndex, FILE, pos(0, line.length), line, singleLine(line));
    const labels = items.map((i) => i.label);
    expect(labels).toContain("Foozle");
  });

  it("returns EnumMember kind for all items", () => {
    const line = "##";
    const items = getCompletions(testIndex, FILE, pos(0, line.length), line, singleLine(line));
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.kind === CompletionItemKind.EnumMember)).toBe(true);
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

  it("true after 'provides p1 or '", () => {
    expect(isAfterProvides("if (o provides p1 or ", 21)).toBe(true);
  });

  it("true after 'provides p1 or p2 or ' (two ors)", () => {
    expect(isAfterProvides("if (o provides p1 or p2 or ", 27)).toBe(true);
  });

  it("true mid-word after 'provides p1 or p2 or part'", () => {
    expect(isAfterProvides("if (o provides p1 or p2 or part", 31)).toBe(true);
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
// isAfterOfclass unit tests
// ---------------------------------------------------------------------------

describe("isAfterOfclass", () => {
  it("true immediately after 'ofclass '", () => {
    expect(isAfterOfclass("if (x ofclass ", 14)).toBe(true);
  });

  it("true with partial class name typed", () => {
    expect(isAfterOfclass("if (x ofclass Ro", 16)).toBe(true);
  });

  it("true after 'ofclass C1 or '", () => {
    expect(isAfterOfclass("if (x ofclass C1 or ", 20)).toBe(true);
  });

  it("true after 'ofclass C1 or C2 or '", () => {
    expect(isAfterOfclass("if (x ofclass C1 or C2 or ", 26)).toBe(true);
  });

  it("false for unrelated keyword", () => {
    expect(isAfterOfclass("if (x has ", 10)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isAfterClassKeyword unit tests
// ---------------------------------------------------------------------------

describe("isAfterClassKeyword", () => {
  it("true immediately after 'class '", () => {
    expect(isAfterClassKeyword("Object Foo class ", 17)).toBe(true);
  });

  it("true with partial class name typed", () => {
    expect(isAfterClassKeyword("Object Foo class Ro", 19)).toBe(true);
  });

  it("true after first class name (space-separated list)", () => {
    expect(isAfterClassKeyword("Object Foo class Room ", 22)).toBe(true);
  });

  it("true after two class names already typed", () => {
    expect(isAfterClassKeyword("Object Foo class Room Container ", 32)).toBe(true);
  });

  it("true when 'class' is the first word (Class definition)", () => {
    expect(isAfterClassKeyword("class Room ", 11)).toBe(true);
  });

  it("false when keyword is not 'class'", () => {
    expect(isAfterClassKeyword("Object Foo with ", 16)).toBe(false);
  });

  it("false when nothing precedes partial word", () => {
    expect(isAfterClassKeyword("Room", 4)).toBe(false);
  });
});

describe("class keyword completions", () => {
  it("returns only class names after 'class'", () => {
    const line = "Object Foo class ";
    const items = getCompletions(testIndex, FILE, pos(0, line.length), line, singleLine(line));
    const labels = items.map((i) => i.label);
    expect(labels).toContain("Room");
    expect(labels).not.toContain("TheRoom");
    expect(labels).not.toContain("MyFunc");
  });

  it("still returns class names after first class name", () => {
    const line = "Object Foo class Room ";
    const items = getCompletions(testIndex, FILE, pos(0, line.length), line, singleLine(line));
    const labels = items.map((i) => i.label);
    expect(labels).toContain("Room");
    expect(labels).not.toContain("MyFunc");
  });

  it("returns Class kind for all items", () => {
    const line = "Object Foo class ";
    const items = getCompletions(testIndex, FILE, pos(0, line.length), line, singleLine(line));
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.kind === CompletionItemKind.Class)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isAfterArrow + -> completions
// ---------------------------------------------------------------------------

describe("isAfterArrow", () => {
  it("true after '-> '", () => {
    expect(isAfterArrow("* noun -> ", 10)).toBe(true);
  });

  it("true with partial action name typed", () => {
    expect(isAfterArrow("* noun -> Foo", 13)).toBe(true);
  });

  it("true for obj->prop context", () => {
    expect(isAfterArrow("x->", 3)).toBe(true);
  });

  it("false when not after ->", () => {
    expect(isAfterArrow("* noun ", 7)).toBe(false);
  });
});

describe("-> completions", () => {
  it("prepends action names before the general list", () => {
    const line = "* noun -> ";
    const items = getCompletions(testIndex, FILE, pos(11, line.length), line, singleLine(line));
    const labels = items.map((i) => i.label);
    // Action names present
    expect(labels).toContain("Take");
    expect(labels).toContain("Foozle");
    // General list also present (not restricted to actions only)
    expect(labels).toContain("MyFunc");
    expect(labels).toContain("location");
  });

  it("action names appear before general symbols", () => {
    const line = "* noun -> ";
    const items = getCompletions(testIndex, FILE, pos(11, line.length), line, singleLine(line));
    const firstAction = items.findIndex((i) => i.label === "Take" || i.label === "Foozle");
    const firstRoutine = items.findIndex((i) => i.label === "MyFunc");
    expect(firstAction).toBeGreaterThanOrEqual(0);
    expect(firstAction).toBeLessThan(firstRoutine);
  });
});

// ---------------------------------------------------------------------------
// isAfterHashHash unit tests
// ---------------------------------------------------------------------------

describe("isAfterHashHash", () => {
  it("true immediately after ##", () => {
    expect(isAfterHashHash("##", 2)).toBe(true);
  });

  it("true with partial action name typed", () => {
    expect(isAfterHashHash("##Foo", 5)).toBe(true);
  });

  it("true in expression context", () => {
    expect(isAfterHashHash("if (action == ##", 16)).toBe(true);
  });

  it("false with only one #", () => {
    expect(isAfterHashHash("#Foo", 4)).toBe(false);
  });

  it("false for unrelated content", () => {
    expect(isAfterHashHash("if (x == ", 9)).toBe(false);
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

import { describe, it, expect } from "vitest";
import {
  isInComment,
  isInString,
  wordAtPosition,
  objectBeforeDot,
  classBeforeColonColon,
} from "../features/wordAtPosition";

// ── isInComment ──────────────────────────────────────────────────────────────

describe("isInComment", () => {
  it("returns false on empty line", () => {
    expect(isInComment("", 0)).toBe(false);
  });

  it("returns false when cursor is before the ! on the same line", () => {
    expect(isInComment("print x; ! comment", 5)).toBe(false);
  });

  it("returns true when cursor is at the ! itself", () => {
    expect(isInComment("print x; ! comment", 9)).toBe(true);
  });

  it("returns true when cursor is inside the comment text", () => {
    expect(isInComment("print x; ! comment", 15)).toBe(true);
  });

  it("returns true for a pure-comment line (!! doc)", () => {
    const line = "!! This is doc";
    expect(isInComment(line, 0)).toBe(true);
    expect(isInComment(line, 5)).toBe(true);
  });

  it("does NOT treat ! inside a double-quoted string as a comment", () => {
    //         0123456789012345
    const line = `print "hello!";`;
    // The ! is at index 13, inside a string — cursor at 13 should not be in comment.
    expect(isInComment(line, 13)).toBe(false);
    // Cursor after the closing quote and semicolon — still no comment.
    expect(isInComment(line, 14)).toBe(false);
  });

  it("treats ! after the closing quote as a comment", () => {
    //         01234567890123456789
    const line = `print "hello!"; ! ok`;
    // ! at index 16 opens a comment.
    expect(isInComment(line, 16)).toBe(true);
    expect(isInComment(line, 19)).toBe(true);
  });

  it("handles a string with no closing quote (unterminated) gracefully", () => {
    const line = `x = "unterminated`;
    // No ! at all — never a comment.
    expect(isInComment(line, 5)).toBe(false);
  });

  it("returns false for a line with no ! at all", () => {
    expect(isInComment("x = 42;", 3)).toBe(false);
  });
});

// ── isInString ───────────────────────────────────────────────────────────────

describe("isInString", () => {
  const pos = (line: number, character: number) => ({ line, character });

  it("returns false on a line with no strings", () => {
    expect(isInString("x = 42;", pos(0, 4))).toBe(false);
  });

  it("returns true when cursor is inside a single-line string", () => {
    //              0123456789012345678
    const src = `print "hello world";`;
    expect(isInString(src, pos(0, 10))).toBe(true);
  });

  it("returns false before the opening quote", () => {
    const src = `print "hello world";`;
    expect(isInString(src, pos(0, 5))).toBe(false);
  });

  it("returns false after the closing quote", () => {
    const src = `print "hello world";`;
    expect(isInString(src, pos(0, 19))).toBe(false);
  });

  it("returns false between two strings on the same line", () => {
    //              0         1         2
    //              0123456789012345678901234
    const src = `x = "foo" + "bar";`;
    // cursor at 11 (the '+'), between the two strings
    expect(isInString(src, pos(0, 11))).toBe(false);
  });

  it("returns true inside the second of two strings on the same line", () => {
    const src = `x = "foo" + "bar";`;
    // cursor at 14 (inside "bar")
    expect(isInString(src, pos(0, 14))).toBe(true);
  });

  it("returns true inside a multi-line string (cursor on continuation line)", () => {
    const src = `description "The long\n    description continues",`;
    // cursor on line 1 col 5 — inside the string
    expect(isInString(src, pos(1, 5))).toBe(true);
  });

  it("returns false on a code line after a multi-line string has closed", () => {
    const src = `description "The long\n    description",\n    before [;`;
    // cursor on line 2 (the 'before' line) — string is already closed
    expect(isInString(src, pos(2, 5))).toBe(false);
  });

  it("does not treat ! inside a string as a comment (string stays open)", () => {
    const src = `print "He said !wow";\nx = 1;`;
    // cursor on line 1 — the string on line 0 closed properly
    expect(isInString(src, pos(1, 2))).toBe(false);
  });

  it("treats ! outside a string as a comment (stops scanning the line)", () => {
    // Line: `x = 1; ! "not a string`  — the " after ! should not open a string
    const src = `x = 1; ! "not a string\nnext line`;
    expect(isInString(src, pos(1, 2))).toBe(false);
  });

  it("returns false at column 0 with no preceding content", () => {
    expect(isInString(`"hello"`, pos(0, 0))).toBe(false);
  });

  // ── Regression coverage for upcoming perf rewrite ──────────────────────────

  it("does not treat a '...' dictionary word as a string", () => {
    // Inform 6 single-quoted tokens are dictionary words, not string literals.
    // isInString must only track double quotes.
    const src = `Verb 'take' * noun -> Take;`;
    // Cursor inside 'take' — should NOT report inString.
    expect(isInString(src, pos(0, 7))).toBe(false);
  });

  it('ignores " inside a single-line ! comment when scanning later lines', () => {
    // The " inside the comment on line 0 must not leak open-string state to line 1.
    const src = `! He said "hi" earlier.\nx = 1;`;
    expect(isInString(src, pos(1, 4))).toBe(false);
  });

  it("returns true on a continuation line of a string spanning many lines", () => {
    // 50-line multi-line string; cursor on line 25.
    const middle = "more text\n".repeat(50);
    const src = `description "${middle}";`;
    expect(isInString(src, pos(25, 4))).toBe(true);
  });

  it("returns false on a line far below a closed multi-line string", () => {
    const middle = "more text\n".repeat(50);
    const src = `description "${middle}";\n${"x = 1;\n".repeat(20)}y = 2;`;
    // Cursor on the very last line — string closed long ago.
    const lines = src.split("\n");
    expect(isInString(src, pos(lines.length - 1, 2))).toBe(false);
  });

  it("returns true inside an unterminated string at end of file", () => {
    const src = `x = 1;\nmsg = "still open`;
    expect(isInString(src, pos(1, 10))).toBe(true);
  });
});

// ── wordAtPosition ───────────────────────────────────────────────────────────

describe("wordAtPosition", () => {
  const src = "[ MyFunc x;\n    x = 42;\n];";

  it("extracts the word when cursor is at its start", () => {
    const r = wordAtPosition(src, { line: 0, character: 2 });
    expect(r?.word).toBe("MyFunc");
    expect(r?.start).toBe(2);
    expect(r?.end).toBe(8);
  });

  it("extracts the same word when cursor is in the middle", () => {
    const r = wordAtPosition(src, { line: 0, character: 4 });
    expect(r?.word).toBe("MyFunc");
  });

  it("extracts the same word when cursor is at the last character", () => {
    const r = wordAtPosition(src, { line: 0, character: 7 });
    expect(r?.word).toBe("MyFunc");
  });

  it("returns null when cursor is on whitespace", () => {
    expect(wordAtPosition(src, { line: 0, character: 1 })).toBeNull();
  });

  it("returns null when cursor is on a non-identifier character", () => {
    // character 8 is the '[' in '[ MyFunc'... wait let me recalculate.
    // line 0 is "[ MyFunc x;"
    // index:   0123456789
    // '[' = 0, ' ' = 1, 'M' = 2 .. 'c' = 7, ' ' = 8
    expect(wordAtPosition(src, { line: 0, character: 8 })).toBeNull(); // space
  });

  it("works on lines other than the first", () => {
    // line 1 is "    x = 42;"
    const r = wordAtPosition(src, { line: 1, character: 4 });
    expect(r?.word).toBe("x");
  });

  it("returns the lineText for context", () => {
    const r = wordAtPosition(src, { line: 0, character: 2 });
    expect(r?.lineText).toBe("[ MyFunc x;");
  });

  it("returns null for an out-of-bounds line", () => {
    expect(wordAtPosition(src, { line: 99, character: 0 })).toBeNull();
  });

  it("handles single-character identifiers", () => {
    const r = wordAtPosition("x = 1;", { line: 0, character: 0 });
    expect(r?.word).toBe("x");
  });

  it("handles identifiers that start with underscore", () => {
    const r = wordAtPosition("_priv = 1;", { line: 0, character: 2 });
    expect(r?.word).toBe("_priv");
  });
});

// ── objectBeforeDot ──────────────────────────────────────────────────────────

describe("objectBeforeDot", () => {
  it("returns the object name for ObjName.prop", () => {
    //        0123456789012345678
    const line = "TheRoom.description";
    expect(objectBeforeDot(line, 8)).toBe("TheRoom");
  });

  it("returns null when the preceding character is not a dot", () => {
    expect(objectBeforeDot("TheRoom description", 8)).toBeNull();
  });

  it("returns null when cursor is at position 0", () => {
    expect(objectBeforeDot(".foo", 0)).toBeNull();
  });

  it("returns null when there is a dot but no identifier before it", () => {
    // The dot is at position 0 — dotPos would be 0, which the guard catches.
    expect(objectBeforeDot(".description", 1)).toBeNull();
  });

  it("handles the object name being a single character", () => {
    expect(objectBeforeDot("x.prop", 2)).toBe("x");
  });

  it("ignores dots further left on the line", () => {
    // "a.b.c" — wordStart=4 (the 'c'), dot at 3, object is 'b'
    expect(objectBeforeDot("a.b.c", 4)).toBe("b");
  });
});

// ── classBeforeColonColon ─────────────────────────────────────────────────────

describe("classBeforeColonColon", () => {
  it("returns the class name for ClassName::prop", () => {
    //        0123456789012345
    const line = "Room::room_func";
    expect(classBeforeColonColon(line, 6)).toBe("Room");
  });

  it("returns the class name when preceded by obj.Class:: (self.Room::room_func)", () => {
    //        01234567890123456789012
    const line = "self.Room::room_func()";
    // s(0)e(1)l(2)f(3).(4)R(5)o(6)o(7)m(8):(9):(10)r(11) — 'r' of room_func is at index 11
    expect(classBeforeColonColon(line, 11)).toBe("Room");
  });

  it("returns null when preceded by a dot, not ::", () => {
    expect(classBeforeColonColon("TheRoom.description", 8)).toBeNull();
  });

  it("returns null when preceded by only one colon", () => {
    expect(classBeforeColonColon("Room:room_func", 5)).toBeNull();
  });

  it("returns null when wordStart is 0", () => {
    expect(classBeforeColonColon("room_func", 0)).toBeNull();
  });

  it("returns null when wordStart is 1 (not enough room for ::)", () => {
    expect(classBeforeColonColon(":room_func", 1)).toBeNull();
  });

  it("returns null when :: is at position 0 with no class name before it", () => {
    // "::room_func" — :: at 0, nothing before it
    expect(classBeforeColonColon("::room_func", 2)).toBeNull();
  });

  it("handles a single-character class name", () => {
    expect(classBeforeColonColon("R::prop", 3)).toBe("R");
  });

  it("returns null when there is no :: before the word", () => {
    expect(classBeforeColonColon("room_func", 5)).toBeNull();
  });
});

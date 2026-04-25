import { describe, it, expect } from "vitest";
import { isInComment, wordAtPosition, objectBeforeDot, classBeforeColonColon } from "../features/wordAtPosition";

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

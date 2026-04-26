import { describe, it, expect, vi } from "vitest";

// Minimal vscode mock — only the types used by findEnclosingString and
// wrapString.  wrapParagraph() itself touches vscode.window.activeTextEditor
// and is not unit-tested here.
vi.mock("vscode", () => {
  class Position {
    constructor(
      public line: number,
      public character: number,
    ) {}
  }
  class Range {
    constructor(
      public start: Position,
      public end: Position,
    ) {}
  }
  const EndOfLine = { LF: 1, CRLF: 2 } as const;
  return { Position, Range, EndOfLine };
});

import { findEnclosingString, wrapString } from "../../client/wrapParagraph";

// vscode.Position from the mock above. Importing it gives us the same
// constructor the production code is using under the mock.
import { Position, EndOfLine } from "vscode";

interface MockLine {
  text: string;
}

interface MockDoc {
  lineAt: (line: number) => MockLine;
  lineCount: number;
  eol: number;
}

function makeDoc(source: string, eol: number = EndOfLine.LF): MockDoc {
  const lines = source.split("\n");
  return {
    lineAt: (line: number) => ({ text: lines[line] ?? "" }),
    lineCount: lines.length,
    eol,
  };
}

function pos(line: number, character: number): Position {
  return new Position(line, character);
}

describe("findEnclosingString", () => {
  it("returns null when cursor is not inside any string", () => {
    const doc = makeDoc(`Constant FOO = 1;`);
    expect(findEnclosingString(doc as never, pos(0, 5))).toBeNull();
  });

  it("returns open/close for a single-line string", () => {
    //                       0    5    10   15
    const doc = makeDoc(`say "Hello world";`);
    const result = findEnclosingString(doc as never, pos(0, 7))!;
    expect(result).not.toBeNull();
    expect(result.open.line).toBe(0);
    expect(result.open.character).toBe(4); // first "
    expect(result.close.line).toBe(0);
    expect(result.close.character).toBe(16); // closing "
  });

  it("returns null when cursor is in a line-ending comment", () => {
    const doc = makeDoc(`say "hi"; ! "not a string"`);
    // cursor at column 14 — inside the commented-out quoted text
    expect(findEnclosingString(doc as never, pos(0, 14))).toBeNull();
  });

  it("treats ! as a literal character inside a string", () => {
    // The "!" inside the string must NOT terminate the string.
    const doc = makeDoc(`"Hello! World" rest;`);
    const result = findEnclosingString(doc as never, pos(0, 5))!;
    expect(result).not.toBeNull();
    expect(result.open.character).toBe(0);
    expect(result.close.character).toBe(13);
  });

  it("handles multi-line strings", () => {
    const doc = makeDoc([`"This is a`, `multi-line`, `string here"`].join("\n"));
    const result = findEnclosingString(doc as never, pos(1, 3))!;
    expect(result).not.toBeNull();
    expect(result.open.line).toBe(0);
    expect(result.open.character).toBe(0);
    expect(result.close.line).toBe(2);
    expect(result.close.character).toBe(11);
  });

  it("returns null when cursor is between two strings (outside both)", () => {
    const doc = makeDoc(`"first" then "second";`);
    // cursor at column 9 — between the two strings
    expect(findEnclosingString(doc as never, pos(0, 9))).toBeNull();
  });

  it("identifies the second string when cursor is inside it", () => {
    const doc = makeDoc(`"first" then "second";`);
    const result = findEnclosingString(doc as never, pos(0, 16))!;
    expect(result).not.toBeNull();
    expect(result.open.character).toBe(13);
    expect(result.close.character).toBe(20);
  });

  it("returns null when there is no closing quote", () => {
    const doc = makeDoc(`say "no end here`);
    expect(findEnclosingString(doc as never, pos(0, 8))).toBeNull();
  });
});

describe("wrapString", () => {
  it("leaves a short single-line string unchanged in shape", () => {
    const doc = makeDoc(`    "hello world",`);
    // open at col 4 ("); close at col 16 (closing "); suffix "," at col 17
    const out = wrapString(doc as never, pos(0, 4), pos(0, 16), 80);
    expect(out).toBe(`"hello world",`);
  });

  it("wraps a long single-line string at the column limit", () => {
    const text = "one two three four five six seven eight nine ten";
    const doc = makeDoc(`    "${text}",`);
    // close is the position of the closing quote
    const closeCol = 5 + text.length;
    const out = wrapString(doc as never, pos(0, 4), pos(0, closeCol), 30);
    const lines = out.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    // First line still starts with the opening quote
    expect(lines[0].startsWith(`"`)).toBe(true);
    // Last line still ends with closing quote + suffix
    expect(lines[lines.length - 1].endsWith(`",`)).toBe(true);
    // No produced line should exceed `columns`, accounting for the open
    // column on the very first line.
    expect(lines[0].length + 4).toBeLessThanOrEqual(30);
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].length).toBeLessThanOrEqual(30);
    }
  });

  it("preserves indentation of continuation lines", () => {
    const text = "alpha beta gamma delta epsilon zeta eta theta";
    const doc = makeDoc(`        "${text}";`);
    const closeCol = 9 + text.length;
    const out = wrapString(doc as never, pos(0, 8), pos(0, closeCol), 40);
    const lines = out.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    // Continuation lines are indented by 8 spaces (matching the line that
    // contains the opening quote).
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].startsWith("        ")).toBe(true);
    }
  });

  it("preserves blank-line paragraph breaks", () => {
    const source = [`    "First paragraph.`, ``, `    Second paragraph.";`].join("\n");
    const doc = makeDoc(source);
    const closeCol = 21; // position of " on line 2
    const out = wrapString(doc as never, pos(0, 4), pos(2, closeCol), 80);
    // Expect: opening quote line, blank line, closing line.
    expect(out).toContain("\n\n");
  });

  it("starts a new line when a content line begins with ^", () => {
    // The ^-as-group-break rule only fires when ^ starts a content line in
    // the source. (Mid-word ^ stays inline.)
    const source = [`    "First paragraph.`, `^Second paragraph."`].join("\n");
    const doc = makeDoc(source);
    // closing " is at col 18 on line 1 (chars 0..17 are "^Second paragraph.")
    const out = wrapString(doc as never, pos(0, 4), pos(1, 18), 80);
    const lines = out.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.some((l) => l.trim().startsWith("^Second"))).toBe(true);
  });

  it("uses CRLF when the document is CRLF", () => {
    const text = "one two three four five six seven eight";
    const doc = makeDoc(`    "${text}";`, EndOfLine.CRLF);
    const closeCol = 5 + text.length;
    const out = wrapString(doc as never, pos(0, 4), pos(0, closeCol), 25);
    expect(out).toContain("\r\n");
    expect(out).not.toMatch(/(?<!\r)\n/);
  });

  it("uses LF when the document is LF", () => {
    const text = "one two three four five six seven eight";
    const doc = makeDoc(`    "${text}";`, EndOfLine.LF);
    const closeCol = 5 + text.length;
    const out = wrapString(doc as never, pos(0, 4), pos(0, closeCol), 25);
    expect(out).toContain("\n");
    expect(out).not.toContain("\r\n");
  });

  it("preserves the trailing punctuation suffix after the closing quote", () => {
    const doc = makeDoc(`    "hello world";`);
    // closing " at col 16; ";" suffix is what follows
    const out = wrapString(doc as never, pos(0, 4), pos(0, 16), 80);
    expect(out.endsWith(`";`)).toBe(true);
  });

  it("collapses multi-space gaps inside a paragraph", () => {
    // Multiple spaces between words should collapse to single spaces
    // because words are split on /\s+/ then rejoined with single spaces.
    const doc = makeDoc(`    "one    two   three";`);
    const out = wrapString(doc as never, pos(0, 4), pos(0, 23), 80);
    expect(out).toBe(`"one two three";`);
  });

  it("preserves a leading space inside the string when present", () => {
    // wrapString captures the leading-space prefix of the first content
    // line and re-emits it after the opening quote.
    const doc = makeDoc(`    " leading space here";`);
    const out = wrapString(doc as never, pos(0, 4), pos(0, 24), 80);
    expect(out.startsWith(`" leading`)).toBe(true);
  });
});

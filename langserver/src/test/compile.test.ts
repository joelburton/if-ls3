import { describe, it, expect, vi } from "vitest";

// Minimal vscode mock — only the types used by parseDiagnostics.
vi.mock("vscode", () => {
  class Range {
    constructor(
      public startLine: number,
      public startChar: number,
      public endLine: number,
      public endChar: number,
    ) {}
  }
  class Diagnostic {
    source = "";
    constructor(
      public range: Range,
      public message: string,
      public severity: number,
    ) {}
  }
  const Uri = {
    file: (f: string) => ({ fsPath: f, toString: () => `file://${f}` }),
  };
  const DiagnosticSeverity = { Error: 0, Warning: 1 };
  return { Range, Diagnostic, Uri, DiagnosticSeverity };
});

import { parseDiagnostics } from "../../client/compile";

const FILE = "/project/game.inf";
const LIB = "/project/lib.h";

describe("parseDiagnostics", () => {
  it("returns empty map and null first for clean output", () => {
    const { byFile, first } = parseDiagnostics("");
    expect(byFile.size).toBe(0);
    expect(first).toBeNull();
  });

  it("parses a single warning", () => {
    const stderr = `${FILE}(10): Warning:  Routine "Foo" declared but not used\n`;
    const { byFile, first } = parseDiagnostics(stderr);
    expect(byFile.size).toBe(1);
    const diags = byFile.get(FILE)!;
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe('Routine "Foo" declared but not used');
    expect(diags[0].severity).toBe(1); // Warning
    expect((diags[0].range as any).startLine).toBe(9); // 0-based
    expect(first?.uri.fsPath).toBe(FILE);
    expect((first?.range as any).startLine).toBe(9);
  });

  it("parses a single error", () => {
    const stderr = `${FILE}(23): Error:  Expected ';' but found foo\n`;
    const { byFile } = parseDiagnostics(stderr);
    const diags = byFile.get(FILE)!;
    expect(diags[0].severity).toBe(0); // Error
    expect(diags[0].message).toBe("Expected ';' but found foo");
  });

  it("groups multiple diagnostics by file", () => {
    const stderr = [
      `${FILE}(5): Warning:  Bare property name found`,
      `${LIB}(12): Error:  Unknown identifier`,
      `${FILE}(20): Warning:  Unused variable`,
    ].join("\n");
    const { byFile } = parseDiagnostics(stderr);
    expect(byFile.get(FILE)).toHaveLength(2);
    expect(byFile.get(LIB)).toHaveLength(1);
  });

  it("first points to the earliest diagnostic in output order", () => {
    const stderr = [`${LIB}(12): Warning:  something in lib`, `${FILE}(5): Error:  error in game`].join("\n");
    const { first } = parseDiagnostics(stderr);
    // LIB warning came first in output
    expect(first?.uri.fsPath).toBe(LIB);
    expect((first?.range as any).startLine).toBe(11); // 0-based
  });

  it("skips source-echo lines starting with >", () => {
    const stderr = [`${FILE}(10): Error:  Bad syntax`, `>   bad line here`].join("\n");
    const { byFile } = parseDiagnostics(stderr);
    expect(byFile.get(FILE)).toHaveLength(1);
  });

  it("ignores fatal error lines (no file/line prefix)", () => {
    const stderr = `Fatal error: Couldn't open source file "missing.inf"\n`;
    const { byFile, first } = parseDiagnostics(stderr);
    expect(byFile.size).toBe(0);
    expect(first).toBeNull();
  });

  it("sets diag.source to inform6-compile", () => {
    const stderr = `${FILE}(1): Warning:  test\n`;
    const { byFile } = parseDiagnostics(stderr);
    expect(byFile.get(FILE)![0].source).toBe("inform6-compile");
  });
});

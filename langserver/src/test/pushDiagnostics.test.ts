import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DiagnosticSeverity } from "vscode-languageserver";
import type { Connection, Diagnostic, PublishDiagnosticsParams } from "vscode-languageserver";
import { URI } from "vscode-uri";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pushDiagnostics, type Compilation } from "../features/diagnostics";
import type { CompilerIndex } from "../server/types";
import type { FileConfig } from "../workspace/config";

// ── fixtures ────────────────────────────────────────────────────────────────

let tmpDir: string;
let counter = 0;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "inform6-diag-test-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(name: string, content: string): string {
  const file = path.join(tmpDir, `${counter++}-${name}`);
  fs.writeFileSync(file, content);
  return file;
}

interface PushedRecord {
  uri: string;
  diagnostics: Diagnostic[];
}

interface FakeConnection {
  conn: Connection;
  pushed: PushedRecord[];
}

function fakeConnection(): FakeConnection {
  const pushed: PushedRecord[] = [];
  const conn = {
    sendDiagnostics: (params: PublishDiagnosticsParams) =>
      pushed.push({ uri: params.uri, diagnostics: params.diagnostics }),
    console: {
      warn: () => undefined,
      log: () => undefined,
      info: () => undefined,
      error: () => undefined,
    },
  } as unknown as Connection;
  return { conn, pushed };
}

function makeFileConfig(overrides: Partial<FileConfig> = {}): FileConfig {
  return {
    mainFile: "/project/game.inf",
    compiler: "/usr/local/bin/inform6",
    libraryPath: "",
    switches: "",
    defines: [],
    externalDefines: [],
    warnUndeclaredProperties: false,
    ...overrides,
  };
}

function emptyIndex(files: string[] = []): CompilerIndex {
  return {
    version: 1,
    files,
    symbols: [],
    routines: [],
    objects: [],
    globals: [],
    constants: [],
    arrays: [],
    verbs: [],
    dictionary: [],
    errors: [],
  };
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("pushDiagnostics", () => {
  let fc: FakeConnection;
  beforeEach(() => {
    fc = fakeConnection();
  });

  it("pushes compiler errors converted to LSP diagnostics", () => {
    const file = writeFile("a.inf", "Constant FOO = 1;\n");
    const index = emptyIndex([file]);
    index.errors.push({ file, line: 1, severity: "error", message: 'No such constant as "BAR"' });
    const compilations: Compilation[] = [{ fileConfig: makeFileConfig({ mainFile: file }), index }];

    pushDiagnostics(fc.conn, compilations, new Set());

    expect(fc.pushed).toHaveLength(1);
    expect(fc.pushed[0].uri).toBe(URI.file(file).toString());
    expect(fc.pushed[0].diagnostics).toHaveLength(1);
    expect(fc.pushed[0].diagnostics[0].severity).toBe(DiagnosticSeverity.Error);
    expect(fc.pushed[0].diagnostics[0].message).toContain("BAR");
  });

  it("clears diagnostics for files that had them last run but are clean now", () => {
    const file = writeFile("clean.inf", "Constant FOO = 1;\n");
    const compilations: Compilation[] = [{ fileConfig: makeFileConfig({ mainFile: file }), index: emptyIndex([file]) }];

    const previous = new Set([URI.file(file).toString(), "file:///stale/somewhere.inf"]);
    const current = pushDiagnostics(fc.conn, compilations, previous);

    // Both previously-affected URIs should have received an empty diagnostics array.
    const cleared = fc.pushed.filter((p) => p.diagnostics.length === 0);
    const clearedUris = new Set(cleared.map((p) => p.uri));
    expect(clearedUris).toContain(URI.file(file).toString());
    expect(clearedUris).toContain("file:///stale/somewhere.inf");
    expect(current.size).toBe(0); // nothing has diagnostics this run
  });

  it("does not push empty diagnostics for files not previously affected", () => {
    const file = writeFile("clean2.inf", "Constant FOO = 1;\n");
    const compilations: Compilation[] = [{ fileConfig: makeFileConfig({ mainFile: file }), index: emptyIndex([file]) }];

    pushDiagnostics(fc.conn, compilations, new Set());

    // No errors and no previous URIs → no sendDiagnostics calls at all.
    expect(fc.pushed).toEqual([]);
  });

  it("warns about #IfDef of an unknown name in a project file", () => {
    const file = writeFile("ifdef.inf", "#IfDef MYSTERY;\n#EndIf;\n");
    const compilations: Compilation[] = [{ fileConfig: makeFileConfig({ mainFile: file }), index: emptyIndex([file]) }];

    pushDiagnostics(fc.conn, compilations, new Set());

    expect(fc.pushed).toHaveLength(1);
    expect(fc.pushed[0].uri).toBe(URI.file(file).toString());
    expect(fc.pushed[0].diagnostics[0].message).toContain("MYSTERY");
    expect(fc.pushed[0].diagnostics[0].severity).toBe(DiagnosticSeverity.Warning);
  });

  it("skips #IfDef warnings for files under a configured libraryPath", () => {
    const libDir = path.join(tmpDir, `lib-${counter++}`);
    fs.mkdirSync(libDir);
    const libFile = path.join(libDir, "libfile.h");
    fs.writeFileSync(libFile, "#IfDef SOMETHING_INTERNAL;\n#EndIf;\n");

    const projectFile = writeFile("project.inf", "Constant FOO = 1;\n");
    const index = emptyIndex([projectFile, libFile]);
    const compilations: Compilation[] = [
      { fileConfig: makeFileConfig({ mainFile: projectFile, libraryPath: libDir }), index },
    ];

    pushDiagnostics(fc.conn, compilations, new Set());

    // No diagnostics pushed at all (project file is clean; libfile is skipped).
    expect(fc.pushed).toEqual([]);
  });

  it("does not warn about a name known via externalDefines in any compilation", () => {
    const fileA = writeFile("a.inf", "#IfDef PROJECT_A_FLAG;\n#EndIf;\n");
    const fileB = writeFile("b.inf", "Constant FOO = 1;\n");
    // Compilation A doesn't declare PROJECT_A_FLAG anywhere; compilation B has
    // it in externalDefines.  The union should treat it as known.
    const compilations: Compilation[] = [
      { fileConfig: makeFileConfig({ mainFile: fileA }), index: emptyIndex([fileA]) },
      {
        fileConfig: makeFileConfig({ mainFile: fileB, externalDefines: ["PROJECT_A_FLAG"] }),
        index: emptyIndex([fileB]),
      },
    ];

    pushDiagnostics(fc.conn, compilations, new Set());

    expect(fc.pushed).toEqual([]);
  });

  it("merges errors and #IfDef warnings on the same file into one push", () => {
    const file = writeFile("mix.inf", "Constant FOO = 1;\n#IfDef WHO;\n#EndIf;\n");
    const index = emptyIndex([file]);
    index.errors.push({ file, line: 1, severity: "warning", message: "some warning" });
    const compilations: Compilation[] = [{ fileConfig: makeFileConfig({ mainFile: file }), index }];

    pushDiagnostics(fc.conn, compilations, new Set());

    const forFile = fc.pushed.find((p) => p.uri === URI.file(file).toString());
    expect(forFile).toBeDefined();
    expect(forFile!.diagnostics).toHaveLength(2);
    const messages = forFile!.diagnostics.map((d) => d.message);
    expect(messages).toContain("some warning");
    expect(messages.some((m) => m.includes("WHO"))).toBe(true);
  });

  it("reports the new diagnostic URIs in its return value (used as next previousUris)", () => {
    const file = writeFile("ret.inf", "Constant FOO = 1;\n");
    const index = emptyIndex([file]);
    index.errors.push({ file, line: 1, severity: "error", message: "boom" });
    const compilations: Compilation[] = [{ fileConfig: makeFileConfig({ mainFile: file }), index }];

    const current = pushDiagnostics(fc.conn, compilations, new Set());

    expect(current).toEqual(new Set([URI.file(file).toString()]));
  });

  it("scans a shared file only once across multiple compilations", () => {
    const shared = writeFile("shared.h", "#IfDef DUPE_WARN;\n#EndIf;\n");
    const compilations: Compilation[] = [
      { fileConfig: makeFileConfig({ mainFile: "/p1/a.inf" }), index: emptyIndex([shared]) },
      { fileConfig: makeFileConfig({ mainFile: "/p2/b.inf" }), index: emptyIndex([shared]) },
    ];

    pushDiagnostics(fc.conn, compilations, new Set());

    // Exactly one push for the shared URI, with one warning (not two).
    const forShared = fc.pushed.filter((p) => p.uri === URI.file(shared).toString());
    expect(forShared).toHaveLength(1);
    expect(forShared[0].diagnostics).toHaveLength(1);
  });
});

import { describe, it, expect } from "vitest";
import { DiagnosticSeverity } from "vscode-languageserver";
import { scanIfDefWarnings, buildUnionKnownNames } from "../features/diagnostics";
import { testIndex } from "./fixture";

// ── scanIfDefWarnings ────────────────────────────────────────────────────────

describe("scanIfDefWarnings", () => {
  const known = new Set(["debug", "target_zcode", "has_hints"]);

  it("returns no warnings for an empty file", () => {
    expect(scanIfDefWarnings("", known)).toEqual([]);
  });

  it("returns no warnings for a file with no #IfDef directives", () => {
    expect(scanIfDefWarnings("Constant FOO 1;\n[ Main; ];\n", known)).toEqual([]);
  });

  it("returns no warning for a known #IfDef name", () => {
    expect(scanIfDefWarnings("#IfDef DEBUG;\n#EndIf;\n", known)).toHaveLength(0);
  });

  it("returns a warning for an unknown #IfDef name", () => {
    const warnings = scanIfDefWarnings("#IfDef UNKNOWN_CONST;\n#EndIf;\n", known);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe(DiagnosticSeverity.Warning);
    expect(warnings[0].message).toContain("UNKNOWN_CONST");
    expect(warnings[0].source).toBe("inform6");
  });

  it("returns a warning for an unknown #IfNDef name", () => {
    const warnings = scanIfDefWarnings("#IfNDef ALSO_UNKNOWN;\n#EndIf;\n", known);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("ALSO_UNKNOWN");
  });

  it("is case-insensitive for both the directive and the name lookup", () => {
    // directive varies; name "debug" is known (stored lowercase in `known`)
    expect(scanIfDefWarnings("#ifdef debug;\n", known)).toHaveLength(0);
    expect(scanIfDefWarnings("#IFDEF DEBUG;\n", known)).toHaveLength(0);
    expect(scanIfDefWarnings("#IfNdef Has_Hints;\n", known)).toHaveLength(0);
  });

  it("warns about a misspelled known name", () => {
    // "HASHINTS" is not in `known`; "has_hints" is.
    const warnings = scanIfDefWarnings("#IfDef HASHINTS;\n#EndIf;\n", known);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("HASHINTS");
  });

  it("reports the correct line number (0-based)", () => {
    const src = "Constant FOO 1;\n#IfDef UNKNOWN;\n#EndIf;\n";
    const warnings = scanIfDefWarnings(src, known);
    expect(warnings[0].range.start.line).toBe(1);
    expect(warnings[0].range.end.line).toBe(1);
  });

  it("positions the squiggle under the name, not the whole directive", () => {
    //             0         1
    //             0123456789012345
    const line = "#IfDef MYSTERY;";
    const src = line + "\n#EndIf;\n";
    const warnings = scanIfDefWarnings(src, known);
    const start = warnings[0].range.start.character;
    const end = warnings[0].range.end.character;
    expect(start).toBe(line.indexOf("MYSTERY"));
    expect(end).toBe(start + "MYSTERY".length);
  });

  it("handles leading whitespace before the directive", () => {
    const warnings = scanIfDefWarnings("    #IfDef UNKNOWN;\n", known);
    expect(warnings).toHaveLength(1);
  });

  it("reports multiple unknown names in one file", () => {
    const src = "#IfDef FOO;\n#IfNDef BAR;\n#IfDef DEBUG;\n";
    const warnings = scanIfDefWarnings(src, known);
    expect(warnings).toHaveLength(2); // FOO and BAR are unknown; DEBUG is known
    const names = warnings.map((w) => w.message);
    expect(names.some((m) => m.includes("FOO"))).toBe(true);
    expect(names.some((m) => m.includes("BAR"))).toBe(true);
  });

  it("does not warn for non-IfDef directives like #IfNot", () => {
    expect(scanIfDefWarnings("#IfNot;\n", known)).toHaveLength(0);
    expect(scanIfDefWarnings("#Ifv5;\n", known)).toHaveLength(0);
  });
});

// ── buildUnionKnownNames ─────────────────────────────────────────────────────

describe("buildUnionKnownNames", () => {
  const emptyConfig = {
    mainFile: "/x.inf",
    compiler: "inform6",
    libraryPath: "",
    switches: "",
    defines: [],
    externalDefines: [],
  };

  it("returns an empty set for no compilations", () => {
    expect(buildUnionKnownNames([])).toEqual(new Set());
  });

  it("includes lowercased symbol names from the index", () => {
    const result = buildUnionKnownNames([{ index: testIndex, fileConfig: emptyConfig }]);
    // testIndex.symbols contains "NOPE", "Foozle", "nothing", "TARGET_ZCODE", "description"
    expect(result.has("nope")).toBe(true);
    expect(result.has("foozle")).toBe(true);
    expect(result.has("target_zcode")).toBe(true);
  });

  it("includes externalDefines from the file config", () => {
    const config = { ...emptyConfig, externalDefines: ["HAS_HINTS", "DEBUG"] };
    const result = buildUnionKnownNames([{ index: testIndex, fileConfig: config }]);
    expect(result.has("has_hints")).toBe(true);
    expect(result.has("debug")).toBe(true);
  });

  it("takes the union across multiple compilations", () => {
    const indexA = {
      ...testIndex,
      symbols: [{ name: "ONLY_IN_A", type: "constant", value: 0, flags: 0, is_system: false }],
      routines: [],
      objects: [],
      globals: [],
      constants: [],
      arrays: [],
      verbs: [],
      dictionary: [],
      errors: [],
      grammar_action_refs: [],
      files: [],
    };
    const indexB = {
      ...testIndex,
      symbols: [{ name: "ONLY_IN_B", type: "constant", value: 0, flags: 0, is_system: false }],
      routines: [],
      objects: [],
      globals: [],
      constants: [],
      arrays: [],
      verbs: [],
      dictionary: [],
      errors: [],
      grammar_action_refs: [],
      files: [],
    };

    const result = buildUnionKnownNames([
      { index: indexA, fileConfig: emptyConfig },
      { index: indexB, fileConfig: emptyConfig },
    ]);
    expect(result.has("only_in_a")).toBe(true);
    expect(result.has("only_in_b")).toBe(true);
  });

  it("lowercases all names", () => {
    const result = buildUnionKnownNames([{ index: testIndex, fileConfig: emptyConfig }]);
    // No uppercase names should be in the set.
    for (const name of result) {
      expect(name).toBe(name.toLowerCase());
    }
  });
});

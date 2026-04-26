import { describe, it, expect } from "vitest";
import { DiagnosticSeverity } from "vscode-languageserver";
import { scanIfDefWarnings, buildUnionKnownNames, collectUndeclaredPropertyWarnings } from "../features/diagnostics";
import { testIndex } from "./fixture";
import type { CompilerIndex } from "../server/types";

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
    warnUndeclaredProperties: true,
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

// ── collectUndeclaredPropertyWarnings ────────────────────────────────────────

describe("collectUndeclaredPropertyWarnings", () => {
  const FILE = "/project/game.inf";
  const noLines = () => [];

  /** Build a minimal index with the given property symbols and objects. */
  function makeIndex(symbols: CompilerIndex["symbols"], objects: CompilerIndex["objects"]): CompilerIndex {
    return {
      ...testIndex,
      symbols,
      objects,
      globals: [],
      constants: [],
      arrays: [],
      routines: [],
      verbs: [],
      dictionary: [],
      errors: [],
      files: [FILE],
    };
  }

  const formalSym = {
    name: "description",
    type: "property",
    value: 3,
    flags: 0,
    is_system: false,
    formal_declaration: true,
  };

  const informalSym = {
    name: "before",
    type: "individual_property",
    value: 72,
    flags: 0,
    is_system: false,
    formal_declaration: false,
  };

  const systemSym = {
    name: "sys_prop",
    type: "property",
    value: 1,
    flags: 0,
    is_system: true,
    formal_declaration: false,
  };

  const baseObj: CompilerIndex["objects"][0] = {
    name: "TheRoom",
    file: FILE,
    start_line: 10,
    end_line: 25,
    is_class: false,
    attributes: [],
    properties: [],
    private_properties: [],
  };

  it("returns empty map when there are no property symbols", () => {
    const idx = makeIndex([], []);
    expect(collectUndeclaredPropertyWarnings(idx, noLines).size).toBe(0);
  });

  it("returns empty map when all property symbols are formally declared", () => {
    const idx = makeIndex([formalSym], [{ ...baseObj, properties: [{ name: "description", line: 14 }] }]);
    expect(collectUndeclaredPropertyWarnings(idx, noLines).size).toBe(0);
  });

  it("warns when an informal property is used in an object", () => {
    const idx = makeIndex([informalSym], [{ ...baseObj, properties: [{ name: "before", line: 15 }] }]);
    const result = collectUndeclaredPropertyWarnings(idx, noLines);
    expect(result.size).toBe(1);
    const diags = result.get(FILE)!;
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe(DiagnosticSeverity.Warning);
    expect(diags[0].source).toBe("inform6");
  });

  it("warning message names the property and suggests the fix", () => {
    const idx = makeIndex([informalSym], [{ ...baseObj, properties: [{ name: "before", line: 15 }] }]);
    const diags = collectUndeclaredPropertyWarnings(idx, noLines).get(FILE)!;
    expect(diags[0].message).toContain("before");
    expect(diags[0].message).toContain("Property before");
  });

  it("places the warning on the correct 0-based line", () => {
    const idx = makeIndex([informalSym], [{ ...baseObj, properties: [{ name: "before", line: 5 }] }]);
    const diags = collectUndeclaredPropertyWarnings(idx, noLines).get(FILE)!;
    expect(diags[0].range.start.line).toBe(4); // 1-based 5 → 0-based 4
    expect(diags[0].range.end.line).toBe(4);
  });

  it("does not warn on a formally declared property", () => {
    const idx = makeIndex(
      [formalSym, informalSym],
      [
        {
          ...baseObj,
          properties: [
            { name: "description", line: 14 }, // formal — no warning
            { name: "before", line: 15 }, // informal — warn
          ],
        },
      ],
    );
    const diags = collectUndeclaredPropertyWarnings(idx, noLines).get(FILE)!;
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain("before");
  });

  it("does not warn on a system property even if formal_declaration is false", () => {
    const idx = makeIndex([systemSym], [{ ...baseObj, properties: [{ name: "sys_prop", line: 12 }] }]);
    expect(collectUndeclaredPropertyWarnings(idx, noLines).size).toBe(0);
  });

  it("does not warn when formal_declaration is absent (old compiler binary)", () => {
    const symNoFlag = { name: "before", type: "individual_property", value: 72, flags: 0, is_system: false };
    const idx = makeIndex([symNoFlag], [{ ...baseObj, properties: [{ name: "before", line: 15 }] }]);
    expect(collectUndeclaredPropertyWarnings(idx, noLines).size).toBe(0);
  });

  it("warns on private_properties as well as properties", () => {
    const idx = makeIndex([informalSym], [{ ...baseObj, private_properties: [{ name: "before", line: 16 }] }]);
    const diags = collectUndeclaredPropertyWarnings(idx, noLines).get(FILE)!;
    expect(diags).toHaveLength(1);
    expect(diags[0].range.start.line).toBe(15);
  });

  it("emits one warning per object that uses the informal property", () => {
    const obj2 = { ...baseObj, name: "TheHall", start_line: 30, end_line: 40 };
    const idx = makeIndex(
      [informalSym],
      [
        { ...baseObj, properties: [{ name: "before", line: 15 }] },
        { ...obj2, properties: [{ name: "before", line: 35 }] },
      ],
    );
    const diags = collectUndeclaredPropertyWarnings(idx, noLines).get(FILE)!;
    expect(diags).toHaveLength(2);
    const lines = diags.map((d) => d.range.start.line).sort((a, b) => a - b);
    expect(lines).toEqual([14, 34]);
  });

  it("narrows the squiggle to the property name token when source is available", () => {
    //                   0         1         2
    //                   0123456789012345678901234
    const sourceLine = "    with before [ ; ],";
    const getLines = (file: string) => (file === FILE ? [sourceLine] : []);
    const idx = makeIndex([informalSym], [{ ...baseObj, properties: [{ name: "before", line: 1 }] }]);
    const diags = collectUndeclaredPropertyWarnings(idx, getLines).get(FILE)!;
    const start = diags[0].range.start.character;
    const end = diags[0].range.end.character;
    expect(start).toBe(sourceLine.indexOf("before"));
    expect(end).toBe(start + "before".length);
  });

  it("falls back to column 0 / MAX_SAFE_INTEGER when source is unavailable", () => {
    const idx = makeIndex([informalSym], [{ ...baseObj, properties: [{ name: "before", line: 15 }] }]);
    const diags = collectUndeclaredPropertyWarnings(idx, noLines).get(FILE)!;
    expect(diags[0].range.start.character).toBe(0);
    expect(diags[0].range.end.character).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("groups diagnostics by file when objects span multiple files", () => {
    const FILE2 = "/project/extras.inf";
    const obj2 = { ...baseObj, name: "TheHall", file: FILE2, start_line: 5, end_line: 10 };
    const idx = {
      ...makeIndex(
        [informalSym],
        [
          { ...baseObj, properties: [{ name: "before", line: 15 }] },
          { ...obj2, properties: [{ name: "before", line: 7 }] },
        ],
      ),
      files: [FILE, FILE2],
    };
    const result = collectUndeclaredPropertyWarnings(idx, noLines);
    expect(result.size).toBe(2);
    expect(result.get(FILE)).toHaveLength(1);
    expect(result.get(FILE2)).toHaveLength(1);
  });

  it("warns on both property and individual_property type symbols", () => {
    const propSym = {
      name: "myprop",
      type: "property",
      value: 5,
      flags: 0,
      is_system: false,
      formal_declaration: false as const,
    };
    const ipropSym = {
      name: "myiprop",
      type: "individual_property",
      value: 6,
      flags: 0,
      is_system: false,
      formal_declaration: false as const,
    };
    const idx = makeIndex(
      [propSym, ipropSym],
      [
        {
          ...baseObj,
          properties: [
            { name: "myprop", line: 11 },
            { name: "myiprop", line: 12 },
          ],
        },
      ],
    );
    const diags = collectUndeclaredPropertyWarnings(idx, noLines).get(FILE)!;
    expect(diags).toHaveLength(2);
    const names = diags.map((d) => d.message).join(" ");
    expect(names).toContain("myprop");
    expect(names).toContain("myiprop");
  });

  // ── Pragma:Prop suppression ──────────────────────────────────────────────

  it("suppresses warning when the source line contains '! Pragma:Prop'", () => {
    const lines = ["    undeclared_prop 42,  ! Pragma:Prop"];
    const getLines = () => lines;
    const idx = makeIndex([informalSym], [{ ...baseObj, properties: [{ name: "before", line: 1 }] }]);
    expect(collectUndeclaredPropertyWarnings(idx, getLines).size).toBe(0);
  });

  it("still warns when a different line has the pragma but not the usage line", () => {
    //   line 1 (index 0): undeclared_prop — no pragma → warn
    //   line 2 (index 1): something_else with Pragma:Prop — unrelated
    const lines = ["    undeclared_prop 42,", "    other_prop 0,  ! Pragma:Prop"];
    const getLines = () => lines;
    const idx = makeIndex([informalSym], [{ ...baseObj, properties: [{ name: "before", line: 1 }] }]);
    const diags = collectUndeclaredPropertyWarnings(idx, getLines).get(FILE)!;
    expect(diags).toHaveLength(1);
  });

  it("suppresses only the pragma-annotated usage when multiple objects use the same informal property", () => {
    const obj2 = { ...baseObj, name: "TheHall", start_line: 30, end_line: 40 };
    // line 0 (1-based line 1): pragma → suppressed
    // line 1 (1-based line 2): no pragma → warned
    const lines = ["    before 0,  ! Pragma:Prop", "    before 0,"];
    const getLines = () => lines;
    const idx = makeIndex(
      [informalSym],
      [
        { ...baseObj, properties: [{ name: "before", line: 1 }] },
        { ...obj2, properties: [{ name: "before", line: 2 }] },
      ],
    );
    const diags = collectUndeclaredPropertyWarnings(idx, getLines).get(FILE)!;
    expect(diags).toHaveLength(1);
    expect(diags[0].range.start.line).toBe(1); // 0-based line 1 = 1-based line 2
  });

  it("pragma suppression works when source is on a private_property line", () => {
    const lines = ["    secret_prop 0,  ! Pragma:Prop"];
    const getLines = () => lines;
    const idx = makeIndex([informalSym], [{ ...baseObj, private_properties: [{ name: "before", line: 1 }] }]);
    expect(collectUndeclaredPropertyWarnings(idx, getLines).size).toBe(0);
  });

  it("pragma text is case-sensitive (wrong case does not suppress)", () => {
    const lines = ["    undeclared_prop 42,  ! pragma:prop"];
    const getLines = () => lines;
    const idx = makeIndex([informalSym], [{ ...baseObj, properties: [{ name: "before", line: 1 }] }]);
    // lowercase "pragma:prop" should NOT suppress the warning
    const diags = collectUndeclaredPropertyWarnings(idx, getLines).get(FILE)!;
    expect(diags).toHaveLength(1);
  });
});

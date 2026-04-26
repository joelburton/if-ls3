import { describe, it, expect } from "vitest";
import { SymbolKind } from "vscode-languageserver";
import { URI } from "vscode-uri";
import { getWorkspaceSymbols } from "../features/workspaceSymbols";
import { testIndex, FILE } from "./fixture";
import type { CompilerIndex } from "../server/types";

describe("getWorkspaceSymbols", () => {
  it("returns every routine, object, global, constant, and array when query is empty", () => {
    const result = getWorkspaceSymbols([testIndex], "");
    const names = result.map((r) => r.name);
    expect(names).toContain("MyFunc");
    expect(names).toContain("FoozleSub");
    expect(names).toContain("TheRoom");
    expect(names).toContain("Room");
    expect(names).toContain("c");
    expect(names).toContain("location");
    expect(names).toContain("NOPE");
    expect(names).toContain("Foozle");
    expect(names).toContain("WordArray");
  });

  it("excludes embedded routines", () => {
    const result = getWorkspaceSymbols([testIndex], "");
    expect(result.map((r) => r.name)).not.toContain("TheRoom_before");
  });

  it("uses Function/Object/Class/Variable/Constant/Array kinds correctly", () => {
    const result = getWorkspaceSymbols([testIndex], "");
    const byName = new Map(result.map((r) => [r.name, r]));
    expect(byName.get("MyFunc")?.kind).toBe(SymbolKind.Function);
    expect(byName.get("TheRoom")?.kind).toBe(SymbolKind.Object);
    expect(byName.get("Room")?.kind).toBe(SymbolKind.Class);
    expect(byName.get("c")?.kind).toBe(SymbolKind.Variable);
    expect(byName.get("NOPE")?.kind).toBe(SymbolKind.Constant);
    expect(byName.get("WordArray")?.kind).toBe(SymbolKind.Array);
  });

  it("returns Locations whose URI points at the source file", () => {
    const result = getWorkspaceSymbols([testIndex], "MyFunc");
    expect(result).toHaveLength(1);
    expect(result[0].location.uri).toBe(URI.file(FILE).toString());
  });

  it("filters by case-insensitive substring", () => {
    const upper = getWorkspaceSymbols([testIndex], "FOOZ");
    const lower = getWorkspaceSymbols([testIndex], "fooz");
    expect(upper.map((r) => r.name).sort()).toEqual(lower.map((r) => r.name).sort());
    expect(upper.map((r) => r.name)).toEqual(expect.arrayContaining(["Foozle", "FoozleSub"]));
  });

  it("returns nothing for a query that matches no symbol", () => {
    expect(getWorkspaceSymbols([testIndex], "definitely_not_a_symbol_xyz")).toEqual([]);
  });

  it("deduplicates symbols that appear in multiple compilations by lowercase name", () => {
    // Two compilations share an include that defines MyFunc; expect a single entry.
    const second: CompilerIndex = {
      ...testIndex,
      // Different file, same routine name (as if the routine were in a shared header).
      files: ["/project/other.inf"],
      routines: [{ name: "MyFunc", file: "/project/other.inf", start_line: 1, end_line: 3, locals: [] }],
      objects: [],
      globals: [],
      constants: [],
      arrays: [],
      symbols: [],
    };
    const result = getWorkspaceSymbols([testIndex, second], "MyFunc");
    expect(result.filter((r) => r.name === "MyFunc")).toHaveLength(1);
    // First compilation wins.
    expect(result[0].location.uri).toBe(URI.file(FILE).toString());
  });

  it("treats names that differ only in case as the same symbol for dedup", () => {
    const second: CompilerIndex = {
      ...testIndex,
      files: ["/project/other.inf"],
      routines: [{ name: "myfunc", file: "/project/other.inf", start_line: 1, end_line: 3, locals: [] }],
      objects: [],
      globals: [],
      constants: [],
      arrays: [],
      symbols: [],
    };
    const result = getWorkspaceSymbols([testIndex, second], "myfunc");
    expect(result).toHaveLength(1);
    // First compilation wins (so name preserves "MyFunc" casing).
    expect(result[0].name).toBe("MyFunc");
  });

  it("returns nothing when given no compilations", () => {
    expect(getWorkspaceSymbols([], "anything")).toEqual([]);
  });
});

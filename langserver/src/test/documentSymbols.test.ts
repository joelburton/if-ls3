import { describe, it, expect } from "vitest";
import { SymbolKind } from "vscode-languageserver";
import { URI } from "vscode-uri";
import { getDocumentSymbols } from "../features/documentSymbols";
import { testIndex, FILE } from "./fixture";
import type { CompilerIndex } from "../server/types";

const URI_FOR_FILE = URI.file(FILE).toString();

describe("getDocumentSymbols", () => {
  it("returns an empty list for a file not in the index", () => {
    const result = getDocumentSymbols(testIndex, URI.file("/nowhere.inf").toString());
    expect(result).toEqual([]);
  });

  it("includes objects, classes, routines, globals, and constants from the file", () => {
    const result = getDocumentSymbols(testIndex, URI_FOR_FILE);
    const byName = new Map(result.map((s) => [s.name, s]));

    expect(byName.get("TheRoom")?.kind).toBe(SymbolKind.Object);
    expect(byName.get("Room")?.kind).toBe(SymbolKind.Class);
    expect(byName.get("MyFunc")?.kind).toBe(SymbolKind.Function);
    expect(byName.get("FoozleSub")?.kind).toBe(SymbolKind.Function);
    expect(byName.get("c")?.kind).toBe(SymbolKind.Variable);
    expect(byName.get("location")?.kind).toBe(SymbolKind.Variable);
    expect(byName.get("NOPE")?.kind).toBe(SymbolKind.Constant);
    expect(byName.get("Foozle")?.kind).toBe(SymbolKind.Constant);
  });

  it("uses the object shortname as detail when present", () => {
    const result = getDocumentSymbols(testIndex, URI_FOR_FILE);
    const room = result.find((s) => s.name === "TheRoom")!;
    expect(room.detail).toBe("The Room");
  });

  it("nests embedded routines under their parent object using `.` separator", () => {
    // The fixture's `TheRoom.before` (embedded:true) should nest under TheRoom.
    const result = getDocumentSymbols(testIndex, URI_FOR_FILE);
    const parent = result.find((s) => s.name === "TheRoom")!;
    expect(parent.children?.map((c) => c.name)).toContain("TheRoom.before");
    expect(result.map((s) => s.name)).not.toContain("TheRoom.before");
  });

  it("nests embedded routines under their parent class using `::` separator", () => {
    const idx: CompilerIndex = {
      ...testIndex,
      routines: [
        ...testIndex.routines.filter((r) => r.name !== "TheRoom_before"),
        { name: "Room::before", file: FILE, start_line: 25, end_line: 26, locals: [], embedded: true },
      ],
    };
    const result = getDocumentSymbols(idx, URI_FOR_FILE);
    const parent = result.find((s) => s.name === "Room")!;
    expect(parent.children?.map((c) => c.name)).toContain("Room::before");
  });

  it("falls back to top-level when the parent object is not in the index", () => {
    const idx: CompilerIndex = {
      ...testIndex,
      routines: [
        { name: "Orphan.before", file: FILE, start_line: 50, end_line: 55, locals: [], embedded: true },
      ],
      objects: [],
    };
    const result = getDocumentSymbols(idx, URI_FOR_FILE);
    expect(result.map((s) => s.name)).toContain("Orphan.before");
  });

  it("excludes symbols whose file does not match the requested URI", () => {
    const idx: CompilerIndex = {
      ...testIndex,
      routines: [
        ...testIndex.routines,
        { name: "OtherFileFunc", file: "/elsewhere.inf", start_line: 1, end_line: 5, locals: [] },
      ],
      objects: [
        ...testIndex.objects,
        {
          name: "OtherObj",
          file: "/elsewhere.inf",
          start_line: 1,
          end_line: 2,
          attributes: [],
          properties: [],
          private_properties: [],
        },
      ],
    };
    const result = getDocumentSymbols(idx, URI_FOR_FILE);
    const names = result.map((s) => s.name);
    expect(names).not.toContain("OtherFileFunc");
    expect(names).not.toContain("OtherObj");
  });

  it("encodes 1-based source lines as 0-based LSP ranges", () => {
    const result = getDocumentSymbols(testIndex, URI_FOR_FILE);
    const myfunc = result.find((s) => s.name === "MyFunc")!;
    // fixture has start_line: 58, end_line: 66
    expect(myfunc.range.start.line).toBe(57);
    expect(myfunc.range.end.line).toBe(65);
    expect(myfunc.selectionRange.start.line).toBe(57);
  });
});

import { describe, it, expect } from "vitest";
import { URI } from "vscode-uri";
import { resolveSymbol, enclosingObject, loc } from "../features/symbolLookup";
import { testIndex, FILE } from "./fixture";
import type { CompilerIndex } from "../server/types";

describe("loc", () => {
  it("returns a Location with file:// URI and zero-based line", () => {
    const l = loc(FILE, 42);
    expect(l.uri).toBe(URI.file(FILE).toString());
    expect(l.range.start.line).toBe(41);
    expect(l.range.start.character).toBe(0);
    expect(l.range.end.line).toBe(41);
  });

  it("clamps line 0 to 0 (defensive — input should be 1-based)", () => {
    const l = loc(FILE, 0);
    expect(l.range.start.line).toBe(0);
  });
});

describe("enclosingObject", () => {
  it("returns the object whose start_line ≤ line ≤ end_line", () => {
    // TheRoom spans 10..20 in the fixture.
    const obj = enclosingObject(testIndex, FILE, 15);
    expect(obj?.name).toBe("TheRoom");
  });

  it("includes the boundary lines (inclusive)", () => {
    expect(enclosingObject(testIndex, FILE, 10)?.name).toBe("TheRoom");
    expect(enclosingObject(testIndex, FILE, 20)?.name).toBe("TheRoom");
  });

  it("returns undefined when the line is outside any object body", () => {
    expect(enclosingObject(testIndex, FILE, 100)).toBeUndefined();
  });

  it("returns undefined when the file does not match", () => {
    expect(enclosingObject(testIndex, "/elsewhere.inf", 15)).toBeUndefined();
  });
});

describe("resolveSymbol", () => {
  it("resolves routines first", () => {
    const r = resolveSymbol(testIndex, "MyFunc");
    expect(r?.kind).toBe("routine");
    if (r?.kind === "routine") expect(r.item.name).toBe("MyFunc");
  });

  it("resolves objects", () => {
    const r = resolveSymbol(testIndex, "TheRoom");
    expect(r?.kind).toBe("object");
  });

  it("resolves classes via objects[]", () => {
    const r = resolveSymbol(testIndex, "Room");
    expect(r?.kind).toBe("object");
    if (r?.kind === "object") expect(r.item.is_class).toBe(true);
  });

  it("resolves globals", () => {
    const r = resolveSymbol(testIndex, "location");
    expect(r?.kind).toBe("global");
  });

  it("resolves constants", () => {
    const r = resolveSymbol(testIndex, "NOPE");
    expect(r?.kind).toBe("constant");
  });

  it("resolves arrays", () => {
    const r = resolveSymbol(testIndex, "WordArray");
    expect(r?.kind).toBe("array");
  });

  it("falls back to symbols[] for library properties (concealed attribute)", () => {
    const r = resolveSymbol(testIndex, "concealed");
    expect(r?.kind).toBe("symbol");
    if (r?.kind === "symbol") expect(r.item.type).toBe("attribute");
  });

  it("is case-insensitive", () => {
    expect(resolveSymbol(testIndex, "myfunc")?.kind).toBe("routine");
    expect(resolveSymbol(testIndex, "MYFUNC")?.kind).toBe("routine");
    expect(resolveSymbol(testIndex, "MyFunc")?.kind).toBe("routine");
  });

  it("returns null for an unknown name", () => {
    expect(resolveSymbol(testIndex, "no_such_thing")).toBeNull();
  });

  it("excludes is_system symbols from the symbols[] fallback", () => {
    // 'light' (system attribute), 'container' (system attribute), 'nothing'
    // (system object), 'TARGET_ZCODE' (system constant) are all in symbols[]
    // but should be excluded from resolveSymbol's fallback path.
    expect(resolveSymbol(testIndex, "light")).toBeNull();
    expect(resolveSymbol(testIndex, "container")).toBeNull();
    expect(resolveSymbol(testIndex, "nothing")).toBeNull();
    expect(resolveSymbol(testIndex, "target_zcode")).toBeNull();
  });

  it("excludes symbols[] entries with no file from the fallback", () => {
    // Add a non-system symbol that has no file (synthetic / runtime). It must
    // be excluded so go-to-definition doesn't try to navigate to nowhere.
    const idx: CompilerIndex = {
      ...testIndex,
      symbols: [
        ...testIndex.symbols,
        { name: "FileLessSymbol", type: "constant", value: 1, flags: 0, is_system: false },
      ],
    };
    expect(resolveSymbol(idx, "FileLessSymbol")).toBeNull();
  });

  it("prefers a routine over a same-named constant (lookup order)", () => {
    const idx: CompilerIndex = {
      ...testIndex,
      // Both a routine and a constant called "Conflict".
      routines: [
        ...testIndex.routines,
        { name: "Conflict", file: FILE, start_line: 1, end_line: 1, locals: [] },
      ],
      constants: [...testIndex.constants, { name: "Conflict", file: FILE, line: 2 }],
    };
    const r = resolveSymbol(idx, "Conflict");
    expect(r?.kind).toBe("routine");
  });

  it("prefers an object over a same-named global (lookup order)", () => {
    const idx: CompilerIndex = {
      ...testIndex,
      objects: [
        ...testIndex.objects,
        {
          name: "Shared",
          file: FILE,
          start_line: 1,
          end_line: 2,
          attributes: [],
          properties: [],
          private_properties: [],
        },
      ],
      globals: [...testIndex.globals, { name: "Shared", file: FILE, line: 3 }],
    };
    expect(resolveSymbol(idx, "Shared")?.kind).toBe("object");
  });
});

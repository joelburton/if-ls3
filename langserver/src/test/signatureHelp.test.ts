import { describe, it, expect } from "vitest";
import { getSignatureHelp } from "../features/signatureHelp";
import { testIndex } from "./fixture";

// testIndex has: MyFunc(a, b, x), FoozleSub(), TheRoom.before (embedded)

function pos(line: number, character: number) {
  return { line, character };
}

function text(...lines: string[]) {
  return lines.join("\n");
}

describe("getSignatureHelp", () => {
  it("shows signature right after opening paren", () => {
    const result = getSignatureHelp(testIndex, "MyFunc(", pos(0, 7));
    expect(result).not.toBeNull();
    expect(result!.signatures[0]!.label).toBe("MyFunc(a, b, x)");
    expect(result!.activeParameter).toBe(0);
  });

  it("advances to second parameter after first comma", () => {
    const result = getSignatureHelp(testIndex, "MyFunc(1, ", pos(0, 10));
    expect(result!.activeParameter).toBe(1);
  });

  it("advances to third parameter after second comma", () => {
    const result = getSignatureHelp(testIndex, "MyFunc(1, 2, ", pos(0, 13));
    expect(result!.activeParameter).toBe(2);
  });

  it("clamps active parameter at last param for excess args", () => {
    const result = getSignatureHelp(testIndex, "MyFunc(1, 2, 3, ", pos(0, 16));
    expect(result!.activeParameter).toBe(2); // clamped to last (index 2)
  });

  it("returns null for unknown routine", () => {
    const result = getSignatureHelp(testIndex, "Unknown(", pos(0, 8));
    expect(result).toBeNull();
  });

  it("returns null outside any call", () => {
    const result = getSignatureHelp(testIndex, "x = 1 + 2", pos(0, 6));
    expect(result).toBeNull();
  });

  it("returns null when an identifier matches an embedded routine", () => {
    // Real source never literally writes "Object.prop(" — the compiler-emitted
    // name has a `.` in it, which is not a valid identifier character.  But
    // guard against an embedded routine whose name happens to match a typed
    // identifier by giving it no separator and verifying the embedded check.
    const idx = {
      ...testIndex,
      routines: [
        { name: "BareEmbedded", file: "/p/g.inf", start_line: 1, end_line: 2, locals: ["x"], embedded: true },
      ],
    };
    expect(getSignatureHelp(idx, "BareEmbedded(", pos(0, 13))).toBeNull();
  });

  it("shows correct parameter for nested call — outer", () => {
    // MyFunc(FoozleSub(), | ) — outer call, second parameter
    const result = getSignatureHelp(testIndex, "MyFunc(FoozleSub(), ", pos(0, 20));
    expect(result!.signatures[0]!.label).toBe("MyFunc(a, b, x)");
    expect(result!.activeParameter).toBe(1);
  });

  it("shows correct parameter for nested call — inner", () => {
    // MyFunc(FoozleSub(| ), 2) — inner call, first parameter
    const result = getSignatureHelp(testIndex, "MyFunc(FoozleSub(", pos(0, 17));
    expect(result!.signatures[0]!.label).toBe("FoozleSub()");
    expect(result!.activeParameter).toBe(0);
  });

  it("ignores comma inside a string argument", () => {
    // MyFunc("a, b", | ) — only one real comma, so second param
    const result = getSignatureHelp(testIndex, 'MyFunc("a, b", ', pos(0, 15));
    expect(result!.activeParameter).toBe(1);
  });

  it("ignores ( inside a string argument", () => {
    // MyFunc("foo(bar)", | ) — the ( inside string should not create a new frame
    const result = getSignatureHelp(testIndex, 'MyFunc("foo(bar)", ', pos(0, 19));
    expect(result!.signatures[0]!.label).toBe("MyFunc(a, b, x)");
    expect(result!.activeParameter).toBe(1);
  });

  it("ignores comma in comment before call", () => {
    const src = text("! a, b, c", "MyFunc(");
    const result = getSignatureHelp(testIndex, src, pos(1, 7));
    expect(result!.activeParameter).toBe(0);
  });

  it("returns null with zero-param routine — no param to highlight", () => {
    const result = getSignatureHelp(testIndex, "FoozleSub(", pos(0, 10));
    expect(result).not.toBeNull();
    expect(result!.signatures[0]!.parameters).toHaveLength(0);
    expect(result!.activeParameter).toBe(0); // clamped: min(0, max(0, 0-1)) = 0
  });

  it("includes doc comment in signature", () => {
    const indexWithDoc = {
      ...testIndex,
      routines: [{ ...testIndex.routines[0]!, doc: "Does the thing" }],
    };
    const result = getSignatureHelp(indexWithDoc, "MyFunc(", pos(0, 7));
    const doc = result!.signatures[0]!.documentation;
    expect(doc).toMatchObject({ kind: "markdown", value: "Does the thing" });
  });

  it("is case-insensitive for routine name lookup", () => {
    const result = getSignatureHelp(testIndex, "myfunc(", pos(0, 7));
    expect(result!.signatures[0]!.label).toBe("MyFunc(a, b, x)");
  });

  it("encodes parameter offsets correctly in label", () => {
    const result = getSignatureHelp(testIndex, "MyFunc(", pos(0, 7));
    const label = result!.signatures[0]!.label; // "MyFunc(a, b, x)"
    const params = result!.signatures[0]!.parameters!;
    expect(label.slice((params[0]!.label as [number, number])[0], (params[0]!.label as [number, number])[1])).toBe("a");
    expect(label.slice((params[1]!.label as [number, number])[0], (params[1]!.label as [number, number])[1])).toBe("b");
    expect(label.slice((params[2]!.label as [number, number])[0], (params[2]!.label as [number, number])[1])).toBe("x");
  });
});

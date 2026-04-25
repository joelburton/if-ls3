/**
 * Integration test: run `inform6 -y` on the tiny corpus file and verify the
 * structural integrity of the JSON output.
 *
 * Skipped automatically when the compiler binary is not present (e.g., on a
 * fresh clone that hasn't built the C code yet).  CI builds the binary first.
 */

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.join(__dirname, "../../..");
const INFORM6 = path.join(REPO_ROOT, "Inform6/inform6");
const TINY_INF = path.join(REPO_ROOT, "test/corpus/tiny/tiny.inf");

describe.skipIf(!existsSync(INFORM6))("inform6 -y compiler output", () => {
  let output: string;

  // Run once and re-use across all tests in this suite.
  try {
    output = execSync(`${INFORM6} -y ${TINY_INF}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (e: any) {
    // inform6 exits non-zero on warnings; stdout still has the JSON.
    output = e.stdout ?? "";
  }

  it("produces valid JSON", () => {
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it("has required top-level keys", () => {
    const idx = JSON.parse(output);
    for (const key of [
      "version",
      "files",
      "symbols",
      "routines",
      "objects",
      "globals",
      "constants",
      "arrays",
      "verbs",
      "dictionary",
      "errors",
      "grammar_action_refs",
      "references",
    ]) {
      expect(idx).toHaveProperty(key);
    }
  });

  it("contains the expected routines", () => {
    const idx = JSON.parse(output);
    const names: string[] = idx.routines.map((r: { name: string }) => r.name);
    expect(names).toContain("Main");
    expect(names).toContain("MyFunc");
  });

  it("MyFunc has locals a and b", () => {
    const idx = JSON.parse(output);
    const myfunc = idx.routines.find((r: { name: string }) => r.name === "MyFunc");
    expect(myfunc).toBeDefined();
    expect(myfunc.locals).toContain("a");
    expect(myfunc.locals).toContain("b");
  });

  it("references array has action entries", () => {
    const idx = JSON.parse(output);
    const refs: Array<{ sym: string; type: string; locs: string[] }> = idx.references;
    const foozleRef = refs.find((r) => r.sym === "Foozle" && r.type === "action");
    expect(foozleRef).toBeDefined();
    expect(foozleRef!.locs.length).toBeGreaterThan(0);
  });

  it("has no compilation errors", () => {
    const idx = JSON.parse(output);
    const errors = idx.errors.filter((e: { severity: string }) => e.severity === "error");
    expect(errors).toHaveLength(0);
  });

  it("files array contains the tiny.inf path", () => {
    const idx = JSON.parse(output);
    expect(idx.files.some((f: string) => f.endsWith("tiny.inf"))).toBe(true);
  });

  describe("formal_declaration on property symbols", () => {
    type Sym = {
      name: string;
      type: string;
      is_system?: boolean;
      formal_declaration?: boolean;
      line?: number;
    };

    it("marks `Property name;` declarations as formal", () => {
      const idx = JSON.parse(output);
      // tiny.inf lines 1-2: `Property room_func;` and `Property description;`
      const roomFunc = idx.symbols.find((s: Sym) => s.name === "room_func");
      const description = idx.symbols.find((s: Sym) => s.name === "description");

      expect(roomFunc).toBeDefined();
      expect(roomFunc.type).toBe("property");
      expect(roomFunc.formal_declaration).toBe(true);

      expect(description).toBeDefined();
      expect(description.type).toBe("property");
      expect(description.formal_declaration).toBe(true);
    });

    it("marks properties created implicitly inside `with` blocks as not formal", () => {
      const idx = JSON.parse(output);
      // tiny.inf has no library include, so `before` (used inside TheRoom's
      // with-block on line 19) is created implicitly as an individual_property.
      const before = idx.symbols.find((s: Sym) => s.name === "before");
      expect(before).toBeDefined();
      expect(before.type).toBe("individual_property");
      expect(before.is_system).toBe(false);
      expect(before.formal_declaration).toBe(false);
    });

    it("emits formal_declaration on every property/individual_property symbol", () => {
      const idx = JSON.parse(output);
      const props: Sym[] = idx.symbols.filter(
        (s: Sym) => s.type === "property" || s.type === "individual_property",
      );
      expect(props.length).toBeGreaterThan(0);
      for (const p of props) {
        expect(typeof p.formal_declaration).toBe("boolean");
      }
    });

    it("does not emit formal_declaration on non-property symbols", () => {
      const idx = JSON.parse(output);
      const others: Sym[] = idx.symbols.filter(
        (s: Sym) => s.type !== "property" && s.type !== "individual_property",
      );
      expect(others.length).toBeGreaterThan(0);
      for (const s of others) {
        expect(s).not.toHaveProperty("formal_declaration");
      }
    });
  });
});

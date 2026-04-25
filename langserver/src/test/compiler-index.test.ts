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
});

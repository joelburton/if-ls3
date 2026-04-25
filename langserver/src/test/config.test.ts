import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig } from "../workspace/config";

// ── Test infrastructure ──────────────────────────────────────────────────────

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "inform6-config-test-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

let counter = 0;

/** Write an inform6rc.yaml into a fresh sub-directory and return that directory. */
function writeConfig(yaml: string): string {
  const dir = path.join(tmpDir, String(counter++));
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "inform6rc.yaml"), yaml);
  return dir;
}

// ── Missing / invalid file ────────────────────────────────────────────────────

describe("loadConfig", () => {
  describe("missing or invalid config file", () => {
    it("returns null when inform6rc.yaml does not exist", () => {
      const emptyDir = path.join(tmpDir, "no-config");
      fs.mkdirSync(emptyDir);
      expect(loadConfig(emptyDir)).toBeNull();
    });

    it("returns null for malformed YAML", () => {
      const dir = writeConfig("{ unclosed: [");
      expect(loadConfig(dir)).toBeNull();
    });

    it("returns null when the YAML root is not an object (e.g. a bare string)", () => {
      const dir = writeConfig(`"just a string"\n`);
      expect(loadConfig(dir)).toBeNull();
    });

    it("returns an empty files array when the YAML root is a list", () => {
      // Array.isArray check is absent — the code falls through and finds no
      // valid file entries, returning { files: [] } rather than null.
      const dir = writeConfig("- item1\n- item2\n");
      expect(loadConfig(dir)).toEqual({ files: [] });
    });
  });

  // ── Global defaults ─────────────────────────────────────────────────────────

  describe("global defaults", () => {
    it("uses 'inform6' as the default compiler", () => {
      const dir = writeConfig("game.inf:\n");
      const cfg = loadConfig(dir)!;
      expect(cfg.files[0].compiler).toBe("inform6");
    });

    it("uses empty string as the default libraryPath", () => {
      const dir = writeConfig("game.inf:\n");
      expect(loadConfig(dir)!.files[0].libraryPath).toBe("");
    });

    it("uses empty string as the default switches", () => {
      const dir = writeConfig("game.inf:\n");
      expect(loadConfig(dir)!.files[0].switches).toBe("");
    });

    it("uses an empty array as the default defines", () => {
      const dir = writeConfig("game.inf:\n");
      expect(loadConfig(dir)!.files[0].defines).toEqual([]);
    });

    it("uses an empty array as the default externalDefines", () => {
      const dir = writeConfig("game.inf:\n");
      expect(loadConfig(dir)!.files[0].externalDefines).toEqual([]);
    });
  });

  // ── File entries ─────────────────────────────────────────────────────────────

  describe("file entries", () => {
    it("resolves mainFile as an absolute path relative to the workspace root", () => {
      const dir = writeConfig("game.inf:\n");
      const cfg = loadConfig(dir)!;
      expect(cfg.files[0].mainFile).toBe(path.join(dir, "game.inf"));
    });

    it("returns one FileConfig per file entry", () => {
      const dir = writeConfig("a.inf:\nb.inf:\n");
      expect(loadConfig(dir)!.files).toHaveLength(2);
    });

    it("returns an empty files array when no file entries are present", () => {
      // Only global-key entries — no file entries.
      const dir = writeConfig("compiler: inform6\nlibraryPath: /lib\n");
      expect(loadConfig(dir)!.files).toHaveLength(0);
    });

    it("ignores keys whose value is a non-null, non-object scalar", () => {
      // "bad.inf: 42" — value is a number, not null or object → skipped.
      const dir = writeConfig("good.inf:\nbad.inf: 42\n");
      const cfg = loadConfig(dir)!;
      const names = cfg.files.map(f => path.basename(f.mainFile));
      expect(names).toContain("good.inf");
      expect(names).not.toContain("bad.inf");
    });

    it("ignores keys whose value is a list", () => {
      const dir = writeConfig("good.inf:\nbad.inf:\n  - item\n");
      const cfg = loadConfig(dir)!;
      const names = cfg.files.map(f => path.basename(f.mainFile));
      expect(names).not.toContain("bad.inf");
    });
  });

  // ── Global overrides ─────────────────────────────────────────────────────────

  describe("global scalar settings", () => {
    it("applies a global compiler to all file entries", () => {
      const dir = writeConfig("compiler: /usr/local/bin/inform6\na.inf:\nb.inf:\n");
      const cfg = loadConfig(dir)!;
      expect(cfg.files[0].compiler).toBe("/usr/local/bin/inform6");
      expect(cfg.files[1].compiler).toBe("/usr/local/bin/inform6");
    });

    it("applies a global libraryPath to all file entries", () => {
      const dir = writeConfig("libraryPath: /lib/inform6\ngame.inf:\n");
      expect(loadConfig(dir)!.files[0].libraryPath).toBe("/lib/inform6");
    });

    it("applies global switches to all file entries", () => {
      const dir = writeConfig("switches: -v5\ngame.inf:\n");
      expect(loadConfig(dir)!.files[0].switches).toBe("-v5");
    });
  });

  // ── Per-file overrides ───────────────────────────────────────────────────────

  describe("per-file scalar overrides", () => {
    it("per-file compiler overrides the global compiler", () => {
      const dir = writeConfig(
        "compiler: global-compiler\ngame.inf:\n  compiler: per-file-compiler\n",
      );
      expect(loadConfig(dir)!.files[0].compiler).toBe("per-file-compiler");
    });

    it("per-file libraryPath overrides the global libraryPath", () => {
      const dir = writeConfig(
        "libraryPath: /global/lib\ngame.inf:\n  libraryPath: /local/lib\n",
      );
      expect(loadConfig(dir)!.files[0].libraryPath).toBe("/local/lib");
    });

    it("per-file switches override global switches", () => {
      const dir = writeConfig("switches: -v5\ngame.inf:\n  switches: -v3\n");
      expect(loadConfig(dir)!.files[0].switches).toBe("-v3");
    });

    it("a second file entry that has no overrides still gets the global value", () => {
      const dir = writeConfig(
        "compiler: global-compiler\na.inf:\n  compiler: override\nb.inf:\n",
      );
      const cfg = loadConfig(dir)!;
      const a = cfg.files.find(f => f.mainFile.endsWith("a.inf"))!;
      const b = cfg.files.find(f => f.mainFile.endsWith("b.inf"))!;
      expect(a.compiler).toBe("override");
      expect(b.compiler).toBe("global-compiler");
    });
  });

  // ── defines and externalDefines merging ─────────────────────────────────────

  describe("defines merging", () => {
    it("includes global defines when there are no per-file defines", () => {
      const dir = writeConfig("defines:\n  - GLOBAL_DEF\ngame.inf:\n");
      expect(loadConfig(dir)!.files[0].defines).toEqual(["GLOBAL_DEF"]);
    });

    it("appends per-file defines after global defines", () => {
      const dir = writeConfig(
        "defines:\n  - GLOBAL\ngame.inf:\n  defines:\n    - LOCAL\n",
      );
      expect(loadConfig(dir)!.files[0].defines).toEqual(["GLOBAL", "LOCAL"]);
    });

    it("deduplicates defines that appear in both global and per-file lists", () => {
      const dir = writeConfig(
        "defines:\n  - SHARED\ngame.inf:\n  defines:\n    - SHARED\n    - LOCAL\n",
      );
      expect(loadConfig(dir)!.files[0].defines).toEqual(["SHARED", "LOCAL"]);
    });

    it("deduplicates defines that appear twice in the global list", () => {
      const dir = writeConfig("defines:\n  - DUP\n  - DUP\ngame.inf:\n");
      expect(loadConfig(dir)!.files[0].defines).toEqual(["DUP"]);
    });
  });

  describe("externalDefines merging", () => {
    it("includes global externalDefines when there are no per-file overrides", () => {
      const dir = writeConfig("externalDefines:\n  - HAS_HINTS\ngame.inf:\n");
      expect(loadConfig(dir)!.files[0].externalDefines).toEqual(["HAS_HINTS"]);
    });

    it("appends per-file externalDefines after global ones", () => {
      const dir = writeConfig(
        "externalDefines:\n  - GLOBAL\ngame.inf:\n  externalDefines:\n    - LOCAL\n",
      );
      expect(loadConfig(dir)!.files[0].externalDefines).toEqual(["GLOBAL", "LOCAL"]);
    });

    it("deduplicates externalDefines", () => {
      const dir = writeConfig(
        "externalDefines:\n  - SHARED\ngame.inf:\n  externalDefines:\n    - SHARED\n",
      );
      expect(loadConfig(dir)!.files[0].externalDefines).toEqual(["SHARED"]);
    });
  });

  // ── Tilde expansion ──────────────────────────────────────────────────────────

  describe("tilde expansion", () => {
    it("expands ~/ in a global libraryPath", () => {
      const dir = writeConfig("libraryPath: ~/inform6lib\ngame.inf:\n");
      const expected = path.join(os.homedir(), "inform6lib");
      expect(loadConfig(dir)!.files[0].libraryPath).toBe(expected);
    });

    it("expands ~/ in a global compiler path", () => {
      const dir = writeConfig("compiler: ~/bin/inform6\ngame.inf:\n");
      const expected = path.join(os.homedir(), "bin/inform6");
      expect(loadConfig(dir)!.files[0].compiler).toBe(expected);
    });

    it("expands ~/ in a per-file libraryPath override", () => {
      const dir = writeConfig("game.inf:\n  libraryPath: ~/local/lib\n");
      const expected = path.join(os.homedir(), "local/lib");
      expect(loadConfig(dir)!.files[0].libraryPath).toBe(expected);
    });

    it("does not expand ~ that is not followed by /", () => {
      const dir = writeConfig("libraryPath: ~notahome\ngame.inf:\n");
      expect(loadConfig(dir)!.files[0].libraryPath).toBe("~notahome");
    });

    it("does not alter an absolute path that happens to contain ~", () => {
      const dir = writeConfig("libraryPath: /some/path~with/tilde\ngame.inf:\n");
      expect(loadConfig(dir)!.files[0].libraryPath).toBe("/some/path~with/tilde");
    });
  });
});

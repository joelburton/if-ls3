import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as yaml from "js-yaml";

/** Resolved, merged config for one main file compilation. */
export interface FileConfig {
  mainFile: string; /* absolute path */
  compiler: string;
  libraryPath: string;
  switches: string;
  defines: string[];
  externalDefines: string[];
}

export interface WorkspaceConfig {
  files: FileConfig[];
}

function expandTilde(p: string): string {
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function toStringArray(val: unknown): string[] {
  return Array.isArray(val) ? val.map(String) : [];
}

function dedup(arr: string[]): string[] {
  return [...new Set(arr)];
}

const GLOBAL_KEYS = new Set(["compiler", "libraryPath", "switches", "defines", "externalDefines"]);

/**
 * Load `inform6rc.yaml` from the workspace root.
 *
 * Top-level keys in GLOBAL_KEYS provide defaults; any other key whose value
 * is null or a plain object is treated as a main-file entry.  Per-file
 * scalars (`compiler`, `libraryPath`, `switches`) override the global value;
 * list fields (`defines`, `externalDefines`) are merged (global + per-file,
 * deduplicated).
 *
 * Returns null if the file is missing or unparseable.
 */
export function loadConfig(workspaceRoot: string): WorkspaceConfig | null {
  const configPath = path.join(workspaceRoot, "inform6rc.yaml");
  if (!fs.existsSync(configPath)) return null;

  let raw: Record<string, unknown>;
  try {
    raw = yaml.load(fs.readFileSync(configPath, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (!raw || typeof raw !== "object") return null;

  /* Global defaults */
  const globalCompiler = String(raw["compiler"] ?? "inform6");
  const globalLibraryPath = String(raw["libraryPath"] ?? "");
  const globalSwitches = String(raw["switches"] ?? "");
  const globalDefines = toStringArray(raw["defines"]);
  const globalExternalDefines = toStringArray(raw["externalDefines"]);

  /* Per-file entries: any non-global key with a null or plain-object value */
  const files: FileConfig[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (GLOBAL_KEYS.has(key)) continue;
    if (value !== null && (typeof value !== "object" || Array.isArray(value))) continue;

    const perFile = (value ?? {}) as Record<string, unknown>;

    files.push({
      mainFile: path.resolve(workspaceRoot, key),
      compiler: expandTilde(String(perFile["compiler"] ?? globalCompiler)),
      libraryPath: expandTilde(String(perFile["libraryPath"] ?? globalLibraryPath)),
      switches: String(perFile["switches"] ?? globalSwitches),
      defines: dedup([...globalDefines, ...toStringArray(perFile["defines"])]),
      externalDefines: dedup([...globalExternalDefines, ...toStringArray(perFile["externalDefines"])]),
    });
  }

  return { files };
}

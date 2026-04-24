import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as yaml from "js-yaml";

export interface Inform6Config {
  compiler: string;
  libraryPath: string;
  mainFile: string;
  switches: string;
  defines: string[];
  externalDefines: string[];
}

function expandTilde(p: string): string {
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * Load `inform6rc.yaml` from the workspace root.
 * Returns null if the file doesn't exist or is malformed.
 */
export function loadConfig(workspaceRoot: string): Inform6Config | null {
  const configPath = path.join(workspaceRoot, "inform6rc.yaml");
  if (!fs.existsSync(configPath)) return null;

  let raw: Record<string, unknown>;
  try {
    raw = yaml.load(fs.readFileSync(configPath, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (!raw || typeof raw !== "object") return null;

  const rawDefines = raw["defines"];
  const defines = Array.isArray(rawDefines) ? rawDefines.map(String) : [];

  const rawExternal = raw["externalDefines"];
  const externalDefines = Array.isArray(rawExternal) ? rawExternal.map(String) : [];

  return {
    compiler: expandTilde(String(raw["compiler"] ?? "inform6")),
    libraryPath: expandTilde(String(raw["libraryPath"] ?? "")),
    mainFile: String(raw["mainFile"] ?? ""),
    switches: String(raw["switches"] ?? ""),
    defines,
    externalDefines,
  };
}

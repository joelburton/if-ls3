import * as path from "node:path";
import { spawn } from "node:child_process";
import type { CompilerIndex } from "./types";
import type { Inform6Config } from "../workspace/config";

let cachedIndex: CompilerIndex | null = null;
let spawnCount = 0;

export function getIndex(): CompilerIndex | null {
  return cachedIndex;
}

/**
 * Invoke `inform6 -y +libpath mainFile`, parse JSON from stdout.
 * Returns the parsed index on success, null on spawn error or timeout.
 */
export function reindex(
  config: Inform6Config,
  workspaceRoot: string,
  log: (msg: string) => void,
): Promise<CompilerIndex | null> {
  const mainFilePath = path.resolve(workspaceRoot, config.mainFile);

  const args: string[] = ["-y"];
  if (config.switches) args.push(...config.switches.trim().split(/\s+/));
  if (config.libraryPath) args.push(`+${config.libraryPath}`);
  for (const def of config.defines) args.push(`$${def}`);
  args.push(mainFilePath);

  spawnCount += 1;
  log(`[indexer] spawning #${spawnCount}: ${config.compiler} ${args.join(" ")}`);

  return new Promise((resolve) => {
    const child = spawn(config.compiler, args, {
      cwd: workspaceRoot,
      env: process.env,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      child.kill();
      log("[indexer] TIMEOUT: compiler did not finish within 10 s, killed");
      resolve(null);
    }, 10_000);

    child.on("error", (err) => {
      clearTimeout(timer);
      log(`[indexer] FAILED to spawn compiler: ${err.message}`);
      log(`[indexer]   check that 'compiler' path in inform6rc.yaml is correct`);
      resolve(null);
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);

      if (signal) {
        // Killed by our timeout handler — already logged and resolved.
        return;
      }

      log(`[indexer] compiler exited with status ${String(code)}`);

      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      if (stderr) {
        for (const line of stderr.trimEnd().split("\n")) {
          log(`[indexer] stderr: ${line}`);
        }
      }

      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      if (!stdout) {
        log("[indexer] FAILED: no JSON on stdout — compiler ran but produced no index");
        resolve(null);
        return;
      }

      log(`[indexer] stdout: ${stdout.length} bytes`);

      try {
        const index = JSON.parse(stdout) as CompilerIndex;
        log(
          `[indexer] OK: ${index.routines.length} routines, ${index.objects.length} objects, ` +
          `${index.globals.length} globals, ${index.constants.length} constants, ` +
          `${index.errors.length} diagnostic(s)`,
        );
        cachedIndex = index;
        resolve(index);
      } catch (e) {
        log(`[indexer] FAILED: JSON parse error: ${String(e)}`);
        log(`[indexer]   first 200 chars of stdout: ${stdout.slice(0, 200)}`);
        resolve(null);
      }
    });
  });
}

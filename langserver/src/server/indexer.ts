import * as path from "node:path";
import { spawn } from "node:child_process";
import type { CompilerIndex } from "./types";
import type { FileConfig } from "../workspace/config";

let spawnCount = 0;

/**
 * Invoke the compiler in index mode for a single main file, return the parsed
 * JSON index.  Returns null on spawn failure, timeout, or JSON parse error.
 */
export function reindex(
  fileConfig: FileConfig,
  workspaceRoot: string,
  log: (msg: string) => void,
): Promise<CompilerIndex | null> {
  const label = path.basename(fileConfig.mainFile);

  const args: string[] = ["-y"];
  if (fileConfig.switches) args.push(...fileConfig.switches.trim().split(/\s+/));
  if (fileConfig.libraryPath) args.push(`+${fileConfig.libraryPath}`);
  for (const def of fileConfig.defines) {
    args.push("--define");
    args.push(def.includes("=") ? def : `${def}=1`);
  }
  args.push(fileConfig.mainFile);

  spawnCount += 1;
  log(`[indexer] spawning #${spawnCount} (${label}): ${fileConfig.compiler} ${args.join(" ")}`);

  return new Promise((resolve) => {
    const child = spawn(fileConfig.compiler, args, {
      cwd: workspaceRoot,
      env: process.env,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      child.kill();
      log(`[indexer] TIMEOUT (${label}): compiler did not finish within 10 s, killed`);
      resolve(null);
    }, 10_000);

    child.on("error", (err) => {
      clearTimeout(timer);
      log(`[indexer] FAILED to spawn compiler (${label}): ${err.message}`);
      log(`[indexer]   check that 'compiler' path in inform6rc.yaml is correct`);
      resolve(null);
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);

      if (signal) {
        // Killed by our timeout handler — already logged and resolved.
        return;
      }

      log(`[indexer] compiler exited with status ${String(code)} (${label})`);

      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      if (stderr) {
        for (const line of stderr.trimEnd().split("\n")) log(`[indexer] stderr: ${line}`);
      }

      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      if (!stdout) {
        log(`[indexer] FAILED (${label}): no JSON on stdout — compiler ran but produced no index`);
        resolve(null);
        return;
      }

      log(`[indexer] stdout: ${stdout.length} bytes (${label})`);

      try {
        const index = JSON.parse(stdout) as CompilerIndex;
        // Drop compiler-generated veneer routines — runtime support code that
        // the compiler injects with no corresponding source location.  They are
        // not user-callable and would clutter completions and workspace search.
        index.routines = index.routines.filter((r) => r.file);
        log(
          `[indexer] OK (${label}): ${index.routines.length} routines, ` +
            `${index.objects.length} objects, ${index.globals.length} globals, ` +
            `${index.constants.length} constants, ${index.errors.length} diagnostic(s)`,
        );
        resolve(index);
      } catch (e) {
        log(`[indexer] FAILED (${label}): JSON parse error: ${String(e)}`);
        log(`[indexer]   first 200 chars of stdout: ${stdout.slice(0, 200)}`);
        resolve(null);
      }
    });
  });
}

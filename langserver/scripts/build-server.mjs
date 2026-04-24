/**
 * Bundles the language server (src/server/main.ts) into a single CJS file
 * at bundled-server/server.cjs using esbuild.
 */
import esbuild from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const bundledRoot = path.join(root, "bundled-server");

await rm(bundledRoot, { recursive: true, force: true });
await mkdir(bundledRoot, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, "src", "server", "main.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outfile: path.join(bundledRoot, "server.cjs"),
  external: [],
  mainFields: ["main", "module"],
  resolveExtensions: [".ts", ".js", ".mjs"],
  logLevel: "info",
  minify: false,
  sourcemap: false,
});

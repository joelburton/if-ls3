import * as fs from "node:fs";
import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { URI } from "vscode-uri";
import type { Connection } from "vscode-languageserver";
import type { CompilerIndex } from "../server/types";
import type { Inform6Config } from "../workspace/config";

/**
 * Convert `index.errors` to LSP Diagnostics and push them via the connection.
 * Also warns on `#IfDef`/`#IfNDef` references to unknown constants.
 * Clears diagnostics for files that had errors last run but are clean now.
 *
 * Returns the set of file URIs that received diagnostics this run (so the
 * caller can pass it back in `previousUris` next time).
 */
export function pushDiagnostics(
  connection: Connection,
  index: CompilerIndex,
  previousUris: Set<string>,
  config: Inform6Config,
): Set<string> {
  const byUri = new Map<string, Diagnostic[]>();

  // --- Compiler errors ---
  for (const error of index.errors) {
    const uri = URI.file(error.file).toString();
    if (!byUri.has(uri)) byUri.set(uri, []);

    const severity =
      error.severity === "warning"
        ? DiagnosticSeverity.Warning
        : DiagnosticSeverity.Error;

    const line = Math.max(0, error.line - 1);
    byUri.get(uri)!.push({
      severity,
      range: {
        start: { line, character: 0 },
        end: { line, character: Number.MAX_SAFE_INTEGER },
      },
      message: error.message,
      source: "inform6",
    });
  }

  // --- #IfDef / #IfNDef unknown-constant warnings ---
  const knownNames = buildKnownNames(index, config);
  const libraryPath = config.libraryPath;

  for (const filePath of index.files) {
    // Skip library files — we only care about the user's project files.
    if (libraryPath && filePath.startsWith(libraryPath)) continue;

    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const warnings = scanIfDefWarnings(content, knownNames);
    if (warnings.length === 0) continue;

    const uri = URI.file(filePath).toString();
    if (!byUri.has(uri)) byUri.set(uri, []);
    byUri.get(uri)!.push(...warnings);
  }

  // --- Send and reconcile ---
  const currentUris = new Set(byUri.keys());

  for (const [uri, diagnostics] of byUri) {
    connection.sendDiagnostics({ uri, diagnostics });
  }

  for (const uri of previousUris) {
    if (!currentUris.has(uri)) {
      connection.sendDiagnostics({ uri, diagnostics: [] });
    }
  }

  return currentUris;
}

/**
 * Build the set of lowercase names that are "known" for #IfDef purposes:
 * every symbol the compiler defined, plus externalDefines from the config.
 */
function buildKnownNames(index: CompilerIndex, config: Inform6Config): Set<string> {
  const known = new Set<string>();
  for (const sym of index.symbols) known.add(sym.name.toLowerCase());
  for (const name of config.externalDefines) known.add(name.toLowerCase());
  return known;
}

/**
 * Scan source text for `#IfDef NAME` / `#IfNDef NAME` directives where NAME
 * is not in the known set.  Returns one Warning diagnostic per unknown name.
 */
function scanIfDefWarnings(content: string, knownNames: Set<string>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = /^\s*#(?:IfDef|IfNDef)\s+(\w+)/i.exec(line);
    if (!match) continue;

    const name = match[1];
    if (knownNames.has(name.toLowerCase())) continue;

    const nameStart = line.indexOf(name);
    diagnostics.push({
      severity: DiagnosticSeverity.Warning,
      range: {
        start: { line: i, character: nameStart },
        end: { line: i, character: nameStart + name.length },
      },
      message: `'${name}' is not a known constant — check spelling or add to externalDefines`,
      source: "inform6",
    });
  }

  return diagnostics;
}

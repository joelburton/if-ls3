import * as fs from "node:fs";
import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { URI } from "vscode-uri";
import type { Connection } from "vscode-languageserver";
import type { CompilerIndex } from "../server/types";
import type { FileConfig } from "../workspace/config";

export interface Compilation {
  fileConfig: FileConfig;
  index: CompilerIndex;
}

/**
 * Convert compiler errors and #IfDef warnings to LSP Diagnostics and push
 * them via the connection.  Clears diagnostics for files that were affected
 * last run but are clean now.
 *
 * Returns the set of file URIs that received diagnostics this run.
 */
export function pushDiagnostics(
  connection: Connection,
  compilations: Compilation[],
  previousUris: Set<string>,
): Set<string> {
  const byUri = new Map<string, Diagnostic[]>();
  const fileLines = new Map<string, string[]>();  // path → lines cache

  // --- Compiler errors (from all compilations) ---
  for (const { index } of compilations) {
    for (const error of index.errors) {
      const uri = URI.file(error.file).toString();
      if (!byUri.has(uri)) byUri.set(uri, []);

      const severity =
        error.severity === "warning"
          ? DiagnosticSeverity.Warning
          : DiagnosticSeverity.Error;

      const line = Math.max(0, error.line - 1);

      // Try to narrow the squiggle to just the quoted name in the error
      // message (e.g. 'No such constant as "FoodFood"') rather than the
      // whole line.
      let startChar = 0;
      let endChar = Number.MAX_SAFE_INTEGER;
      const nameMatch = /"([^"]+)"/.exec(error.message);
      if (nameMatch) {
        if (!fileLines.has(error.file)) {
          try {
            fileLines.set(error.file, fs.readFileSync(error.file, "utf-8").split("\n"));
          } catch {
            fileLines.set(error.file, []);
          }
        }
        const srcLine = fileLines.get(error.file)![line] ?? "";
        const col = srcLine.indexOf(nameMatch[1]);
        if (col !== -1) {
          startChar = col;
          endChar = col + nameMatch[1].length;
        }
      }

      byUri.get(uri)!.push({
        severity,
        range: {
          start: { line, character: startChar },
          end: { line, character: endChar },
        },
        message: error.message,
        source: "inform6",
      });
    }
  }

  // --- #IfDef / #IfNDef unknown-constant warnings ---
  //
  // "Known" = appears in ANY compilation's symbol table OR in any
  // compilation's externalDefines.  A name known in at least one
  // compilation is intentional; we only warn when it's unknown everywhere.
  const knownNames = buildUnionKnownNames(compilations);

  // Collect all library paths so we can skip library files.
  const libraryPaths = compilations
    .map(c => c.fileConfig.libraryPath)
    .filter(Boolean);

  // Scan each project file once (skip duplicates across compilations).
  const scanned = new Set<string>();
  for (const { index } of compilations) {
    for (const filePath of index.files) {
      if (scanned.has(filePath)) continue;
      scanned.add(filePath);

      if (libraryPaths.some(lp => filePath.startsWith(lp))) continue;

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
  }

  // --- Send and reconcile stale URIs ---
  const currentUris = new Set(byUri.keys());

  for (const [uri, diagnostics] of byUri)
    connection.sendDiagnostics({ uri, diagnostics });

  for (const uri of previousUris) {
    if (!currentUris.has(uri))
      connection.sendDiagnostics({ uri, diagnostics: [] });
  }

  return currentUris;
}

/**
 * Build a set of lowercase names that are "known" for #IfDef purposes across
 * all compilations: every symbol the compiler defined in any compilation, plus
 * every externalDefines entry from any compilation's config.
 */
export function buildUnionKnownNames(compilations: Compilation[]): Set<string> {
  const known = new Set<string>();
  for (const { index, fileConfig } of compilations) {
    for (const sym of index.symbols) known.add(sym.name.toLowerCase());
    for (const name of fileConfig.externalDefines) known.add(name.toLowerCase());
  }
  return known;
}

/**
 * Scan source text for `#IfDef NAME` / `#IfNDef NAME` directives where NAME
 * is not in the known set.  Returns one Warning diagnostic per unknown name.
 */
export function scanIfDefWarnings(content: string, knownNames: Set<string>): Diagnostic[] {
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

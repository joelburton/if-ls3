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
  const fileLines = new Map<string, string[]>(); // path → lines cache

  // Read a file's lines once and cache. Logs (but does not throw) on failure
  // so a missing file degrades to an empty array — diagnostics still flow,
  // just without source-line context for that file.
  const getCachedLines = (file: string): string[] => {
    let cached = fileLines.get(file);
    if (cached !== undefined) return cached;
    try {
      cached = fs.readFileSync(file, "utf-8").split("\n");
    } catch (e) {
      connection.console.warn(`[diagnostics] could not read ${file}: ${e}`);
      cached = [];
    }
    fileLines.set(file, cached);
    return cached;
  };

  // --- Compiler errors (from all compilations) ---
  for (const { index } of compilations) {
    for (const error of index.errors) {
      const uri = URI.file(error.file).toString();
      if (!byUri.has(uri)) byUri.set(uri, []);

      const severity = error.severity === "warning" ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error;

      const line = Math.max(0, error.line - 1);

      // Try to narrow the squiggle to just the quoted name in the error
      // message (e.g. 'No such constant as "FoodFood"') rather than the
      // whole line.
      let startChar = 0;
      let endChar = Number.MAX_SAFE_INTEGER;
      const nameMatch = /"([^"]+)"/.exec(error.message);
      if (nameMatch) {
        const srcLine = getCachedLines(error.file)[line] ?? "";
        // indexOf finds the first occurrence; may squiggle the wrong token if
        // the name appears more than once on the line. Acceptable for now.
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
  // The Inform 6 compiler silently accepts any name in #IfDef/#IfNDef, even
  // typos, because an unknown constant is treated as 0 (false).  We catch
  // this class of mistake here by scanning raw source text and checking every
  // conditional-compilation name against the union of known symbols.
  //
  // "Known" = appears in ANY compilation's symbol table OR in any
  // compilation's externalDefines.  A name known in at least one
  // compilation is intentional; we only warn when it's unknown everywhere.
  const knownNames = buildUnionKnownNames(compilations);

  // Collect all library paths so we can skip library files.
  const libraryPaths = compilations.map((c) => c.fileConfig.libraryPath).filter(Boolean);

  // Scan each project file once (skip duplicates across compilations).
  const scanned = new Set<string>();
  for (const { index } of compilations) {
    for (const filePath of index.files) {
      if (scanned.has(filePath)) continue;
      scanned.add(filePath);

      if (libraryPaths.some((lp) => filePath.startsWith(lp))) continue;

      const lines = getCachedLines(filePath);
      if (lines.length === 0) continue;

      const warnings = scanIfDefWarnings(lines.join("\n"), knownNames);
      if (warnings.length === 0) continue;

      const uri = URI.file(filePath).toString();
      if (!byUri.has(uri)) byUri.set(uri, []);
      byUri.get(uri)!.push(...warnings);
    }
  }

  // --- Undeclared-property warnings ---
  for (const { index, fileConfig } of compilations) {
    if (!fileConfig.warnUndeclaredProperties) continue;

    for (const [filePath, diags] of collectUndeclaredPropertyWarnings(index, getCachedLines)) {
      const uri = URI.file(filePath).toString();
      if (!byUri.has(uri)) byUri.set(uri, []);
      byUri.get(uri)!.push(...diags);
    }
  }

  // --- Send and reconcile stale URIs ---
  const currentUris = new Set(byUri.keys());

  for (const [uri, diagnostics] of byUri) connection.sendDiagnostics({ uri, diagnostics });

  for (const uri of previousUris) {
    if (!currentUris.has(uri)) connection.sendDiagnostics({ uri, diagnostics: [] });
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
 * Find all informal property declarations in `index` and return diagnostics
 * grouped by file path.  A property is "informal" when `formal_declaration` is
 * `false` — it was created implicitly on first use inside an object `with`
 * block rather than via an explicit `Property` directive.
 *
 * `getLines(file)` should return the source lines for a given file (or [] if
 * unavailable); it is used for column narrowing and to detect the
 * `! Pragma:Prop` inline suppression marker.
 */
export function collectUndeclaredPropertyWarnings(
  index: CompilerIndex,
  getLines: (file: string) => string[],
): Map<string, Diagnostic[]> {
  const byFile = new Map<string, Diagnostic[]>();

  const informalProps = new Set(
    index.symbols
      .filter(
        (s) =>
          (s.type === "property" || s.type === "individual_property") && !s.is_system && s.formal_declaration === false,
      )
      .map((s) => s.name),
  );
  if (informalProps.size === 0) return byFile;

  for (const obj of index.objects) {
    for (const prop of [...obj.properties, ...obj.private_properties]) {
      if (!informalProps.has(prop.name)) continue;

      const line = Math.max(0, prop.line - 1);
      const srcLine = getLines(obj.file)[line] ?? "";
      if (srcLine.includes("Pragma:Prop")) continue;

      if (!byFile.has(obj.file)) byFile.set(obj.file, []);
      const col = srcLine.indexOf(prop.name);
      const startChar = col !== -1 ? col : 0;
      const endChar = col !== -1 ? col + prop.name.length : Number.MAX_SAFE_INTEGER;

      byFile.get(obj.file)!.push({
        severity: DiagnosticSeverity.Warning,
        range: {
          start: { line, character: startChar },
          end: { line, character: endChar },
        },
        message: `'${prop.name}' is not formally declared — consider adding 'Property ${prop.name};' or 'Property individual ${prop.name};'`,
        source: "inform6",
      });
    }
  }

  return byFile;
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

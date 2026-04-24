import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { URI } from "vscode-uri";
import type { Connection } from "vscode-languageserver";
import type { CompilerIndex } from "../server/types";

/**
 * Convert `index.errors` to LSP Diagnostics and push them via the connection.
 * Clears diagnostics for files that had errors last run but are clean now.
 *
 * Returns the set of file URIs that received diagnostics this run (so the
 * caller can pass it back in `previousUris` next time).
 */
export function pushDiagnostics(
  connection: Connection,
  index: CompilerIndex,
  previousUris: Set<string>,
): Set<string> {
  const byUri = new Map<string, Diagnostic[]>();

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

  const currentUris = new Set(byUri.keys());

  for (const [uri, diagnostics] of byUri) {
    connection.sendDiagnostics({ uri, diagnostics });
  }

  // Clear stale diagnostics from files that are clean now.
  for (const uri of previousUris) {
    if (!currentUris.has(uri)) {
      connection.sendDiagnostics({ uri, diagnostics: [] });
    }
  }

  return currentUris;
}

import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
  InitializeResult,
  DefinitionParams,
  HoverParams,
  DocumentSymbolParams,
  WorkspaceSymbolParams,
  CompletionParams,
  SemanticTokensParams,
  ReferenceParams,
} from "vscode-languageserver/node";
import * as path from "node:path";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import type { CompilerIndex } from "./types";
import { loadConfig, type WorkspaceConfig } from "../workspace/config";
import { reindex } from "./indexer";
import { pushDiagnostics, type Compilation } from "../features/diagnostics";
import { findDefinition, includeAtLine } from "../features/definition";
import { enclosingObject, loc } from "../features/symbolLookup";
import { findHover, findIncludeHover } from "../features/hover";
import { getDocumentSymbols } from "../features/documentSymbols";
import { getWorkspaceSymbols } from "../features/workspaceSymbols";
import { getCompletions } from "../features/completions";
import { wordAtPosition, objectBeforeDot, classBeforeColonColon, isInComment } from "../features/wordAtPosition";
import { getSemanticTokens } from "../features/semanticTokens";
import { findReferences, refAtPosition } from "../features/references";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let workspaceRoot: string | null = null;
let workspaceConfig: WorkspaceConfig | null = null;
let currentIndices: Compilation[] = [];
let previousDiagnosticUris = new Set<string>();

function log(msg: string): void {
  connection.console.log(msg);
}

/**
 * Return the best index for a given document URI: the first compilation whose
 * file list includes this document.  Falls back to the first available index.
 */
function indexForDocument(documentUri: string): CompilerIndex | null {
  const filePath = URI.parse(documentUri).fsPath;
  const hit = currentIndices.find((c) => c.index.files.includes(filePath));
  return hit?.index ?? currentIndices[0]?.index ?? null;
}


connection.onInitialize((params: InitializeParams): InitializeResult => {
  workspaceRoot = params.rootUri ? URI.parse(params.rootUri).fsPath : null;
  if (workspaceRoot) {
    workspaceConfig = loadConfig(workspaceRoot);
    if (!workspaceConfig) {
      log("[server] no inform6rc.yaml found — language server features disabled");
    } else if (workspaceConfig.files.length === 0) {
      log("[server] inform6rc.yaml has no main-file entries — nothing to compile");
    } else {
      const names = workspaceConfig.files.map((f) => path.basename(URI.file(f.mainFile).fsPath)).join(", ");
      log(`[server] config: ${workspaceConfig.files.length} main file(s): ${names}`);
    }
  }

  return {
    capabilities: {
      textDocumentSync: {
        openClose: true,
        save: true,
        change: TextDocumentSyncKind.Incremental,
      },
      definitionProvider: true,
      referencesProvider: true,
      hoverProvider: true,
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
      completionProvider: {
        triggerCharacters: ["."],
      },
      semanticTokensProvider: {
        legend: {
          tokenTypes: ["variable", "property", "enumMember"],
          tokenModifiers: [],
        },
        full: true,
      },
    },
  };
});

connection.onInitialized(async () => {
  await triggerReindex();
});

async function triggerReindex(): Promise<void> {
  if (!workspaceConfig || !workspaceRoot) return;
  if (workspaceConfig.files.length === 0) return;

  // Run all compilations in parallel.
  const results = await Promise.all(workspaceConfig.files.map((fc) => reindex(fc, workspaceRoot!, log)));

  currentIndices = [];
  for (let i = 0; i < workspaceConfig.files.length; i++) {
    const index = results[i];
    if (index) currentIndices.push({ fileConfig: workspaceConfig.files[i], index });
  }

  if (currentIndices.length > 0) {
    previousDiagnosticUris = pushDiagnostics(connection, currentIndices, previousDiagnosticUris);
    connection.sendNotification("inform6/indexUpdated");
  }
}

documents.onDidSave(async (change) => {
  const uri = change.document.uri;
  if (uri.endsWith(".inf") || uri.endsWith(".h")) {
    await triggerReindex();
  }
});

documents.onDidOpen(async () => {
  if (currentIndices.length === 0) await triggerReindex();
});

connection.onDefinition((params: DefinitionParams) => {
  const index = indexForDocument(params.textDocument.uri);
  if (!index) return null;

  const filePath = URI.parse(params.textDocument.uri).fsPath;
  const fileIndex = index.files.indexOf(filePath);
  if (fileIndex === -1) return null;

  const line1 = params.position.line + 1;

  // Include directive: cursor on an Include "..." line → navigate to the file.
  const inc = includeAtLine(index, filePath, line1);
  if (inc) return loc(inc.resolved, 1);

  const ref = refAtPosition(index, fileIndex, line1, params.position.character);

  // Extract word and object/class context from source text — needed for both
  // the self-navigation case and ObjName.prop / ClassName::prop context.
  const doc = documents.get(params.textDocument.uri);
  const hit = doc ? wordAtPosition(doc.getText(), params.position) : null;
  const rawCtx = hit
    ? (objectBeforeDot(hit.lineText, hit.start) ?? classBeforeColonColon(hit.lineText, hit.start))
    : null;
  // Resolve "self" in the object context to the actual enclosing object name.
  const objCtx =
    rawCtx?.toLowerCase() === "self"
      ? (enclosingObject(index, filePath, line1)?.name ?? rawCtx)
      : rawCtx;

  if (!ref) {
    // "self" with no compiler ref: navigate to the enclosing object.
    if (hit?.word.toLowerCase() === "self") {
      const obj = enclosingObject(index, filePath, line1);
      if (obj) return findDefinition(index, obj.name, null);
    }
    return null;
  }

  // If the ref symbol is "self", resolve it to the enclosing object name.
  const sym =
    ref.sym.toLowerCase() === "self"
      ? (enclosingObject(index, filePath, line1)?.name ?? ref.sym)
      : ref.sym;

  const isAction = ref.type === "action";
  return findDefinition(index, sym, objCtx, isAction, isAction);
});

connection.onReferences((params: ReferenceParams) => {
  const index = indexForDocument(params.textDocument.uri);
  if (!index) return [];
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];

  const hit = wordAtPosition(doc.getText(), params.position);
  if (!hit) return [];
  if (isInComment(hit.lineText, hit.start)) return [];

  return findReferences(index, hit.word);
});

connection.onHover((params: HoverParams) => {
  const index = indexForDocument(params.textDocument.uri);
  if (!index) return null;
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const filePath = URI.parse(params.textDocument.uri).fsPath;
  const line1 = params.position.line + 1;

  // Include directive: cursor on an Include "..." line → show resolved path.
  const incHover = includeAtLine(index, filePath, line1);
  if (incHover) return findIncludeHover(incHover, workspaceRoot ?? "");

  // If the cursor is on a compiler-tracked reference, use the exact symbol
  // name directly — no comment check or word-boundary heuristics needed.
  const fileIndex = index.files.indexOf(filePath);
  if (fileIndex !== -1) {
    const ref = refAtPosition(index, fileIndex, line1, params.position.character);
    if (ref) {
      const hit = wordAtPosition(doc.getText(), params.position);
      const rawCtx = hit
        ? (objectBeforeDot(hit.lineText, hit.start) ?? classBeforeColonColon(hit.lineText, hit.start))
        : null;
      // Resolve "self" in context and in the symbol name itself.
      const objCtx =
        rawCtx?.toLowerCase() === "self"
          ? (enclosingObject(index, filePath, line1)?.name ?? rawCtx)
          : rawCtx;
      const sym =
        ref.sym.toLowerCase() === "self"
          ? (enclosingObject(index, filePath, line1)?.name ?? ref.sym)
          : ref.sym;
      return findHover(index, sym, workspaceRoot ?? "", undefined, undefined, filePath, line1, objCtx);
    }
  }

  // Fall through to heuristic path for keywords, directives, local variables,
  // and print rules — none of which appear in references[].
  // Symbol lookups are skipped (skipSymbols=true) so that words inside string
  // literals don't produce false-positive symbol hover.
  const hit = wordAtPosition(doc.getText(), params.position);
  if (!hit) return null;
  if (isInComment(hit.lineText, hit.start)) return null;

  // "self" inside an object body hovers as the enclosing object.
  if (hit.word.toLowerCase() === "self") {
    const obj = enclosingObject(index, filePath, line1);
    if (obj) return findHover(index, obj.name, workspaceRoot ?? "");
  }

  return findHover(index, hit.word, workspaceRoot ?? "", hit.lineText, hit.start, filePath, line1, undefined, true);
});

connection.onDocumentSymbol((params: DocumentSymbolParams) => {
  const index = indexForDocument(params.textDocument.uri);
  if (!index) return [];
  return getDocumentSymbols(index, params.textDocument.uri);
});

connection.onWorkspaceSymbol((params: WorkspaceSymbolParams) => {
  if (currentIndices.length === 0) return [];
  return getWorkspaceSymbols(
    currentIndices.map((c) => c.index),
    params.query,
  );
});

connection.onCompletion((params: CompletionParams) => {
  const index = indexForDocument(params.textDocument.uri);
  if (!index) return null;
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const lines = doc.getText().split("\n");
  const lineText = lines[params.position.line] ?? "";
  if (isInComment(lineText, params.position.character)) return null;
  const filePath = URI.parse(params.textDocument.uri).fsPath;
  return getCompletions(index, filePath, params.position, lineText);
});

connection.languages.semanticTokens.on((params: SemanticTokensParams) => {
  const index = indexForDocument(params.textDocument.uri);
  if (!index) return { data: [] };
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return { data: [] };
  const filePath = URI.parse(params.textDocument.uri).fsPath;
  return { data: getSemanticTokens(index, filePath, doc.getText()) };
});

documents.listen(connection);
connection.listen();

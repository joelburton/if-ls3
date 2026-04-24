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
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import type { CompilerIndex } from "./types";
import { loadConfig, type WorkspaceConfig } from "../workspace/config";
import { reindex } from "./indexer";
import { pushDiagnostics, type Compilation } from "../features/diagnostics";
import { findDefinition } from "../features/definition";
import { findHover } from "../features/hover";
import { getDocumentSymbols } from "../features/documentSymbols";
import { getWorkspaceSymbols } from "../features/workspaceSymbols";
import { getCompletions } from "../features/completions";
import { wordAtPosition, objectBeforeDot } from "../features/wordAtPosition";
import { getSemanticTokens } from "../features/semanticTokens";

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
  const hit = currentIndices.find(c => c.index.files.includes(filePath));
  return hit?.index ?? currentIndices[0]?.index ?? null;
}

/**
 * Build a Set of "filePath:lineNumber" (1-based) strings from the compiler's
 * grammar_action_refs list.  Used to distinguish grammar-arrow -> from
 * array-operator -> and property-access ->.
 */
function buildGrammarActionPositions(index: CompilerIndex): Set<string> {
  const set = new Set<string>();
  for (const ref of index.grammar_action_refs ?? []) {
    set.add(`${ref.file}:${ref.line}`);
  }
  return set;
}

/**
 * Returns true if `word` at `wordStart` is an action name following `->` in a
 * Verb directive grammar line (e.g. `* noun -> Foozle`).
 */
function isActionArrow(
  line: string,
  wordStart: number,
  lineNumber: number,
  filePath: string,
  grammarActionPositions: Set<string>,
): boolean {
  let i = wordStart - 1;
  while (i >= 0 && (line[i] === " " || line[i] === "\t")) i--;
  if (!(i >= 1 && line[i] === ">" && line[i - 1] === "-")) return false;
  return grammarActionPositions.has(`${filePath}:${lineNumber + 1}`);
}

/**
 * Returns true if `word` at `wordStart` is the action name in `<Word ...>` or
 * `<<Word ...>>`.
 */
function isActionAngleBracket(line: string, wordStart: number): boolean {
  if (wordStart === 0 || line[wordStart - 1] !== "<") return false;
  const isIdChar = (c: string) => /\w/.test(c);
  const ltPos = wordStart - 1;
  const beforeLt = ltPos > 0 ? line[ltPos - 1] : "";
  if (isIdChar(beforeLt)) return false;
  if (beforeLt === "<") {
    const beforeLtLt = ltPos > 1 ? line[ltPos - 2] : "";
    return !isIdChar(beforeLtLt);
  }
  return true;
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
      const names = workspaceConfig.files.map(f => URI.file(f.mainFile).fsPath.split("/").pop()).join(", ");
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
  const results = await Promise.all(
    workspaceConfig.files.map(fc => reindex(fc, workspaceRoot!, log)),
  );

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
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const hit = wordAtPosition(doc.getText(), params.position);
  if (!hit) return null;

  const objCtx = objectBeforeDot(hit.lineText, hit.start);
  const filePath = URI.parse(params.textDocument.uri).fsPath;
  const grammarActionPositions = buildGrammarActionPositions(index);
  const isActionRef = hit.lineText[hit.end] === ":"
    || (hit.start >= 2 && hit.lineText[hit.start - 1] === "#" && hit.lineText[hit.start - 2] === "#")
    || isActionAngleBracket(hit.lineText, hit.start)
    || isActionArrow(hit.lineText, hit.start, params.position.line, filePath, grammarActionPositions);
  return findDefinition(index, hit.word, objCtx, isActionRef);
});

connection.onHover((params: HoverParams) => {
  const index = indexForDocument(params.textDocument.uri);
  if (!index) return null;
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const hit = wordAtPosition(doc.getText(), params.position);
  if (!hit) return null;

  return findHover(index, hit.word, workspaceRoot ?? "");
});

connection.onDocumentSymbol((params: DocumentSymbolParams) => {
  const index = indexForDocument(params.textDocument.uri);
  if (!index) return [];
  return getDocumentSymbols(index, params.textDocument.uri);
});

connection.onWorkspaceSymbol((params: WorkspaceSymbolParams) => {
  if (currentIndices.length === 0) return [];
  return getWorkspaceSymbols(currentIndices.map(c => c.index), params.query);
});

connection.onCompletion((params: CompletionParams) => {
  const index = indexForDocument(params.textDocument.uri);
  if (!index) return null;
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const lines = doc.getText().split("\n");
  const lineText = lines[params.position.line] ?? "";
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

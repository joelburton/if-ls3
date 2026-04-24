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
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import type { CompilerIndex } from "./types";
import { loadConfig, type Inform6Config } from "../workspace/config";
import { reindex } from "./indexer";
import { pushDiagnostics } from "../features/diagnostics";
import { findDefinition } from "../features/definition";
import { findHover } from "../features/hover";
import { getDocumentSymbols } from "../features/documentSymbols";
import { getWorkspaceSymbols } from "../features/workspaceSymbols";
import { getCompletions } from "../features/completions";
import { wordAtPosition, objectBeforeDot } from "../features/wordAtPosition";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let workspaceRoot: string | null = null;
let config: Inform6Config | null = null;
let currentIndex: CompilerIndex | null = null;
let previousDiagnosticUris = new Set<string>();

function log(msg: string): void {
  connection.console.log(msg);
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
 *
 * Requires `grammarActionPositions` (built from the compiler's
 * `grammar_action_refs` list) so that array-operator `->` (e.g.
 * `Array x --> Foozle`) and property-access `obj->prop` are NOT matched.
 */
function isActionArrow(
  line: string,
  wordStart: number,
  lineNumber: number,
  filePath: string,
  grammarActionPositions: Set<string>,
): boolean {
  // Quick syntactic pre-check: must be preceded by ->
  let i = wordStart - 1;
  while (i >= 0 && (line[i] === " " || line[i] === "\t")) i--;
  if (!(i >= 1 && line[i] === ">" && line[i - 1] === "-")) return false;
  // Confirm via compiler data: only true when the compiler recorded this
  // file+line as a grammar-line action reference.
  return grammarActionPositions.has(`${filePath}:${lineNumber + 1}`);
}

/**
 * Returns true if `word` at `wordStart` is the action name in `<Word ...>` or
 * `<<Word ...>>`. Distinguished from comparison expressions (e.g. `x<a`) by
 * checking that the character immediately before the `<` is not an identifier
 * character — action statements begin at whitespace or start-of-line.
 */
function isActionAngleBracket(line: string, wordStart: number): boolean {
  if (wordStart === 0 || line[wordStart - 1] !== "<") return false;
  const isIdChar = (c: string) => /\w/.test(c);
  const ltPos = wordStart - 1;
  const beforeLt = ltPos > 0 ? line[ltPos - 1] : "";
  if (isIdChar(beforeLt)) return false;          // x<Word — comparison
  if (beforeLt === "<") {                         // <<Word
    const beforeLtLt = ltPos > 1 ? line[ltPos - 2] : "";
    return !isIdChar(beforeLtLt);
  }
  return true;                                    // <Word
}

connection.onInitialize((params: InitializeParams): InitializeResult => {
  workspaceRoot = params.rootUri ? URI.parse(params.rootUri).fsPath : null;
  if (workspaceRoot) {
    config = loadConfig(workspaceRoot);
    if (!config) {
      log("[server] no inform6rc.yaml found — language server features disabled");
    } else {
      log(`[server] config: compiler=${config.compiler} lib=${config.libraryPath} main=${config.mainFile}`);
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
    },
  };
});

connection.onInitialized(async () => {
  await triggerReindex();
});

async function triggerReindex(): Promise<void> {
  if (!config || !workspaceRoot) return;
  const idx = await reindex(config, workspaceRoot, log);
  if (idx) {
    currentIndex = idx;
    previousDiagnosticUris = pushDiagnostics(connection, currentIndex, previousDiagnosticUris, config);
    // VS Code only re-requests document symbols on content change, not on save.
    // Notify the client so it can explicitly refresh the outline.
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
  if (!currentIndex) await triggerReindex();
});

connection.onDefinition((params: DefinitionParams) => {
  if (!currentIndex) return null;
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const hit = wordAtPosition(doc.getText(), params.position);
  if (!hit) return null;

  const objCtx = objectBeforeDot(hit.lineText, hit.start);
  // Action label:     Jump:      colon immediately after identifier
  // Action value:     ##Jump     ## immediately before identifier
  // Action statement: <Jump ...> or <<Jump ...>>
  //   Distinguished from comparisons (x<a) by checking the char before < is not
  //   an identifier character — statements start at whitespace/line-start.
  // Grammar arrow:    * noun -> Foozle   (compiler-verified: checks grammar_action_refs)
  const filePath = URI.parse(params.textDocument.uri).fsPath;
  const grammarActionPositions = buildGrammarActionPositions(currentIndex);
  const isActionRef = hit.lineText[hit.end] === ":"
    || (hit.start >= 2 && hit.lineText[hit.start - 1] === "#" && hit.lineText[hit.start - 2] === "#")
    || isActionAngleBracket(hit.lineText, hit.start)
    || isActionArrow(hit.lineText, hit.start, params.position.line, filePath, grammarActionPositions);
  return findDefinition(currentIndex, hit.word, objCtx, isActionRef);
});

connection.onHover((params: HoverParams) => {
  if (!currentIndex) return null;
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const hit = wordAtPosition(doc.getText(), params.position);
  if (!hit) return null;

  return findHover(currentIndex, hit.word, workspaceRoot ?? "");
});

connection.onDocumentSymbol((params: DocumentSymbolParams) => {
  if (!currentIndex) return [];
  return getDocumentSymbols(currentIndex, params.textDocument.uri);
});

connection.onWorkspaceSymbol((params: WorkspaceSymbolParams) => {
  if (!currentIndex) return [];
  return getWorkspaceSymbols(currentIndex, params.query);
});

connection.onCompletion((params: CompletionParams) => {
  if (!currentIndex) return null;
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const lines = doc.getText().split("\n");
  const lineText = lines[params.position.line] ?? "";
  const filePath = URI.parse(params.textDocument.uri).fsPath;
  return getCompletions(currentIndex, filePath, params.position, lineText);
});

documents.listen(connection);
connection.listen();

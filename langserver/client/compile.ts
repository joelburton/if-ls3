import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { loadConfig } from "../src/workspace/config";
import type { FileConfig } from "../src/workspace/config";

// Matches "-E1" Microsoft-format lines: /abs/path/file(line): Error:  message
const DIAG_RE = /^(.+)\((\d+)\):\s+(Error|Warning):\s+(.*)$/;

export interface ParseResult {
  byFile: Map<string, vscode.Diagnostic[]>;
  first: { uri: vscode.Uri; range: vscode.Range } | null;
}

export function parseDiagnostics(stderr: string): ParseResult {
  const byFile = new Map<string, vscode.Diagnostic[]>();
  let first: ParseResult["first"] = null;
  for (const line of stderr.split("\n")) {
    const m = DIAG_RE.exec(line);
    if (!m) continue;
    const [, file, lineStr, severity, message] = m;
    const lineNum = parseInt(lineStr) - 1; // VS Code is 0-based
    const range = new vscode.Range(lineNum, 0, lineNum, Number.MAX_SAFE_INTEGER);
    const diag = new vscode.Diagnostic(
      range,
      message.trim(),
      severity === "Error" ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning,
    );
    diag.source = "inform6-compile";
    const list = byFile.get(file) ?? [];
    list.push(diag);
    byFile.set(file, list);
    if (!first) first = { uri: vscode.Uri.file(file), range };
  }
  return { byFile, first };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type TargetItem = vscode.QuickPickItem & { fileConfig: FileConfig };

/** Show the quick-pick and return the chosen FileConfig, or undefined if cancelled. */
async function pickTarget(workspaceRoot: string): Promise<FileConfig | undefined> {
  const compilerPath = vscode.workspace.getConfiguration("inform6").get<string>("compilerPath", "inform6");
  let configError: string | null = null;
  const config = loadConfig(workspaceRoot, compilerPath, (msg) => {
    configError = msg;
  });
  if (!config || config.files.length === 0) {
    void vscode.window.showErrorMessage(
      configError ? `Inform 6: ${configError}` : "Inform 6: no targets found in inform6rc.yaml.",
    );
    return undefined;
  }

  const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
  const items: TargetItem[] = config.files.map((fc) => ({
    label: path.basename(fc.mainFile),
    description: fc.mainFile,
    fileConfig: fc,
  }));

  const qp = vscode.window.createQuickPick<TargetItem>();
  qp.title = "Compile Inform 6";
  qp.placeholder = "Select target to compile";
  qp.items = items;
  const preselect = items.find((it) => it.fileConfig.mainFile === activeFile);
  if (preselect) qp.activeItems = [preselect];
  qp.show();

  return new Promise<FileConfig | undefined>((resolve) => {
    qp.onDidAccept(() => {
      resolve(qp.selectedItems[0]?.fileConfig);
      qp.dispose();
    });
    qp.onDidHide(() => {
      resolve(undefined);
      qp.dispose();
    });
  });
}

interface CompileResult {
  errors: number;
  warnings: number;
  first: ParseResult["first"];
}

/**
 * Spawn the compiler, collect stderr, push diagnostics, write to output channel.
 * Returns null if the compiler could not be launched.
 */
async function compileTarget(
  fc: FileConfig,
  workspaceRoot: string,
  label: string,
  progressTitle: string,
  outputChannel: vscode.OutputChannel,
  diagCollection: vscode.DiagnosticCollection,
): Promise<CompileResult | null> {
  const args: string[] = ["-E1", "-q2"];
  if (fc.switches) args.push(...fc.switches.trim().split(/\s+/));
  if (fc.libraryPath) args.push(`+${fc.libraryPath}`);
  for (const def of fc.defines) {
    args.push("--define");
    args.push(def.includes("=") ? def : `${def}=1`);
  }
  args.push(fc.mainFile);

  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: progressTitle, cancellable: false },
    () =>
      new Promise<CompileResult | null>((resolve) => {
        const child = spawn(fc.compiler, args, { cwd: workspaceRoot, env: process.env });

        const stderrChunks: Buffer[] = [];
        child.stdout?.on("data", () => {
          /* -q2 suppresses stdout */
        });
        child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

        child.on("error", (err) => {
          void vscode.window.showErrorMessage(`Inform 6: failed to launch compiler: ${err.message}`);
          resolve(null);
        });

        child.on("close", (code) => {
          const stderr = Buffer.concat(stderrChunks).toString("utf-8");
          const lines = stderr.split("\n");
          const errors = lines.filter((l) => /:\s+Error:\s/.test(l)).length;
          const warnings = lines.filter((l) => /:\s+Warning:\s/.test(l)).length;

          const { byFile, first } = parseDiagnostics(stderr);
          for (const [file, diags] of byFile) {
            diagCollection.set(vscode.Uri.file(file), diags);
          }

          if (errors > 0 || warnings > 0) {
            outputChannel.appendLine(`\n[compile] ${label}`);
            for (const line of lines) {
              if (line.trim() && !line.startsWith(">")) outputChannel.appendLine(line);
            }
          }

          resolve({ errors, warnings, first });
          void code; // exit code covered by error/warning counts
        });
      }),
  );
}

function showCompileToast(label: string, result: CompileResult, outputChannel: vscode.OutputChannel): void {
  const { errors, warnings } = result;
  const detail = [
    errors > 0 ? `${errors} error${errors === 1 ? "" : "s"}` : "",
    warnings > 0 ? `${warnings} warning${warnings === 1 ? "" : "s"}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  if (errors > 0) {
    void vscode.window.showErrorMessage(`Inform 6: ${label} — ${detail}.`, "Show Output").then((a) => {
      if (a) outputChannel.show();
    });
  } else if (warnings > 0) {
    void vscode.window.showWarningMessage(`Inform 6: ${label} — ${detail}.`, "Show Output").then((a) => {
      if (a) outputChannel.show();
    });
  } else {
    void vscode.window.showInformationMessage(`Inform 6: ${label} compiled successfully.`);
  }
}

function jumpToFirst(first: ParseResult["first"]): void {
  if (!first) return;
  void vscode.workspace
    .openTextDocument(first.uri)
    .then((doc) => vscode.window.showTextDocument(doc, { selection: first!.range, preserveFocus: false }));
}

// ---------------------------------------------------------------------------
// Story file detection
// ---------------------------------------------------------------------------

const STORY_EXTENSIONS = [".ulx", ".z8", ".z5", ".z3", ".z6", ".z4", ".z7"];

function findStoryFile(mainFile: string): vscode.Uri | null {
  const dir = path.dirname(mainFile);
  const base = path.basename(mainFile, path.extname(mainFile));
  for (const ext of STORY_EXTENSIONS) {
    const candidate = path.join(dir, base + ext);
    if (fs.existsSync(candidate)) return vscode.Uri.file(candidate);
  }
  return null;
}

function storyViewColumn(): vscode.ViewColumn {
  const col = vscode.workspace.getConfiguration("inform6").get<string>("storyPlayerColumn", "beside");
  switch (col) {
    case "active":
      return vscode.ViewColumn.Active;
    case "one":
      return vscode.ViewColumn.One;
    case "two":
      return vscode.ViewColumn.Two;
    case "three":
      return vscode.ViewColumn.Three;
    case "four":
      return vscode.ViewColumn.Four;
    case "five":
      return vscode.ViewColumn.Five;
    case "six":
      return vscode.ViewColumn.Six;
    case "seven":
      return vscode.ViewColumn.Seven;
    case "eight":
      return vscode.ViewColumn.Eight;
    case "nine":
      return vscode.ViewColumn.Nine;
    default:
      return vscode.ViewColumn.Beside;
  }
}

// ---------------------------------------------------------------------------
// Exported commands
// ---------------------------------------------------------------------------

export async function compileCommand(
  outputChannel: vscode.OutputChannel,
  diagCollection: vscode.DiagnosticCollection,
): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    void vscode.window.showErrorMessage("Inform 6: no workspace folder open.");
    return;
  }

  const fc = await pickTarget(workspaceRoot);
  if (!fc) return;

  diagCollection.clear();
  const label = path.basename(fc.mainFile);
  const result = await compileTarget(fc, workspaceRoot, label, `Compiling ${label}…`, outputChannel, diagCollection);
  if (!result) return;

  showCompileToast(label, result, outputChannel);
  jumpToFirst(result.first);
}

export async function compileAndRunCommand(
  outputChannel: vscode.OutputChannel,
  diagCollection: vscode.DiagnosticCollection,
): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    void vscode.window.showErrorMessage("Inform 6: no workspace folder open.");
    return;
  }

  const fc = await pickTarget(workspaceRoot);
  if (!fc) return;

  diagCollection.clear();
  const label = path.basename(fc.mainFile);
  const result = await compileTarget(fc, workspaceRoot, label, `Compiling ${label}…`, outputChannel, diagCollection);
  if (!result) return;

  const runWithWarnings = vscode.workspace.getConfiguration("inform6").get<boolean>("runWithWarnings", false);

  if (result.errors > 0 || (result.warnings > 0 && !runWithWarnings)) {
    showCompileToast(label, result, outputChannel);
    jumpToFirst(result.first);
    return;
  }

  if (result.warnings > 0) {
    showCompileToast(label, result, outputChannel);
  }

  // Compile succeeded — find and open the story file.
  const storyUri = findStoryFile(fc.mainFile);
  if (!storyUri) {
    void vscode.window.showErrorMessage(`Inform 6: ${label} compiled successfully but no story file was found.`);
    return;
  }

  const col = storyViewColumn();
  const isExternal =
    vscode.workspace.getConfiguration("inform6").get<string>("storyPlayerColumn", "beside") === "external";

  if (isExternal) {
    void vscode.env.openExternal(storyUri);
  } else {
    void vscode.commands.executeCommand("vscode.open", storyUri, {
      preview: false,
      viewColumn: col,
    });
  }
}

import { spawn } from "node:child_process";
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
      severity === "Error"
        ? vscode.DiagnosticSeverity.Error
        : vscode.DiagnosticSeverity.Warning,
    );
    diag.source = "inform6-compile";
    const list = byFile.get(file) ?? [];
    list.push(diag);
    byFile.set(file, list);
    if (!first) first = { uri: vscode.Uri.file(file), range };
  }
  return { byFile, first };
}

export async function compileCommand(
  outputChannel: vscode.OutputChannel,
  diagCollection: vscode.DiagnosticCollection,
): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    void vscode.window.showErrorMessage("Inform 6: no workspace folder open.");
    return;
  }

  const config = loadConfig(workspaceRoot);
  if (!config || config.files.length === 0) {
    void vscode.window.showErrorMessage(
      "Inform 6: no targets found in inform6rc.yaml.",
    );
    return;
  }

  const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;

  type TargetItem = vscode.QuickPickItem & { fileConfig: FileConfig };

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

  const fc = await new Promise<FileConfig | undefined>((resolve) => {
    qp.onDidAccept(() => { resolve(qp.selectedItems[0]?.fileConfig); qp.dispose(); });
    qp.onDidHide(() => { resolve(undefined); qp.dispose(); });
  });

  if (!fc) return;
  const label = path.basename(fc.mainFile);

  // Clear previous compile diagnostics for this target.
  diagCollection.clear();

  const args: string[] = ["-E1", "-q2"];
  if (fc.switches) args.push(...fc.switches.trim().split(/\s+/));
  if (fc.libraryPath) args.push(`+${fc.libraryPath}`);
  for (const def of fc.defines) {
    args.push("--define");
    args.push(def.includes("=") ? def : `${def}=1`);
  }
  args.push(fc.mainFile);

  void vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Compiling ${label}…`,
      cancellable: false,
    },
    () =>
      new Promise<void>((resolve) => {
        const child = spawn(fc.compiler, args, {
          cwd: workspaceRoot,
          env: process.env,
        });

        const stderrChunks: Buffer[] = [];
        child.stdout?.on("data", () => { /* -q2 suppresses stdout */ });
        child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

        child.on("error", (err) => {
          resolve();
          void vscode.window.showErrorMessage(
            `Inform 6: failed to launch compiler: ${err.message}`,
          );
        });

        child.on("close", (code) => {
          resolve();
          const stderr = Buffer.concat(stderrChunks).toString("utf-8");
          const lines = stderr.split("\n");
          const errors   = lines.filter((l) => /:\s+Error:\s/.test(l)).length;
          const warnings = lines.filter((l) => /:\s+Warning:\s/.test(l)).length;

          // Push parsed diagnostics to Problems panel.
          const { byFile, first } = parseDiagnostics(stderr);
          for (const [file, diags] of byFile) {
            diagCollection.set(vscode.Uri.file(file), diags);
          }

          // Write raw stderr to the output channel (skip source-echo lines).
          if (errors > 0 || warnings > 0) {
            outputChannel.appendLine(`\n[compile] ${label}`);
            for (const line of lines) {
              if (line.trim() && !line.startsWith(">")) outputChannel.appendLine(line);
            }
          }

          const detail = [
            errors   > 0 ? `${errors} error${errors     === 1 ? "" : "s"}`   : "",
            warnings > 0 ? `${warnings} warning${warnings === 1 ? "" : "s"}` : "",
          ].filter(Boolean).join(", ");

          if (code !== 0) {
            void vscode.window.showErrorMessage(
              `Inform 6: ${label} — ${detail || "compilation failed"}.`,
              "Show Output",
            ).then((action) => { if (action) outputChannel.show(); });
          } else if (warnings > 0) {
            void vscode.window.showWarningMessage(
              `Inform 6: ${label} — ${detail}.`,
              "Show Output",
            ).then((action) => { if (action) outputChannel.show(); });
          } else {
            void vscode.window.showInformationMessage(
              `Inform 6: ${label} compiled successfully.`,
            );
          }

          // Jump to the first error or warning.
          if (first) {
            void vscode.workspace.openTextDocument(first.uri).then((doc) =>
              vscode.window.showTextDocument(doc, { selection: first!.range, preserveFocus: false })
            );
          }
        });
      }),
  );
}

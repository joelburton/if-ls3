import { spawn } from "node:child_process";
import * as path from "node:path";
import * as vscode from "vscode";
import { loadConfig } from "../src/workspace/config";
import type { FileConfig } from "../src/workspace/config";

export async function compileCommand(): Promise<void> {
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

  // Use createQuickPick so we can pre-select the active file.
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

  const args: string[] = ["-q2"];
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
          const lines = Buffer.concat(stderrChunks).toString("utf-8").split("\n");
          const errors   = lines.filter((l) => /:\s+Error:\s/.test(l)).length;
          const warnings = lines.filter((l) => /:\s+Warning:\s/.test(l)).length;

          const detail = [
            errors   > 0 ? `${errors} error${errors     === 1 ? "" : "s"}`   : "",
            warnings > 0 ? `${warnings} warning${warnings === 1 ? "" : "s"}` : "",
          ].filter(Boolean).join(", ");

          if (code !== 0) {
            void vscode.window.showErrorMessage(
              `Inform 6: ${label} — ${detail || "compilation failed"}.`,
            );
          } else if (warnings > 0) {
            void vscode.window.showWarningMessage(
              `Inform 6: ${label} — ${detail}.`,
            );
          } else {
            void vscode.window.showInformationMessage(
              `Inform 6: ${label} compiled successfully.`,
            );
          }
        });
      }),
  );
}

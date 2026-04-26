import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { LanguageClient, LanguageClientOptions } from "vscode-languageclient/node";
import { inactiveLineRange } from "../src/features/conditionals";
import { wrapParagraph } from "./wrapParagraph";
import { compileCommand } from "./compile";

type Conditional = Parameters<typeof inactiveLineRange>[0];

let client: LanguageClient | undefined;
let outputChannel: vscode.OutputChannel;

const inactiveDecoration = vscode.window.createTextEditorDecorationType({
  opacity: "0.4",
  isWholeLine: true,
});

async function applyInactiveDecorations(editor: vscode.TextEditor): Promise<void> {
  if (editor.document.languageId !== "inform6" || !client) return;

  const enabled = vscode.workspace
    .getConfiguration("inform6")
    .get<boolean>("grayInactiveBranches", true);

  if (!enabled) {
    editor.setDecorations(inactiveDecoration, []);
    return;
  }

  const conditionals = await client.sendRequest<Conditional[]>(
    "inform6/getConditionals",
    { uri: editor.document.uri.toString() }
  );

  const ranges: vscode.Range[] = [];
  for (const c of conditionals ?? []) {
    const r = inactiveLineRange(c);
    if (r) ranges.push(new vscode.Range(r.startLine, 0, r.endLine, Number.MAX_SAFE_INTEGER));
  }
  editor.setDecorations(inactiveDecoration, ranges);
}

function refreshAllDecorations(): void {
  for (const editor of vscode.window.visibleTextEditors) {
    void applyInactiveDecorations(editor);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel("Inform6 Language Server");

  // Write the correct grammar file before VS Code tokenizes any .inf files.
  // This must be synchronous so it completes before activate() returns.
  applyGrammarFile(context.extensionPath);

  if (languageServerEnabled()) {
    startClient(context);
  } else {
    outputChannel.appendLine("[activate] language server disabled by configuration");
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("inform6.compile", () => compileCommand(outputChannel))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("inform6.wrapParagraph", wrapParagraph)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("inform6.toggleGrayInactiveBranches", async () => {
      const config = vscode.workspace.getConfiguration("inform6");
      const current = config.get<boolean>("grayInactiveBranches", true);
      await config.update("grayInactiveBranches", !current, vscode.ConfigurationTarget.Global);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("inform6.applyBranchFolds", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "inform6") return;
      if (!client) return;

      type Conditional = { active: string; start_line: number };
      const conditionals = await client.sendRequest<Conditional[]>(
        "inform6/getConditionals",
        { uri: editor.document.uri.toString() }
      );
      if (!conditionals || conditionals.length === 0) return;

      const activeLines   = conditionals.filter(c => c.active !== "none").map(c => c.start_line - 1);
      const inactiveLines = conditionals.filter(c => c.active === "none").map(c => c.start_line - 1);

      if (activeLines.length > 0)
        await vscode.commands.executeCommand("editor.unfold", { selectionLines: activeLines });
      if (inactiveLines.length > 0)
        await vscode.commands.executeCommand("editor.fold",   { selectionLines: inactiveLines });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("inform6.toggleTextMateHighlighting", async () => {
      const config = vscode.workspace.getConfiguration("inform6");
      const current = config.get<boolean>("enableTextMateHighlighting", true);
      await config.update("enableTextMateHighlighting", !current, vscode.ConfigurationTarget.Global);
      applyGrammarFile(context.extensionPath);
      const label = !current ? "enabled" : "disabled";
      const action = await vscode.window.showInformationMessage(
        `Inform 6 TextMate highlighting ${label}. Reload the window to apply.`,
        "Reload Window"
      );
      if (action === "Reload Window") {
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
      }
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) void applyInactiveDecorations(editor);
    })
  );

  // Restart the LSP client when the language server enable/disable setting changes.
  // Refresh branch graying when that setting changes.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("inform6.enableLanguageServer")) {
        outputChannel.appendLine(
          "[extension] inform6.enableLanguageServer changed — restarting client"
        );
        void restartClient(context);
      }
      if (e.affectsConfiguration("inform6.grayInactiveBranches")) {
        refreshAllDecorations();
      }
    })
  );
}

// ---------------------------------------------------------------------------
// Grammar file management
//
// VS Code reads the TextMate grammar from the path declared in package.json
// (syntaxes/inform6-active.tmLanguage.json) each time a new session starts.
// We swap its contents at activation time so the correct grammar is in place
// before any .inf file is tokenized.
// ---------------------------------------------------------------------------

function applyGrammarFile(extensionPath: string): void {
  const enabled = vscode.workspace
    .getConfiguration("inform6")
    .get<boolean>("enableTextMateHighlighting", true);

  const srcName = enabled ? "inform6.tmLanguage.json" : "inform6-empty.tmLanguage.json";
  const src = path.join(extensionPath, "syntaxes", srcName);
  const dest = path.join(extensionPath, "syntaxes", "inform6-active.tmLanguage.json");

  try {
    fs.copyFileSync(src, dest);
    outputChannel.appendLine(
      `[extension] TextMate highlighting: ${enabled ? "on" : "off"} (${srcName} → inform6-active.tmLanguage.json)`
    );
  } catch (e) {
    outputChannel.appendLine(`[extension] warning: could not write grammar file: ${e}`);
  }
}

// ---------------------------------------------------------------------------
// Language client
// ---------------------------------------------------------------------------

function languageServerEnabled(): boolean {
  return vscode.workspace
    .getConfiguration("inform6")
    .get<boolean>("enableLanguageServer", true);
}

function startClient(context: vscode.ExtensionContext): void {
  const bundledServer = context.asAbsolutePath(
    path.join("bundled-server", "server.cjs")
  );

  outputChannel.appendLine(`[activate] server: ${bundledServer}`);

  const serverOptions = (): Promise<import("node:child_process").ChildProcess> => {
    const child = spawn("node", [bundledServer, "--stdio"], {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.on("error", (err) => {
      outputChannel.appendLine(`[server] spawn error: ${err.message}`);
      void vscode.window.showErrorMessage(`Inform6 LSP: spawn failed: ${err.message}`);
    });
    child.on("exit", (code, signal) => {
      outputChannel.appendLine(`[server] exited code=${String(code)} signal=${String(signal)}`);
    });
    child.stderr?.on("data", (data: Buffer) => {
      outputChannel.append(`[stderr] ${data.toString()}`);
    });
    return Promise.resolve(child);
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "inform6" },
    ],
    synchronize: {
      fileEvents: [
        vscode.workspace.createFileSystemWatcher("**/*.inf"),
        vscode.workspace.createFileSystemWatcher("**/*.h"),
        vscode.workspace.createFileSystemWatcher("**/inform6rc.yaml"),
      ],
    },
    outputChannel,
  };

  client = new LanguageClient(
    "inform6-lsp",
    "Inform6 Language Server",
    serverOptions,
    clientOptions,
  );

  client.onNotification("inform6/indexUpdated", () => {
    refreshAllDecorations();
  });

  // Restart the server when inform6rc.yaml changes.
  const yamlWatcher = vscode.workspace.createFileSystemWatcher("**/inform6rc.yaml");
  context.subscriptions.push(
    yamlWatcher.onDidChange(() => void client?.restart()),
    yamlWatcher.onDidCreate(() => void client?.restart()),
    yamlWatcher.onDidDelete(() => void client?.restart()),
    yamlWatcher,
  );

  void client.start().catch((error: unknown) => {
    void vscode.window.showErrorMessage(`Inform6 LSP failed to start: ${String(error)}`);
  });

  context.subscriptions.push({
    dispose: () => {
      void client?.stop().catch(() => { /* ignore */ });
    },
  });
}

async function restartClient(context: vscode.ExtensionContext): Promise<void> {
  if (client) {
    await client.stop().catch(() => { /* ignore */ });
    client = undefined;
  }
  if (languageServerEnabled()) {
    startClient(context);
  } else {
    outputChannel.appendLine("[extension] language server disabled — not restarting");
  }
}

export async function deactivate(): Promise<void> {
  if (!client) return;
  await client.stop().catch(() => { /* ignore */ });
  client = undefined;
}

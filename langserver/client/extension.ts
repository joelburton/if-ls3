import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { LanguageClient, LanguageClientOptions } from "vscode-languageclient/node";

let client: LanguageClient | undefined;
let outputChannel: vscode.OutputChannel;

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

  // Restart the LSP client when the language server enable/disable setting changes.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("inform6.enableLanguageServer")) {
        outputChannel.appendLine(
          "[extension] inform6.enableLanguageServer changed — restarting client"
        );
        void restartClient(context);
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

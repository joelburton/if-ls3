import { spawn } from "node:child_process";
import * as path from "node:path";
import * as vscode from "vscode";
import { LanguageClient, LanguageClientOptions } from "vscode-languageclient/node";

let client: LanguageClient | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const bundledServer = path.join(context.extensionPath, "bundled-server", "server.cjs");
  const outputChannel = vscode.window.createOutputChannel("Inform6 Language Server");

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

export async function deactivate(): Promise<void> {
  if (!client) return;
  await client.stop().catch(() => { /* ignore */ });
  client = undefined;
}

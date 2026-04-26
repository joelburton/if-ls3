import * as vscode from "vscode";

export function wrapParagraph(): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const doc = editor.document;
  const cursor = editor.selection.active;

  const stringRange = findEnclosingString(doc, cursor);
  if (!stringRange) {
    void vscode.window.showInformationMessage("Cursor is not inside a string");
    return;
  }

  const columns = getColumnLimit(editor);
  const newText = wrapString(doc, stringRange.open, stringRange.close, columns);

  const replaceRange = new vscode.Range(
    stringRange.open,
    new vscode.Position(stringRange.close.line, doc.lineAt(stringRange.close.line).text.length),
  );

  void editor.edit((edit) => edit.replace(replaceRange, newText));
}

function findEnclosingString(
  doc: vscode.TextDocument,
  cursor: vscode.Position,
): { open: vscode.Position; close: vscode.Position } | null {
  // Track string state from document start so we correctly handle multi-line
  // strings and don't mistake a closing " for an opening one. Outside a
  // string, "!" starts a comment; inside a string, "!" is literal content.
  let inString = false;
  let openPos: vscode.Position | null = null;

  for (let line = 0; line <= cursor.line; line++) {
    const text = doc.lineAt(line).text;
    const endChar = line === cursor.line ? cursor.character : text.length;
    for (let ch = 0; ch < endChar; ch++) {
      if (!inString && text[ch] === "!") break; // rest of line is comment
      if (text[ch] === '"') {
        if (!inString) {
          inString = true;
          openPos = new vscode.Position(line, ch);
        } else {
          inString = false;
          openPos = null;
        }
      }
    }
  }

  if (!inString || !openPos) return null;

  // Cursor is inside a string — scan forward for the closing quote.
  let closePos: vscode.Position | null = null;
  outer: for (let line = cursor.line; line < doc.lineCount; line++) {
    const text = doc.lineAt(line).text;
    const startChar = line === cursor.line ? cursor.character : 0;
    for (let ch = startChar; ch < text.length; ch++) {
      if (text[ch] === '"') {
        closePos = new vscode.Position(line, ch);
        break outer;
      }
    }
  }

  if (!closePos) return null;
  return { open: openPos, close: closePos };
}

function getColumnLimit(editor: vscode.TextEditor): number {
  const rulers = vscode.workspace
    .getConfiguration("editor", editor.document)
    .get<Array<number | { column: number }>>("rulers");
  if (rulers && rulers.length > 0) {
    const first = rulers[0];
    return typeof first === "number" ? first : first.column;
  }
  return 80;
}

function wrapString(
  doc: vscode.TextDocument,
  openPos: vscode.Position,
  closePos: vscode.Position,
  columns: number,
): string {
  const firstLineText = doc.lineAt(openPos.line).text;
  const indent = firstLineText.match(/^(\s*)/)?.[1] ?? "";
  const openColumn = openPos.character;

  const contentLines: string[] = [
    openPos.line === closePos.line
      ? firstLineText.slice(openColumn + 1, closePos.character)
      : firstLineText.slice(openColumn + 1),
  ];
  for (let i = openPos.line + 1; i <= closePos.line; i++) {
    const lineText = doc.lineAt(i).text;
    contentLines.push(i === closePos.line ? lineText.slice(0, closePos.character) : lineText);
  }

  const suffix = doc.lineAt(closePos.line).text.slice(closePos.character + 1);

  const strippedLines = contentLines.map((line, i) => (i === 0 ? line : line.replace(/^\s*/, "")));

  const leadingSpace = strippedLines[0]?.match(/^(\s+)/)?.[1] ?? "";
  const lastContent = strippedLines[strippedLines.length - 1] ?? "";
  const trailingSpace = lastContent.match(/(\s+)$/)?.[1] ?? "";

  const closing = `${trailingSpace}"${suffix}`;

  const groups: Array<string[] | null> = [];
  let current: string[] = [];

  for (const line of strippedLines) {
    if (line.trim() === "") {
      if (current.length > 0) {
        groups.push(current);
        current = [];
      }
      groups.push(null);
    } else if (line.match(/^\^/) && current.length > 0) {
      groups.push(current);
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) groups.push(current);

  const lastContentGroup = [...groups].reverse().find((g) => g !== null) as string[] | undefined;

  const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  const outputLines: string[] = [];
  let isFirstGroup = true;

  for (const group of groups) {
    if (group === null) {
      outputLines.push("");
      continue;
    }

    const isLastGroup = group === lastContentGroup;
    const words = group
      .join(" ")
      .split(/\s+/)
      .filter((w) => w.length > 0);
    const wrappedLines: string[] = [];
    let currentLine = "";

    for (let wi = 0; wi < words.length; wi++) {
      const word = words[wi];
      const isVeryFirstLine = isFirstGroup && wrappedLines.length === 0;
      const available = isVeryFirstLine ? columns - openColumn - 1 - leadingSpace.length : columns - indent.length;
      const closingLen = isLastGroup && wi === words.length - 1 ? closing.length : 0;

      if (currentLine === "") {
        currentLine = word;
      } else if (currentLine.length + 1 + word.length + closingLen <= available) {
        currentLine += " " + word;
      } else {
        wrappedLines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine !== "") wrappedLines.push(currentLine);

    for (let i = 0; i < wrappedLines.length; i++) {
      const isVeryFirstLine = isFirstGroup && i === 0;
      outputLines.push(isVeryFirstLine ? `"${leadingSpace}${wrappedLines[i]}` : `${indent}${wrappedLines[i]}`);
    }

    isFirstGroup = false;
  }

  if (outputLines.length > 0) outputLines[outputLines.length - 1] += closing;

  return outputLines.join(eol);
}

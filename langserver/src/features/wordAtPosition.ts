import type { Position } from "vscode-languageserver";

const isIdChar = (c: string): boolean => /[\w]/.test(c);

/**
 * Returns true if `col` on `lineText` falls inside an Inform6 `!` comment.
 *
 * Scans left-to-right tracking string state so that `!` inside a string
 * literal (e.g. `print "hello!";`) is not mistaken for a comment opener.
 */
export function isInComment(lineText: string, col: number): boolean {
  let inString = false;
  for (let i = 0; i < lineText.length; i++) {
    const c = lineText[i];
    if (c === '"') { inString = !inString; continue; }
    if (c === '!' && !inString) return col >= i;
  }
  return false;
}

/** Extract the Inform6 identifier under the cursor. */
export function wordAtPosition(
  text: string,
  position: Position,
): { word: string; lineText: string; start: number; end: number } | null {
  const lines = text.split("\n");
  const lineText = lines[position.line] ?? "";
  const col = position.character;

  if (!isIdChar(lineText[col] ?? "")) return null;

  let start = col;
  while (start > 0 && isIdChar(lineText[start - 1])) start--;

  let end = col;
  while (end < lineText.length && isIdChar(lineText[end])) end++;

  const word = lineText.slice(start, end);
  return word ? { word, lineText, start, end } : null;
}

/**
 * If the word starting at `wordStart` on `line` is preceded by `ObjName.`,
 * return `ObjName`; otherwise return null.
 *
 * Handles: `TheRoom.description` → "TheRoom"
 */
export function objectBeforeDot(line: string, wordStart: number): string | null {
  if (wordStart === 0 || line[wordStart - 1] !== ".") return null;

  const dotPos = wordStart - 1;
  if (dotPos === 0) return null;

  let objEnd = dotPos;
  let objStart = objEnd;
  while (objStart > 0 && isIdChar(line[objStart - 1])) objStart--;

  const obj = line.slice(objStart, objEnd);
  return obj.length > 0 ? obj : null;
}

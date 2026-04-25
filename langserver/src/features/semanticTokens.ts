import type { CompilerIndex, RoutineInfo } from "../server/types";

/**
 * Token type indices — must match the legend declared in server.ts:
 *   ["variable", "property", "enumMember"]
 */
const TOKEN_TYPE_VARIABLE = 0; // local variables
const TOKEN_TYPE_PROPERTY = 1; // global variables
const TOKEN_TYPE_ENUM_MEMBER = 2; // constants

interface TokenPos {
  line: number; // 0-indexed
  char: number; // 0-indexed
  length: number;
  tokenType: number;
}

/**
 * Return encoded LSP semantic token data for:
 *   - local variables (type "variable") — within each routine's line range
 *   - global variables (type "property") — everywhere in the file
 *   - constants (type "enumMember") — everywhere in the file
 *
 * Locals shadow globals/constants: if an identifier on a line is a local of
 * the enclosing routine, it is emitted as a local and not re-emitted as a
 * global or constant even if the same name exists at module level.
 *
 * Limitation: multi-line string literals are not tracked across lines, so a
 * symbol name inside a multi-line string may be incorrectly colored.
 * Single-line strings and ! comments are handled correctly.
 */
export function getSemanticTokens(index: CompilerIndex, filePath: string, sourceText: string): number[] {
  const lines = sourceText.split("\n");
  const tokens: TokenPos[] = [];

  // Build name sets for globals and constants (lowercased for case-insensitive match).
  const globalNames = new Set(index.globals.map((g) => g.name.toLowerCase()));
  const constantNames = new Set(index.constants.map((c) => c.name.toLowerCase()));

  // Build a line→localSet map so the global/constant scanner can skip locals.
  const lineToLocals = new Map<number, Set<string>>();
  for (const routine of index.routines) {
    if (routine.file !== filePath || routine.locals.length === 0) continue;
    const localSet = new Set(routine.locals.map((l) => l.toLowerCase()));
    const startLine = Math.max(0, routine.start_line - 1);
    const endLine = Math.min(routine.end_line - 1, lines.length - 1);
    for (let li = startLine; li <= endLine; li++) lineToLocals.set(li, localSet);
    collectLocalTokens(routine, lines, tokens);
  }

  // Scan every line for globals and constants.
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    scanLineForGlobalsAndConstants(
      lines[lineIdx] ?? "",
      lineIdx,
      globalNames,
      constantNames,
      lineToLocals.get(lineIdx),
      tokens,
    );
  }

  // Routines may be out of order (embedded), so sort before encoding.
  tokens.sort((a, b) => (a.line !== b.line ? a.line - b.line : a.char - b.char));

  // Encode as LSP delta format: 5 integers per token.
  const data: number[] = [];
  let prevLine = 0;
  let prevChar = 0;
  for (const tok of tokens) {
    const deltaLine = tok.line - prevLine;
    const deltaChar = deltaLine === 0 ? tok.char - prevChar : tok.char;
    data.push(deltaLine, deltaChar, tok.length, tok.tokenType, 0);
    prevLine = tok.line;
    prevChar = tok.char;
  }
  return data;
}

function collectLocalTokens(routine: RoutineInfo, lines: string[], out: TokenPos[]): void {
  const localSet = new Set(routine.locals.map((l) => l.toLowerCase()));
  const startLine = Math.max(0, routine.start_line - 1);
  const endLine = Math.min(routine.end_line - 1, lines.length - 1);

  for (let lineIdx = startLine; lineIdx <= endLine; lineIdx++) {
    scanLine(lines[lineIdx] ?? "", lineIdx, (name, start) => {
      if (localSet.has(name.toLowerCase()))
        out.push({ line: lineIdx, char: start, length: name.length, tokenType: TOKEN_TYPE_VARIABLE });
    });
  }
}

function scanLineForGlobalsAndConstants(
  line: string,
  lineIdx: number,
  globalNames: Set<string>,
  constantNames: Set<string>,
  localSet: Set<string> | undefined,
  out: TokenPos[],
): void {
  scanLine(line, lineIdx, (name, start) => {
    const lower = name.toLowerCase();
    if (localSet?.has(lower)) return; // shadowed by a local — already emitted
    if (globalNames.has(lower))
      out.push({ line: lineIdx, char: start, length: name.length, tokenType: TOKEN_TYPE_PROPERTY });
    else if (constantNames.has(lower))
      out.push({ line: lineIdx, char: start, length: name.length, tokenType: TOKEN_TYPE_ENUM_MEMBER });
  });
}

/**
 * Walk one source line calling `onIdent(name, startCol)` for every identifier
 * token found outside of ! comments, "..." strings, and '...' dictionary words.
 */
function scanLine(line: string, _lineIdx: number, onIdent: (name: string, start: number) => void): void {
  let i = 0;
  while (i < line.length) {
    const ch = line[i];

    if (ch === "!") break; // rest of line is a comment

    if (ch === '"') {
      i++;
      while (i < line.length && line[i] !== '"') i++;
      if (i < line.length) i++;
      continue;
    }

    if (ch === "'") {
      i++;
      while (i < line.length && line[i] !== "'") i++;
      if (i < line.length) i++;
      continue;
    }

    if (/[a-zA-Z_]/.test(ch)) {
      const start = i;
      while (i < line.length && /\w/.test(line[i])) i++;
      onIdent(line.slice(start, i), start);
      continue;
    }

    i++;
  }
}

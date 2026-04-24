import type { CompilerIndex, RoutineInfo } from "../server/types";

/** Token type index 0 = "variable" (local), matching the legend in server.ts. */
const TOKEN_TYPE_VARIABLE = 0;

interface TokenPos {
  line: number;  // 0-indexed
  char: number;  // 0-indexed
  length: number;
}

/**
 * Return encoded LSP semantic token data marking every local variable
 * occurrence within routines defined in `filePath`.
 *
 * Uses token type "variable" (index 0).  Globals and other symbols are left
 * to the TextMate grammar; the contrast between semantic-typed locals and
 * TextMate-typed globals is what makes locals visually distinct.
 *
 * Limitations: multi-line string literals are not tracked across lines, so a
 * local name that happens to appear inside a multi-line string may be
 * incorrectly colored.  Single-line strings and ! comments are handled.
 */
export function getSemanticTokens(
  index: CompilerIndex,
  filePath: string,
  sourceText: string,
): number[] {
  const lines = sourceText.split("\n");
  const tokens: TokenPos[] = [];

  for (const routine of index.routines) {
    if (routine.file !== filePath || routine.locals.length === 0) continue;
    collectLocalTokens(routine, lines, tokens);
  }

  // Routines may be out of order (embedded), so sort before encoding.
  tokens.sort((a, b) => a.line !== b.line ? a.line - b.line : a.char - b.char);

  // Encode as LSP delta format: 5 integers per token.
  const data: number[] = [];
  let prevLine = 0;
  let prevChar = 0;
  for (const tok of tokens) {
    const deltaLine = tok.line - prevLine;
    const deltaChar = deltaLine === 0 ? tok.char - prevChar : tok.char;
    data.push(deltaLine, deltaChar, tok.length, TOKEN_TYPE_VARIABLE, 0);
    prevLine = tok.line;
    prevChar = tok.char;
  }
  return data;
}

function collectLocalTokens(
  routine: RoutineInfo,
  lines: string[],
  out: TokenPos[],
): void {
  const localSet = new Set(routine.locals.map(l => l.toLowerCase()));
  const startLine = Math.max(0, routine.start_line - 1);
  const endLine = Math.min(routine.end_line - 1, lines.length - 1);

  for (let lineIdx = startLine; lineIdx <= endLine; lineIdx++) {
    scanLineForLocals(lines[lineIdx] ?? "", lineIdx, localSet, out);
  }
}

/**
 * Scan one source line for identifier tokens that are in `localSet`.
 * Skips ! line comments, "..." strings, and '...' dictionary words.
 */
function scanLineForLocals(
  line: string,
  lineIdx: number,
  localSet: Set<string>,
  out: TokenPos[],
): void {
  let i = 0;
  while (i < line.length) {
    const ch = line[i];

    if (ch === "!") break;  // rest of line is a comment

    if (ch === '"') {
      i++;
      while (i < line.length && line[i] !== '"') i++;
      if (i < line.length) i++;  // skip closing "
      continue;
    }

    if (ch === "'") {
      i++;
      while (i < line.length && line[i] !== "'") i++;
      if (i < line.length) i++;  // skip closing '
      continue;
    }

    if (/[a-zA-Z_]/.test(ch)) {
      const start = i;
      while (i < line.length && /\w/.test(line[i])) i++;
      const name = line.slice(start, i);
      if (localSet.has(name.toLowerCase())) {
        out.push({ line: lineIdx, char: start, length: name.length });
      }
      continue;
    }

    i++;
  }
}

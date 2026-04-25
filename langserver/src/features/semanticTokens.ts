import type { CompilerIndex, RoutineInfo } from "../server/types";

/**
 * Token type indices — must match the legend declared in server.ts:
 *   ["variable", "property", "enumMember"]
 */
const TOKEN_TYPE_VARIABLE = 0; // local variables
const TOKEN_TYPE_PROPERTY = 1; // globals, properties, attributes
const TOKEN_TYPE_ENUM_MEMBER = 2; // constants

interface TokenPos {
  line: number; // 0-indexed
  char: number; // 0-indexed
  length: number;
  tokenType: number;
}

/**
 * Return encoded LSP semantic token data for the given file.
 *
 * When the index includes `references[]` (compiler binary ≥ the version that
 * added them) and the file appears in `index.files[]`, tokens are derived from
 * the compiler's exact reference positions.  This is more accurate than text
 * scanning: inactive `#IfDef` branches, string literals, and comments are never
 * highlighted because the compiler never emits references for them.  In
 * addition to globals and constants, properties and attributes are now also
 * highlighted as TOKEN_TYPE_PROPERTY.
 *
 * When `references[]` is absent (older binary), the function falls back to the
 * original text-scanning approach, which covers globals and constants only.
 *
 * Local variables are always found via text scanning within each routine's
 * range — locals are not included in `references[]`.
 */
export function getSemanticTokens(index: CompilerIndex, filePath: string, sourceText: string): number[] {
  const lines = sourceText.split("\n");
  const tokens: TokenPos[] = [];

  const fileIndex = index.files.indexOf(filePath);
  if (index.references && fileIndex !== -1) {
    collectTokensViaReferences(index, fileIndex, filePath, lines, tokens);
  } else {
    collectTokensViaTextScan(index, filePath, lines, tokens);
  }

  tokens.sort((a, b) => (a.line !== b.line ? a.line - b.line : a.char - b.char));
  return encode(tokens);
}

// ── References path ───────────────────────────────────────────────────────────

/** Map a compiler reference type string to a token type index, or -1 to skip. */
function refTypeToTokenType(type: string): number {
  switch (type) {
    case "global_variable":
    case "property":
    case "individual_property":
    case "attribute":
      return TOKEN_TYPE_PROPERTY;
    case "constant":
      return TOKEN_TYPE_ENUM_MEMBER;
    default:
      return -1; // routine, object, action, array, etc. — not highlighted
  }
}

function collectTokensViaReferences(
  index: CompilerIndex,
  fileIndex: number,
  filePath: string,
  lines: string[],
  out: TokenPos[],
): void {
  // Collect local tokens and build a per-line local-name set for shadowing.
  const lineToLocals = new Map<number, Set<string>>();
  for (const routine of index.routines) {
    if (routine.file !== filePath || routine.locals.length === 0) continue;
    const localSet = new Set(routine.locals.map((l) => l.toLowerCase()));
    const startLine = Math.max(0, routine.start_line - 1);
    const endLine = Math.min(routine.end_line - 1, lines.length - 1);
    for (let li = startLine; li <= endLine; li++) lineToLocals.set(li, localSet);
    collectLocalTokens(routine, lines, out);
  }

  // Emit one token per reference that belongs to this file.
  const prefix = `${fileIndex}:`;
  for (const ref of index.references!) {
    const tokenType = refTypeToTokenType(ref.type);
    if (tokenType === -1) continue;

    for (const locStr of ref.locs) {
      if (!locStr.startsWith(prefix)) continue;
      const rest = locStr.slice(prefix.length);
      const sep = rest.indexOf(":");
      if (sep === -1) continue;
      const line1 = parseInt(rest.slice(0, sep), 10);
      const col = parseInt(rest.slice(sep + 1), 10);
      if (isNaN(line1) || isNaN(col)) continue;

      const lineIdx = line1 - 1; // 0-based
      if (lineToLocals.get(lineIdx)?.has(ref.sym.toLowerCase())) continue;

      out.push({ line: lineIdx, char: col, length: ref.sym.length, tokenType });
    }
  }
}

// ── Text-scan fallback ────────────────────────────────────────────────────────

function collectTokensViaTextScan(
  index: CompilerIndex,
  filePath: string,
  lines: string[],
  out: TokenPos[],
): void {
  const globalNames = new Set(index.globals.map((g) => g.name.toLowerCase()));
  const constantNames = new Set(index.constants.map((c) => c.name.toLowerCase()));

  const lineToLocals = new Map<number, Set<string>>();
  for (const routine of index.routines) {
    if (routine.file !== filePath || routine.locals.length === 0) continue;
    const localSet = new Set(routine.locals.map((l) => l.toLowerCase()));
    const startLine = Math.max(0, routine.start_line - 1);
    const endLine = Math.min(routine.end_line - 1, lines.length - 1);
    for (let li = startLine; li <= endLine; li++) lineToLocals.set(li, localSet);
    collectLocalTokens(routine, lines, out);
  }

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    scanLineForGlobalsAndConstants(
      lines[lineIdx] ?? "",
      lineIdx,
      globalNames,
      constantNames,
      lineToLocals.get(lineIdx),
      out,
    );
  }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function encode(tokens: TokenPos[]): number[] {
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
    if (localSet?.has(lower)) return;
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

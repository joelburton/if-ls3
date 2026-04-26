import type { SignatureHelp, SignatureInformation, ParameterInformation } from "vscode-languageserver";
import type { Position } from "vscode-languageserver";
import type { CompilerIndex } from "../server/types";

/**
 * Scan forward from the start of the document to the cursor, tracking
 * string/comment state and a paren stack.  Returns the innermost open
 * call frame: the routine name before the unmatched `(` and the number of
 * commas seen at that depth (= the 0-based active parameter index).
 *
 * A forward scan is used (not backward) so that string delimiters are
 * unambiguous — `"` always opens or closes in forward order.
 */
function findCallContext(
  text: string,
  position: Position,
): { routineName: string; activeParam: number } | null {
  const lines = text.split("\n");

  let cursorOffset = 0;
  for (let i = 0; i < position.line; i++) {
    cursorOffset += (lines[i]?.length ?? 0) + 1; // +1 for the newline
  }
  cursorOffset += position.character;

  type Frame = { routineName: string; commaCount: number };
  const stack: Frame[] = [];
  let inString = false;
  let i = 0;

  while (i < cursorOffset) {
    const c = text[i]!;

    if (inString) {
      if (c === '"') inString = false;
      i++;
      continue;
    }

    if (c === '"') { inString = true; i++; continue; }

    if (c === '!') {
      // Comment: skip to end of line.
      while (i < cursorOffset && text[i] !== '\n') i++;
      continue;
    }

    if (c === '(') {
      // Find the identifier immediately before this paren (skip whitespace).
      let j = i - 1;
      while (j >= 0 && (text[j] === ' ' || text[j] === '\t')) j--;
      const nameEnd = j + 1;
      while (j >= 0 && /\w/.test(text[j]!)) j--;
      const name = text.slice(j + 1, nameEnd);
      stack.push({ routineName: name, commaCount: 0 });
      i++;
      continue;
    }

    if (c === ')') {
      stack.pop();
      i++;
      continue;
    }

    if (c === ',' && stack.length > 0) {
      stack[stack.length - 1]!.commaCount++;
    }

    i++;
  }

  if (stack.length === 0) return null;
  const top = stack[stack.length - 1]!;
  return top.routineName ? { routineName: top.routineName, activeParam: top.commaCount } : null;
}

export function getSignatureHelp(
  index: CompilerIndex,
  text: string,
  position: Position,
): SignatureHelp | null {
  const ctx = findCallContext(text, position);
  if (!ctx) return null;

  // Only non-embedded routines are callable by bare name.
  const routine = index.routines.find(
    (r) => !r.embedded && r.name.toLowerCase() === ctx.routineName.toLowerCase(),
  );
  if (!routine) return null;

  const locals = routine.locals ?? [];
  const label = `${routine.name}(${locals.join(", ")})`;

  // Use [start, end] offsets into `label` for precise parameter highlighting.
  const parameters: ParameterInformation[] = [];
  let pos = routine.name.length + 1; // skip "Name("
  for (const local of locals) {
    parameters.push({ label: [pos, pos + local.length] });
    pos += local.length + 2; // skip ", "
  }

  const sig: SignatureInformation = {
    label,
    parameters,
    ...(routine.doc ? { documentation: { kind: "markdown", value: routine.doc } } : {}),
  };

  return {
    signatures: [sig],
    activeSignature: 0,
    // Clamp to the last parameter so the final param stays highlighted even
    // when the caller passes more arguments than declared.
    activeParameter: Math.min(ctx.activeParam, Math.max(0, parameters.length - 1)),
  };
}

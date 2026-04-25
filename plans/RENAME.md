# Plan: Rename Symbol

## What we have

- `refAtPosition()` — compiler-backed cursor hit-test; returns `SymbolReference`
  with `sym` (name) and `type` (routine, action, object, etc.)
- `findReferences()` — all use-site `Location`s for a name from `references[]`
- `resolveSymbol()` — definition lookup across routines/objects/globals/constants/arrays
- `wordAtPosition()` — word + character range at cursor from source text
- `inactiveLineRange()` — used to detect files with inactive branches

The gaps are:
1. `findReferences` returns zero-width `Location`s; rename needs proper `Range`s
   `[col, col + name.length)`.
2. Definition sites have a line but no column; need `indexOf(name)` on source.

---

## LSP protocol

Two requests:

**`prepareRename`** — fires when the user triggers rename but before the input
box appears. Validates the position and returns `{ range, placeholder }` to
pre-select the current name. Without this VS Code happily prompts for rename
on whitespace, keywords, etc.

**`rename`** — receives `newName`, returns `WorkspaceEdit` (map of
`fileURI → TextEdit[]`). After returning the edit, if any affected file has
inactive conditional branches, `connection.window.showInformationMessage()`
sends an info toast: references inside inactive `#IfDef` branches were not
renamed.

---

## Action / Sub tandem

Inform 6 action `Foozle` always has a companion routine `FoozleSub`. Rename
both together automatically:

| Cursor on | New name | Action renamed | Routine renamed |
|-----------|----------|---------------|-----------------|
| action `Foozle` | `Grab` | `Foozle` → `Grab` | `FoozleSub` → `GrabSub` |
| routine `FoozleSub` | `GrabSub` | `Foozle` → `Grab` | `FoozleSub` → `GrabSub` |
| routine `FoozleSub` | `Handler` (no Sub suffix) | _(not renamed)_ | `FoozleSub` → `Handler` |

Detection:
- `ref.type === "action"` → action cursor; companion = `${sym}Sub`
- `ref.type === "routine"` AND name ends with `"Sub"` AND `references[]`
  has an entry for `name.slice(0, -3)` with type `"action"` → Sub cursor;
  companion action = `sym.slice(0, -3)`

New companion name derivation:
- Action cursor: companion routine new name = `${newName}Sub`
- Sub cursor: if `newName` ends with `"Sub"`, companion action new name =
  `newName.slice(0, -3)`. If `newName` doesn't end with `"Sub"`, rename only
  the routine (no companion rename).

---

## Out of scope

**Local variables** — not in `references[]`. Require a text-scan within the
enclosing routine's line range. Different code path; defer to v2.

---

## Algorithm

### `prepareRename(index, filePath, position, sourceText)`

```
1. wordAtPosition(sourceText, position) → { word, lineText, start, end } | null
2. isInComment(lineText, position.character) → return null if true
3. fileIndex = index.files.indexOf(filePath)
4. refAtPosition(index, fileIndex, line1, col) → ref | undefined
5. If no ref: resolveSymbol(index, word) → null means not a known symbol → return null
6. Find symbol in symbols[]: if is_system → return null
7. Return { range: Range(line, start, line, end), placeholder: word }
```

### `computeRename(index, filePath, position, newName, getFileText)`

```
1. wordAtPosition + refAtPosition (same as prepareRename)
2. Determine companions (action/Sub logic above)
3. For each symbol to rename (primary + optional companion):
   a. Collect use-site ranges from references[] (proper [col, col+len) ranges)
   b. Collect definition-site range:
      - resolveSymbol() → file + line
      - getFileText(file) → read source line → indexOf(name, case-insensitive)
      - Build Range(line-1, col, line-1, col+name.length)
4. Build WorkspaceEdit: group all TextEdit.replace(range, newText) by file URI
5. Return WorkspaceEdit
```

### Inactive branch warning (in `server.ts`)

After `computeRename` returns, extract the set of affected file paths from the
`WorkspaceEdit`. Check if any file in that set has conditionals where
`inactiveLineRange(c) !== null` (i.e., has inactive code). If yes:

```typescript
void connection.window.showInformationMessage(
  "Rename applied. Note: references inside inactive #IfDef branches " +
  "were not renamed — re-run after recompiling with different defines if needed."
);
```

---

## New module: `src/features/rename.ts`

```typescript
export function prepareRename(
  index: CompilerIndex,
  filePath: string,
  position: Position,
  sourceText: string,
): { range: Range; placeholder: string } | null

export function computeRename(
  index: CompilerIndex,
  filePath: string,
  position: Position,
  newName: string,
  getFileText: (path: string) => string | null,
): WorkspaceEdit | null
```

Internal helpers (not exported):

```
useRangesForSymbol(index, sym) → Array<{ uri, range }>
  — parses loc strings, extends each to [col, col+sym.length)

definitionRange(name, file, line, getFileText) → Range | null
  — reads source line, indexOf(name), returns precise range

companionSymbol(index, sym, type) → { sym, newName(base) } | null
  — action/Sub tandem logic
```

---

## Server wiring (`server.ts`)

Capabilities:
```typescript
renameProvider: { prepareProvider: true }
```

Handlers:
```typescript
connection.onPrepareRename((params) => { ... })
connection.onRenameRequest(async (params) => {
  // compute edit
  // if edit && hasInactiveBranches(index, affectedFiles) → showInformationMessage
  // return edit
})
```

`getFileText` callback: check `documents.get(URI.file(path))` first (open
buffer); fall back to `fs.readFileSync(path, "utf-8")` with try/catch.

---

## Tests (`src/test/rename.test.ts`)

Using fixture index + inline source strings (no disk I/O in unit tests):

- `prepareRename`: returns null at whitespace, in comment, on system symbol
- `prepareRename`: returns correct range + placeholder for routine, object, constant
- `computeRename`: produces correct edits for use-sites + definition
- `computeRename`: groups edits by file when refs span multiple files
- `computeRename`: action rename also renames companion Sub routine
- `computeRename`: Sub rename also renames companion action
- `computeRename`: Sub rename without "Sub" suffix in newName skips companion
- `computeRename`: returns null for system symbol

---

## Files

| File | Change |
|------|--------|
| `src/features/rename.ts` | **new** |
| `src/test/rename.test.ts` | **new** |
| `src/server/server.ts` | add capability + 2 handlers |

No compiler changes. No `types.ts` changes.

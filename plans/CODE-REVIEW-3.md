# Code Review 3: Verification Pass

> **Date:** 2026-04-25.
> **Scope:** verify the prior review's status updates, look for code-quality
> issues missed in `CODE-REVIEW.md`, and assess test coverage.
>
> **TL;DR:** the previous review was honest. All status markers in `plans/*`
> reflect the current tree. The remaining items below are nits — no
> structural issues found.

---

## A. Plan-document status — verified

Read against current code:

| Document | Marked done | Verified |
|----------|-------------|----------|
| `CODE-REVIEW.md` | P1, P2, P3, P5, P6 (most), P7 | ✅ |
| `PLAN.md` (compiler) | All phases through 1j | ✅ |
| `PLAN-LS.md` (LS) | All phases (build, completions, action nav, workspace symbols, refs, signature help, semantic tokens, rename, compile, undeclared properties) | ✅ |
| `CONDITIONALS.md` | Implemented | ✅ — `conditionals[]` emitted; LS folds + grays |
| `REFERENCES.md` | Implemented | ✅ — `references[]` consumed by definition/refs/semantic tokens |
| `INCLUDES.md` | Implemented | ✅ — `includes[]` powers Include hover/go-to |
| `RENAME.md` | Implemented | ✅ — `prepareRename` + `rename` + tandem Action/Sub |

No undone-but-actually-done items found.

---

## B. Code-quality nits

Low priority. Not blockers; flag for a small cleanup pass.

> **Status — 2026-04-25:** B1–B5 complete. B6 retracted on re-check —
> grep found zero `console.*` calls in client code; all catch blocks
> already route to `outputChannel` / `showErrorMessage` or are
> deliberate dispose-time ignores. No issue to fix.

### B1. Duplicate "6." in completions.ts JSDoc — ✅ Done

`langserver/src/features/completions.ts:167-168` numbers two modes as "6":

```
6. **`has`/`hasnt` clause**: attribute names.
6. **Top-top** (first token at col 0, ...
```

The second should be 7, the existing 7 should be 8. Off-by-one in the doc
header only — code is correct.

### B2. Stacked JSDoc blocks in hover.ts — ✅ Done

`langserver/src/features/hover.ts:10-25` has two `/** ... */` comments
stacked back-to-back. The first (lines 10-15) describes the lookup order
for `findHover`, but it sits immediately above the `rel()` helper. Looks
like a leftover from a refactor; the doc text is correct in spirit but is
attached to the wrong symbol. Move it down to `findHover` (further in the
file) or delete it — `findHover` already has its own header.

### B3. Misleading parameter name `fileUri` in foldingRanges.ts — ✅ Done

`langserver/src/features/foldingRanges.ts:4` declares
`getFoldingRanges(index, fileUri: string)`, but `server.ts:330-331` passes
`URI.parse(...).fsPath` — an absolute filesystem path, not a URI. The
comparison `c.file !== fileUri` works because `conditionals[].file` is
also an fsPath, but the name is wrong. Rename to `filePath`.

### B4. `void code;` to silence unused param — ✅ Done

`langserver/client/compile.ts:149` uses `void code;` to suppress the
unused exit-code parameter, with a trailing comment explaining why. Either
prefix the param with `_` (`_code`) or drop it from the destructure. Cleaner
and conventional.

### B5. Two near-identical readFileSync caches in diagnostics.ts — ✅ Done

`diagnostics.ts` has two file-read paths that both populate `fileLines`:

- Compiler-error narrowing (lines 45-52): logs failures via
  `connection.console.warn`.
- Undeclared-property `getLines` callback (lines 120-128): swallows
  failures silently.

The `#IfDef` scan path also reads files (lines 99-105) but uses a separate
local `content` variable with its own logging. Three near-duplicates of
the same pattern, with **inconsistent error logging** in the second one.
Consider a small `getCachedLines(file)` helper that always logs on failure.

### B6. ~~Client logging routes to Extension Host log~~ — Retracted

Original concern was that catch blocks in `client/extension.ts` logged to
`console.*` (Extension Host log) rather than the Output channel. On
re-check this is wrong: there are zero `console.*` calls in client code.
All catch blocks either use `outputChannel.appendLine` (e.g.
`extension.ts:190`), `vscode.window.showErrorMessage` (e.g.
`extension.ts:274`), or deliberately swallow shutdown errors. No fix
needed.

---

## C. Test coverage gaps

The 489-test vitest suite is thorough on the LSP side. The genuine gaps
are on the **client (extension) side**:

| Module | LOC | Tested? |
|--------|-----|---------|
| `client/extension.ts` | 307 | ❌ none — activation, decorations, branch-fold cmd |
| `client/wrapParagraph.ts` | 181 | ❌ none — Alt+Q paragraph wrap inside strings |
| `client/compile.ts` | 303 | partial — output parsing covered (`compile.test.ts`), spawn/UI not |
| `server/server.ts` | 377 | indirect — feature handlers covered via unit tests, but the wiring (request dispatch, reindex token, getFileText callback) is not exercised end-to-end |

Recommended additions, in ROI order:

1. **`wrapParagraph.ts` unit tests.** Pure function over a string + cursor;
   trivial to test like `wordAtPosition`. 181 untested lines is the biggest
   gap.
2. **Branch-fold command unit tests.** The decoration-range computation in
   `extension.ts` (which lines to gray, `#EndIf` visible-when-folded logic)
   is pure data manipulation against a `conditionals[]` fixture and could be
   extracted into a tested helper.
3. **`server.ts` integration test.** A small in-process LSP test using
   `vscode-jsonrpc`'s message readers/writers, asserting that
   `textDocument/foldingRange` etc. round-trip correctly. Optional — the
   feature unit tests already cover the hard parts.

Lower priority: config error-toast path, indexer failure path beyond what
`indexer.test.ts` already covers.

---

## D. What's good

- **Pure-function feature modules** are easy to read and trivial to test.
  `symbolLookup.ts` did the right consolidation and the consumers are all
  cleaner for it.
- **"Why" comments are present where they need to be.** `wordAtPosition`'s
  `isInString` forward-scan, `semanticTokens`'s sort step, the `#IfDef`
  scan rationale in `diagnostics.ts`, the `loadConfig` merge semantics —
  all explained.
- **Action/Sub tandem** in rename is correct in both directions, including
  the "no Sub suffix → don't rename companion" case.
- **`reindexGen` token** in `server.ts` correctly drops stale results when
  saves race; subtle and easy to miss.
- **489 tests passing, lint + format clean, type-check clean.** CI runs
  all three.

---

## E. Recommended follow-up

B1–B5 landed together (typecheck, lint, prettier, and 489/489 tests still
green). Optionally a follow-up PR for `wrapParagraph.ts` tests. Everything
else can stay as-is.

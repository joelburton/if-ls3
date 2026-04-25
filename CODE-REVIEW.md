# Code Review: if-ls3

Audit of the Inform 6 language server project (compiler fork + TypeScript
language server), covering code quality, duplication, test coverage, and
documentation.

**Codebase size**: ~1,120 lines C (index.c, new) + scattered hooks in
existing compiler files; ~1,630 lines TypeScript (language server);
~170 lines client extension.

---

## Priority 1: No automated tests

There are zero automated tests -- no test framework, no unit tests, no
integration tests, no CI for the language server.

The `test/corpus/` directory has manual smoke-test files (`tiny.inf`,
`small.inf`, `library_of_horror/`) that are run by hand via shell commands.
There is a `demo.json` snapshot of compiler output, but nothing compares
against it automatically.

The only CI is a Windows-only workflow that builds the C compiler binary.

**What's at risk**: Every change to hover, definition, completions,
diagnostics, semantic tokens, or the compiler's JSON output could silently
break things. The project is at the stage where a small test suite would
have outsized value.

**Recommended approach** (in order of ROI):

1. Add vitest. Create unit tests for the pure-function feature modules --
   they take a `CompilerIndex` object and return results, so they're trivial
   to test with fixture JSON. Start with `definition.ts`, `hover.ts`, and
   `completions.ts`.

2. Snapshot-test the compiler JSON output: run `inform6 -y` on corpus files,
   compare stdout against checked-in `.json` snapshots. This catches
   regressions in `index.c` with no mocking.

3. Add an `npm test` script and a GitHub Actions workflow that runs
   `npm run check && npm test`.

4. Later: integration tests using `vscode-languageserver` test utilities
   for full request/response cycles.

---

## Priority 2: Duplicated symbol-lookup pattern (TypeScript)

The same case-insensitive `.find()` cascade appears in `hover.ts`,
`definition.ts`, `completions.ts`, and `workspaceSymbols.ts`:

```typescript
const routine = index.routines.find((r) => r.name.toLowerCase() === lower);
const obj     = index.objects.find((o) => o.name.toLowerCase() === lower);
const global_ = index.globals.find((g) => g.name.toLowerCase() === lower);
// ... same pattern for constants, arrays, symbols
```

This is repeated ~17 times across the codebase. Each file implements its
own lookup order with slight variations. If a new symbol category is added
(e.g., `verbs` for name lookup), every file needs updating.

**Also duplicated**: the `loc()` helper (file + line -> Location) is defined
identically in `definition.ts:5` and `workspaceSymbols.ts:5`.

**Recommendation**: Extract a shared `resolveSymbol(index, name)` function
that returns the first matching symbol with its category. Each feature can
then format the result differently. Also move `loc()` to a shared utility.

---

## Priority 3: Duplicated doc-comment lookup (C)

In `index.c`, this 12-line block is copy-pasted 4 times (lines 571, 734,
771, 812) for globals, constants, arrays, and the symbols fallback:

```c
const char *doc = NULL;
if (i < (int)symbol_docs_memlist.count && symbol_docs[i]
    && symbol_docs[i][0] != '\0')
    doc = symbol_docs[i];
if (!doc && symbols[i].line.file_index > 0)
    doc = find_trailing_doc(symbols[i].line.file_index,
        symbols[i].line.line_number);
if (doc) { printf(", \"doc\": "); json_print_escaped_string(doc); }
```

**Recommendation**: Extract to a helper like
`json_print_symbol_doc(int sym_index)`. Reduces the 48 duplicated lines to
4 calls and makes it harder to fix the pattern in one place but not another.

---

## Priority 4: Performance -- linear scans on every request

Every hover, go-to-definition, and completion request does up to 6
sequential `.find()` calls over the full symbol arrays. For a large game
with thousands of symbols, this is O(n) per lookup, multiple times per
keystroke.

**Recommendation**: Build a `Map<string, T>` (keyed by lowercase name) for
each symbol category when the index is loaded. This turns lookups into O(1)
and is a straightforward change in the indexer. The maps could live on a
wrapper object next to `CompilerIndex`.

This is not urgent -- Inform 6 projects are small enough that linear scans
are fast in practice -- but it's the kind of thing that's easier to do now
than after more code depends on the current array-scanning pattern.

---

## Priority 5: Comments and documentation (TypeScript)

**What's good**:
- Feature functions have JSDoc headers explaining lookup order and behavior
  (`definition.ts:11-26`, `completions.ts:7-18`)
- Tricky logic is commented (`semanticTokens.ts:28-30` multi-line string
  limitation, `server.ts:68-96` action detection helpers)
- The `CLAUDE.md` is excellent -- thorough, accurate, and clearly written
  for an AI collaborator

**What's missing**:
- `diagnostics.ts` is the most complex feature file (~170 lines) and has
  minimal inline comments. The `scanIfDefWarnings()` function builds
  diagnostics by scanning raw source for `#IfDef` names that the compiler
  never defined -- this non-obvious strategy deserves a "why" comment.
- `indexer.ts` doesn't explain why veneer routines are filtered (they're
  compiler-generated runtime support, not user code).
- `keywords.ts` is ~230 lines of reference data with no header explaining
  where the keyword lists come from or how to update them.

---

## Priority 6: Minor bugs and robustness

### Windows path separator (langserver)
`server.ts:107` uses `.split("/")` to extract filenames from paths. On
Windows, `fsPath` uses backslashes. Should use `path.basename()` instead.
Low impact (Inform 6 development is mostly macOS/Linux), but a trivial fix.

### Silent file-read failures in diagnostics
`diagnostics.ts:49-52` catches `readFileSync` errors and silently returns
an empty array. Should log to the output channel so users can debug why
diagnostics are missing for a file.

### indexOf mismatch for duplicate names in diagnostics
`diagnostics.ts:55` uses `srcLine.indexOf(name)` to position the
diagnostic squiggle. If the name appears multiple times on a line, the
squiggle may land on the wrong occurrence. Low priority -- this affects
only the visual position of the underline, not the diagnostic itself.

### Dictionary word buffer (C, pre-existing)
`text.c:2957` calls `dictword_to_text(p, word_out)` in Z-code mode without
a buffer size parameter. This is a pre-existing issue in the Inform 6
compiler, not introduced by this project. Dictionary words are short in
practice so risk is negligible.

---

## Priority 7: Missing linting/formatting

No ESLint or Prettier configuration. The code is consistently formatted
(likely by editor settings), but there's no enforcement. Adding a minimal
ESLint config + format check to CI would prevent drift as more contributors
join.

---

## Things that are good

- **Clean separation of concerns**: each feature is a pure function taking
  an index and returning LSP types. The server file is a thin wiring layer.
- **Defensive null handling**: early returns for missing documents/indices
  are consistent across all handlers.
- **Memory management in C**: `index_free_arrays()` is thorough, with NULL
  checks before every `free()`. No leaks detected.
- **Error handling in the indexer**: spawn failures, timeouts, and JSON
  parse errors all gracefully degrade to "no index" rather than crashing.
- **The `inform6rc.yaml` config system**: clean design with global defaults
  and per-file overrides, proper tilde expansion, deduplication.
- **Guard checks**: all compiler hooks are gated on `if (index_switch)`,
  so the `-y` additions have zero impact on normal compilation.
- **CLAUDE.md**: one of the best project context files I've seen -- it will
  serve human contributors equally well.

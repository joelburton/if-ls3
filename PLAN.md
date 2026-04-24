# Inform6 Language Server — Implementation Plan

## Approach

Use the real Inform6 compiler as an indexer: compile with `-y` to get a JSON
symbol index, then build a TypeScript language server that consumes it. The
compiler already handles all the parsing complexity (macros, `Ifdef`, `Replace`,
grammar tables, etc.) — we just need to capture what it knows and expose it
via LSP.

All C/compiler work (Phase 1) comes first. The JSON output can be validated
by hand against small test files before building the language server.

## Phase 1: Compiler index enhancements (C — Opus)

This is tricky work in a large C codebase with extensive global state and
subtle lifetime issues (stale pointers, reused buffers). Opus is the right
choice.

### 1a. Done

- [x] `-y` flag: JSON symbol index output to stdout
- [x] `-q2` flag: silent mode (suppress banner/summary)
- [x] Errors/warnings to stderr
- [x] `files[]` section in JSON
- [x] `symbols[]` section with name, type, value, flags, is_system, file, line
- [x] `routines[]` section with name, locals, file, line, embedded flag
- [x] Local variable capture via `parse_routine()` hook in `syntax.c`
- [x] Proper string copying for locals and embedded routine names

### 1b. Ranges (start/end lines) — DONE

- [x] Routines have `start_line` / `end_line` (captured at `]` in
  `parse_routine` via `index_note_routine_end()`)
- [x] Objects have `start_line` / `end_line` (start captured at entry to
  `make_object()`/`make_class()`, end at the terminating `;`)

### 1c. Objects section — DONE

- [x] `objects[]` section in JSON with name, is_class, file, start/end
  lines, parent name, attributes list, properties list
- [x] Hooks in `objects.c`: `index_reset_object_props()` at start,
  `index_note_attribute()` in `attributes_segment()`,
  `index_note_property()` in both `properties_segment_z/g()`,
  `index_note_object()` at end of `make_object()`/`make_class()`
- [x] Metaclass objects (Class, Object, Routine, String) are excluded

### 1d. Globals and arrays — DONE

- [x] `globals[]` section: filtered from symbol table (non-system
  `GLOBAL_VARIABLE_T` symbols) with name, file, line
- [x] `arrays[]` section: from compiler's `arrays[]` tracking array with
  name, array_type (byte/word/string/table/buffer), size, is_static, file, line
- [x] No new hooks needed — reads existing compiler data structures directly

### 1e. Doc comments — DONE

Doc comment convention for Inform6 using `!! ` (two bangs + space).
The space requirement filters out decorative `!!!!!!` lines and
commented-out ICL directives like `!!%`.

- [x] **Form 1 — preceding lines:** `!! ` lines before a definition,
  with blank lines allowed between comment block and definition.
  Buffer cleared when a non-blank, non-comment token is encountered.
- [x] **Form 2 — trailing on same line:** `!! ` after code on the
  definition line (e.g., `Constant FOO = 42;  !! doc for FOO`).
  Stored in a persistent list, looked up by file+line at output time.
- [x] Lexer hook in `lexer.c`: detects `!! ` (checks `lookahead2`
  for space/tab), captures text, calls `index_doc_comment_line()`
  or `index_doc_comment_trailing()`
- [x] Doc attached to routines, objects, and all symbols (via
  `assign_symbol_base()` hook)
- [x] `"doc"` field in JSON for routines[], objects[], symbols[],
  globals[], arrays[]

### 1f. Error output in JSON — DONE

- [x] `errors[]` section in JSON with file, line, message, severity
  (error/warning/fatal)
- [x] Hook in `message()` in `errors.c` captures all errors and warnings
- [x] JSON output always produced even with errors (partial index +
  diagnostics) — changed `compile()` in `inform.c`
- [x] Severity mapping: style 1/3 → "error", style 2 → "warning",
  style 4 → "fatal"

### 1g. Verb/grammar table — DONE

- [x] `verbs[]` section in JSON with verb_num, words (dictionary
  entries), actions (stripped of `__A` suffix), file, line
- [x] Helper functions `index_get_verb_word_count()` and
  `index_get_verb_word()` in `verbs.c` to expose static English_verbs
  data to `index.c`
- [x] Actions extracted from grammar line binary data for each verb

### 1h. Dictionary words

Add `dictionary[]` section with dict words and their flags. Parsed in
`text.c`/`directs.c`. Useful for completions on dictionary words and for
understanding what words the game recognizes.

## Phase 2: TypeScript language server (Sonnet, some Opus)

Well-trodden territory — `vscode-languageserver` handles the protocol.
Sonnet is fine for most of this; Opus for design-sensitive features.

### 2a. Scaffolding (Sonnet)

- New TS project with `vscode-languageserver`
- Document sync: open/save triggers reindex via `inform6 -y`
- Parse and cache the JSON index
- LSP lifecycle (initialize, shutdown, capabilities)
- VS Code extension packaging

### 2b. Core features

| Feature              | Notes                                      | Model  |
|----------------------|--------------------------------------------|--------|
| Go-to-definition     | Symbol lookup from index                   | Sonnet |
| Find references      | May need compiler-side `USED` tracking     | Opus/Sonnet |
| Hover                | Design-sensitive — what info for each type  | Opus   |
| Completions          | Scope-aware, needs locals + globals        | Opus   |
| Diagnostics          | Forward compiler stderr as diagnostics     | Sonnet |
| Folding ranges       | From range data (Phase 1b)                 | Sonnet |
| Document symbols     | Outline view from index                    | Sonnet |
| Workspace symbols    | Search across all indexed symbols          | Sonnet |

### 2c. Polish (Sonnet)

- Signature help for known routines
- Semantic token highlighting
- Performance: caching, incremental reindex
- Multi-root workspace support

## Phase 3: Advanced (Opus)

- Rename symbol (hard — no AST, would need compiler-side support or
  text-based refactoring)
- Code actions (e.g., extract routine)
- Inlay hints (e.g., show property types)

## Test corpus

- `test/corpus/tiny.inf` — minimal, no library
- `test/corpus/small.inf` — uses standard library, has object with embedded routine
- `~/if/inform6-langserver/test/corpus/library_of_horror.inf` — real game with
  PunyLib, ~1000 symbols, ~300 routines

## Reference

The ANTLR-based language server (`~/if/inform6-langserver/`) has useful design
decisions for hover content, docstring conventions, etc. Reference it for
*what to show*, not *how to parse*. Point at specific files when implementing
each feature rather than reading the whole codebase.

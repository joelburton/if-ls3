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

### 1b. Ranges (start/end lines)

Add end_line to routines (capture at `]` in `parse_routine`, `syntax.c:525-536`).
Add start_line/end_line to object definitions (hook into `objects.c`).
This enables folding in the language server.

Target JSON:
```json
"routines": [
    {"name": "MyFunc", "file": "small.inf",
     "start_line": 15, "end_line": 18, "locals": ["a", "b"]}
]
```

### 1c. Objects section

Add `objects[]` to the JSON. Objects are parsed in `objects.c`; the data we
need is available during parsing:

- name, parent, class
- attributes (has ...)
- properties (with ...) and their types (routine, string, value)
- source location and range

Target JSON:
```json
"objects": [
    {"name": "TheRoom", "file": "small.inf",
     "start_line": 5, "end_line": 12,
     "class": "Object", "parent": null,
     "attributes": ["light"],
     "properties": ["description", "before"]}
]
```

### 1d. Globals and arrays

Add `globals[]` and `arrays[]` to the JSON with definition locations. These
are already in the symbol table; we may just need to enrich the symbols
output or add dedicated sections with more detail (array size, type).

### 1e. Doc comments

Introduce a doc-comment convention for Inform6 using `!!` (double-bang).
Two forms:

**Form 1 — preceding lines:**
```inform6
!! This is a doc comment for MyFunc.
!! It can span multiple consecutive !! lines.
[ MyFunc a b; ... ];
```
Must be `!!` at the start of the line (ignoring leading whitespace), with
no non-comment/non-blank lines between the comment block and the definition.
Blank lines between the `!!` block and the definition are fine — the buffer
is only cleared when a non-blank, non-comment line is encountered that isn't
the definition itself.

**Form 2 — trailing on definition line:**
```inform6
Constant FOO = 42;    !! This is a doc comment for FOO
```
Must start and end on the same line as the identifier's definition.

**Implementation:**

Hook into the lexer (`lexer.c`), which currently discards all comments.
Add two buffers:

1. *Preceding doc buffer* — when the lexer sees a `!!` comment on its own
   line, append to buffer. Clear on any non-`!!`, non-blank line. When
   `index.c` records a definition, consume the buffer.

2. *Trailing doc buffer* — when the lexer sees `!!` after code on the same
   line, stash it with the line number. When `index.c` records a definition
   whose start line matches, attach it. **Fallback:** if the lexer hook
   proves too tangled, trailing doc comments can be found by post-processing
   — the JSON already has file + line for every symbol, so the consumer can
   scan that source line for `!!` directly.

Both forms are purely additive — buffering data that's currently discarded.
No parser changes needed, just lexer + index. This is done at the compiler
level (not the language server) so other tools can benefit from it via `-y`.

Target JSON:
```json
{"name": "MyFunc", "type": "routine", ..., "doc": "This is a doc comment for MyFunc."}
{"name": "FOO", "type": "constant", ..., "doc": "This is a doc comment for FOO"}
```

### 1f. Error output in JSON

When compilation has errors, still output the index (with whatever was
successfully parsed) plus an `errors[]` section:

```json
"errors": [
    {"file": "game.inf", "line": 42,
     "message": "Expected ';' after expression", "severity": "error"}
]
```

This requires hooking into `errors.c` to capture messages instead of (or in
addition to) printing them to stderr. Important for live editing — the file
will often have errors.

### 1g. Verb/grammar table

Add `verbs[]` section capturing the grammar table (Verb directives,
grammar lines). This is parsed in `verbs.c`. Useful for go-to-definition
on action names and for understanding game commands.

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

# Inform6 Compiler — Language Server Fork

This is a fork of the Inform 6.45 compiler (Graham Nelson, 1993-2025) with
additions to support a language server for Inform6.

## Build

```bash
cd Inform6
make          # or: cc -O2 --std=c11 -DUNIX -o inform6 *.c
```

All `.c` files in `Inform6/` are compiled together. There is no separate link step.
The `header.h` file is the single shared header included by every `.c` file.

## Architecture

The compiler is a single-pass design: lexing, parsing, and code generation are
interleaved. There is no AST. Key modules:

- `lexer.c` — tokenizer. Outputs via globals `token_type`, `token_value`, `token_text`.
  Call `get_next_token()` / `put_token_back()`.
- `syntax.c` — top-level parser. `parse_program()` drives everything.
  `parse_routine()` handles function definitions including local variable parsing.
- `directs.c` — directive parser (`Constant`, `Global`, `Object`, `Class`, etc.)
- `states.c` — statement parser (`if`, `for`, `print`, etc.)
- `expressp.c` / `expressc.c` — expression parser and code generator.
- `symbols.c` — symbol table. `symbols[]` array indexed by int, hash-table linked.
- `objects.c` — object/class definition parser.
- `verbs.c` — grammar (Verb directive) parser.
- `asm.c` — assembler / code generator.
- `inform.c` — main entry, switch parsing, compilation lifecycle.
- `index.c` — **our addition**: JSON symbol index output for language server use.

## Global state

The compiler uses extensive global mutable state (~300 static vars, ~500 externs).
Every module has `init_*_vars()`, `*_begin_pass()`, `*_allocate_arrays()`, and
`*_free_arrays()` functions called from `inform.c`. When adding a new module,
wire into all four lifecycle hooks.

## The `-y` index flag

Our addition. Running `inform6 -y +libpath source.inf` outputs a JSON symbol
index to stdout instead of a game file. The full compilation still runs
(including codegen into memory) — we just skip writing the output file and
dump the symbol table instead. `-y` implies `-q2` (silent mode).

The index includes:
- `files[]` — all source files parsed (main + includes)
- `symbols[]` — every defined symbol with name, type, value, flags, is_system, file, line, doc
- `routines[]` — every routine with name, locals, start/end lines, embedded flag, doc
- `objects[]` — every object/class with name, shortname (quoted string name if given, e.g. `"The Room"`), is_class, parent, attributes, properties, private_properties, start/end lines, doc; attributes and properties are `{name, line}` objects (line = source line within the object body)
- `globals[]` — non-system global variables with name, file, line, doc
- `constants[]` — non-system constants with name, file, line, doc
- `arrays[]` — arrays with name, array_type, size, is_static, file, line, doc
- `verbs[]` — verb definitions with dictionary words, actions, file, line
- `dictionary[]` — all dictionary words with flags (noun, verb, preposition, meta, plural)
- `errors[]` — compilation errors/warnings with file, line, message, severity
- `grammar_action_refs[]` — source locations (`{file, line}`) of every action-name
  identifier after `->` in a Verb/Extend grammar line. Used by the language server
  to distinguish the grammar-arrow `->` (action reference, navigate to `FoozleSub`)
  from the array-fill operator `->` and property-access `->` (both use the same token
  but must NOT trigger action navigation).

JSON is always output even with compilation errors (partial index + diagnostics).

All `file` fields in the JSON are absolute paths (resolved via `realpath()`).
The main source file was previously emitted as a relative path; it is now
absolute like all other files.

Doc comments use `!! ` (two bangs + space) convention. Preceding `!! ` lines
before a definition, or trailing `!! ` on the same line as a definition.

## The `-q2` silent flag

Our addition. Suppresses the banner ("Inform 6.45 for ...") and the
end-of-compile summary ("Compiled with ..."). Useful for machine-readable
output. Automatically set by `-y`.

## Errors/warnings to stderr

Our change. All compiler errors, warnings, and fatal errors are written to
stderr (via `fprintf(stderr, ...)` in `errors.c`), not stdout. This keeps
stdout clean for machine-readable output and is a general improvement.

## Key types for index work

- `symbolinfo` (header.h:900) — name, value, type, flags, line (brief_location)
- `brief_location` (header.h:706) — file_index (1-based into InputFiles[]), line_number
- `FileId` (header.h:936) — filename, handle
- Symbol types: `ROUTINE_T`, `OBJECT_T`, `CLASS_T`, `CONSTANT_T`, `ATTRIBUTE_T`,
  `PROPERTY_T`, `INDIVIDUAL_PROPERTY_T`, `GLOBAL_VARIABLE_T`, `ARRAY_T`, `STATIC_ARRAY_T`
- Symbol flags: `UNKNOWN_SFLAG`, `SYSTEM_SFLAG`, `INSF_SFLAG` (system file),
  `USED_SFLAG`, `REPLACE_SFLAG`, etc.

## Local variables

Local variables are NOT in the symbol table. They exist only during routine
parsing in a separate name buffer. `index.c` hooks into `parse_routine()` in
`syntax.c` (right after `construct_local_variable_tables()`) to capture them
before they're cleared for the next routine.

## Error handling

Fatal errors use `longjmp(g_fallback)`. Non-fatal errors increment `no_errors`
and often call `panic_mode_error_recovery()` (skip to next semicolon). The
compiler is not designed for error-tolerant parsing of incomplete code.

## Testing

Test corpus is in `test/corpus/`:
- `tiny.inf` — minimal, no library includes
- `small.inf` — uses standard Inform6 library, has object with embedded routine

```bash
cd Inform6

# Smoke test: tiny (no library needed)
./inform6 -y ../test/corpus/tiny.inf 2>/dev/null | python3 -m json.tool

# Smoke test: standard library
./inform6 -y ../test/corpus/small.inf 2>/dev/null | python3 -m json.tool

# Larger test: PunyLib game
./inform6 -y +/Users/joel/if/puny/lib ~/if/inform6-langserver/test/corpus/library_of_horror.inf 2>/dev/null | python3 -m json.tool

# Verify normal compilation still works
./inform6 ../test/corpus/tiny.inf
```

## Related project

The language server lives at `langserver/` in this repo (TypeScript). The old
prototype at `~/if/inform6-langserver/` is superseded and kept only for reference.
The compiler fork is used as an out-of-process indexer, invoked by the language
server on file save to provide semantic symbol data.

---

# Language Server (`langserver/`)

## Architecture

The server is **purely reactive** — no in-process Inform 6 parser, no
incremental analysis. On every file save the indexer spawns `inform6 -y`,
parses the JSON from stdout, and holds the resulting `CompilerIndex` in
memory. All LSP requests are answered from that snapshot.

One `CompilerIndex` per main file. A workspace with two entries in
`inform6rc.yaml` has two independent compilations. Workspace-symbol search
and diagnostics merge across all of them; hover/definition/completions use
whichever index owns the file being edited.

## Module map

```
langserver/src/
  server/
    server.ts       LSP wiring: creates connection, dispatches all requests.
                    Also contains the action-reference detection helpers
                    (see below). This is the only file that touches the
                    LSP connection object.
    indexer.ts      Spawns inform6 -y, handles timeouts and parse errors,
                    returns CompilerIndex. Filters veneer routines
                    (compiler-generated runtime support) from routines[].
    types.ts        TypeScript interfaces matching the -y JSON schema.
    main.ts         Entry point; just imports server.ts.

  features/         Pure functions — each takes a CompilerIndex (or similar)
                    and returns LSP types. No side effects, easy to test.
    symbolLookup.ts Shared loc() helper and resolveSymbol() tagged-union
                    lookup (routines → objects → globals → constants →
                    arrays → non-system symbols). Add new symbol categories
                    here; consumers switch on `kind`.
    definition.ts   findDefinition() — uses resolveSymbol() for general
                    lookup; handles action refs and object-context separately.
    hover.ts        findHover() — similar lookup but constants before globals,
                    system symbols included in fallback. Kept separate from
                    resolveSymbol() for this reason.
    completions.ts  getCompletions() — dot completion and general completion.
    diagnostics.ts  pushDiagnostics() — compiler errors + #IfDef warnings.
                    scanIfDefWarnings() scans source text for #IfDef names
                    not in the known-symbol union; buildUnionKnownNames()
                    builds that union across all compilations.
    semanticTokens.ts getSemanticTokens() — returns LSP 5-integer delta-
                    encoded token array. Locals shadow globals/constants.
                    Tokens are sorted before encoding (local and global
                    scans run separately and may produce out-of-order results).
    documentSymbols.ts  Per-file outline; embedded routines nested under
                    their parent object.
    workspaceSymbols.ts Cross-index substring search; deduplicates by name.
    wordAtPosition.ts   isInComment(), wordAtPosition(), objectBeforeDot().
                    Used by server.ts to suppress features inside comments
                    and detect ObjName.prop and ##Action contexts.
    keywords.ts     Static keyword hover text and completion items.
                    findPrintRuleHover() detects print (Rule) context.

  workspace/
    config.ts       loadConfig() — reads inform6rc.yaml, merges global
                    defaults with per-file overrides, expands ~/ paths.

  test/             vitest suite (153 tests). Pure-function modules are
                    tested directly with fixture CompilerIndex objects.
                    compiler-index.test.ts is an integration test that
                    runs the real binary; skipped if binary is absent.
```

## Non-obvious behaviors

**Action reference detection** (`server.ts`): The token `->` is used three
ways in Inform 6 — grammar action (`* noun -> Take`), array fill (`x-->0`),
and property access (`obj->prop`). The server uses `grammar_action_refs[]`
from the index (source locations of every `->` action name in Verb/Extend
lines) to distinguish them. `##Word` and `<Word>` are unambiguously action
references. `Word:` in a switch may be an action OR a value label (e.g. an
object name), so a miss falls through to normal lookup.

**hover.ts vs resolveSymbol()**: hover looks up constants before globals
(not the order in `resolveSymbol`), needs a second `symbols[]` find to get
a constant's numeric value, and includes system symbols in its fallback so
you can hover over `self`, `nothing`, etc. These differences make
`resolveSymbol()` a poor fit; hover keeps its own find cascade.

**Embedded routines**: Object property routines (e.g. `before [; ... ]`)
appear in `routines[]` with `embedded: true`. They are excluded from
general completions (not callable by bare name), excluded from workspace
symbols, nested under their parent in document symbols, and their locals
are still in scope for hover/completions when the cursor is inside them.

**Semantic token encoding**: LSP requires 5 integers per token in delta
format — `[deltaLine, deltaChar, length, tokenType, modifiers]`. `deltaChar`
is relative to the previous token only when both are on the same line;
otherwise it is absolute. Tokens must be sorted by position before encoding;
the local-variable scan and global/constant scan run independently and can
produce interleaved results, especially when embedded routines are listed
out of order in the index.

**#IfDef warnings**: The compiler itself does not warn about unknown names
in `#IfDef`/`#IfNDef`. `scanIfDefWarnings()` handles this by scanning raw
source text and checking names against the union of all symbol names and
`externalDefines` across all compilations. A name known in any one
compilation is not warned about (it may be intentionally absent in others).

## Testing

```bash
cd langserver
npm test          # run vitest suite
npm run check     # TypeScript type-check only
```

Test files live in `src/test/`. `fixture.ts` defines a shared minimal
`CompilerIndex` used by most unit tests. Each feature module has its own
test file. The compiler integration test auto-skips when `Inform6/inform6`
is absent.

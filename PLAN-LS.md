# Inform6 Language Server — Phase 2 Plan

## Overview

A TypeScript language server that invokes the Inform6 compiler as an
out-of-process indexer (`inform6 -y +libpath mainfile.inf`) and consumes
the resulting JSON to power LSP features. No parsing in the language server —
everything comes from the compiler JSON.

## Location

`~/if/if-ls3/langserver/` — a self-contained TypeScript project producing a
VS Code extension.

## Pending compiler-side fix (before LS work begins)

**Relative paths in JSON output.** ✅ Done — all `file` fields are now
absolute paths via `realpath()` in `index.c`.

## Config file

`inform6rc.yaml` (no leading dot — visible, not hidden) in the workspace root.

```yaml
# Path to inform6 binary (supports ~)
compiler: ~/if/if-ls3/Inform6/inform6

# Library include path (the +path argument)
libraryPath: ~/if/puny/lib

# Entry-point file for compilation (relative to workspace root)
mainFile: horror.inf

# Compiler switches (space-separated; no quoting needed for typical switch strings)
switches: -~S

# Defines passed as $NAME or $NAME=VALUE (each becomes a $... argument)
defines:
  - GRAMMAR_META_FLAG=1
  - DEBUG
```

Existing fields from the old server (`target`, `externalDefines`)
are ignored but harmless if present.

## Directory structure

```
langserver/
  package.json          extension manifest + npm scripts
  tsconfig.json
  src/
    server/
      main.ts           node IPC bootstrap (5 lines)
      server.ts         LSP connection, capability declaration, handler wiring
      indexer.ts        spawn compiler, parse JSON stdout, cache by mtime
      types.ts          TypeScript interfaces matching compiler JSON schema
    features/
      diagnostics.ts    errors[] → LSP Diagnostic[], push per file
      definition.ts     word at cursor → symbol lookup → Location
      hover.ts          word at cursor → Markdown (user symbols + keywords)
      documentSymbols.ts  outline: routines, objects, globals, constants
      wordAtPosition.ts   identifier extraction at cursor position
    workspace/
      config.ts         load + validate inform6rc.yaml
  client/
    extension.ts        VS Code client: start server, file watcher
```

## Indexer (`indexer.ts`)

- `reindex(config, workspaceRoot)`: spawns `inform6 -y +libPath mainFile`,
  reads stdout, parses JSON
- Caches last `CompilerIndex`; invalidation key is mtime of `mainFile`
- 10-second timeout; kill process and return null if exceeded
- Logs a clear warning if the binary is not found or spawn fails

## Reindex trigger

- **On open**: reindex if no cached index
- **On save** of any `.inf` or `.h` file in the workspace: reindex immediately,
  then push diagnostics
- No debounce (save-triggered only for now; switch to debounced-on-change later)

## LSP capabilities

| Capability | Notes |
|---|---|
| `textDocumentSync` | Save + Open |
| `definitionProvider` | true |
| `hoverProvider` | true |
| `documentSymbolProvider` | true |
| Diagnostics | push via `sendDiagnostics` |

Not in phase 1: completions, folding, semantic tokens, workspace symbols,
find references, signature help.

## Feature: Diagnostics

- Walk `errors[]`; map `file` (absolute path after compiler fix) → URI
- Severity: `"error"` / `"fatal"` → `DiagnosticSeverity.Error`,
  `"warning"` → `DiagnosticSeverity.Warning`
- Group by URI; call `sendDiagnostics` for each affected file
- Clear diagnostics for files that had errors last run but have none now

## Feature: Go-to-definition

1. Extract identifier at cursor (`wordAtPosition`)
2. **Object.property lookbehind**: if the character immediately before the
   identifier is `.`, scan left for an object name. If found, look up that
   object in `objects[]` and navigate to the matching entry in its
   `properties[]` or `private_properties[]` array (each entry has a `line`).
   This handles `TheRoom.description` → jump directly to the `description`
   line inside `TheRoom`, not to the library `Property description` declaration.
3. Otherwise, case-insensitive name lookup in order: `routines[]`, `objects[]`,
   `globals[]`, `constants[]`, `arrays[]`, then `symbols[]`
4. Map `file` (absolute path) + `start_line` / `line` → `Location`
5. Return first match (multiple results if `Replace` is in play — rare)

## Feature: Hover

Build Markdown based on what the name resolves to:

| Kind | Content |
|---|---|
| Routine | `**Name**(local1, local2, ...)` + doc + `*file:line*` |
| Object | `**Name** "shortname"` (if shortname present) + parent + attributes + doc + `*file:line*` |
| Constant | `**NAME** = value` + doc + `*file:line*` |
| Global | `**name** (global variable)` + doc + `*file:line*` |
| Array | `**name** (array, N entries)` + doc + `*file:line*` |
| Property/Attribute | `**name** (property\|attribute)` + `*file:line*` |
| Keyword/operator | static lookup table — **low priority** |

Lookup order: `routines[]` first (richest data), then `objects[]`, then
`symbols[]` for anything else (properties, attributes, etc.).

Keyword and operator hover help is in scope but lower priority than the
symbol-based hover above. The old ANTLR server (`~/if/inform6-langserver/`)
has a good reference table for both.

## Feature: Document Symbols (Outline)

Walk `routines[]`, `objects[]`, `globals[]`, `constants[]` filtered to items
whose `file` matches the open document:

- Routines → `SymbolKind.Function`, range from `start_line` / `end_line`
- Embedded routines (name contains `.` or `::`) → nested under parent object
- Objects → `SymbolKind.Class` (if `is_class`) or `SymbolKind.Object`
- Globals → `SymbolKind.Variable`
- Constants → `SymbolKind.Constant`

Embedded routine naming convention: `ObjectName.property_name` for objects,
`ClassName::property_name` for class-defined routines. Parse the prefix to
find the parent for nesting.

## VS Code extension

`package.json` contribution points:
- Language `inform6` with `"aliases": ["Inform 6v3", "inform6"]` — the first
  alias is what VS Code displays in the status bar, giving a clear visual
  signal that this LS is active
- Activate on `onLanguage:inform6`, file associations for `.inf` and `.h`
- No TextMate grammar included in phase 1 — plain text highlighting only

`client/extension.ts`:
- `activate`: create `LanguageClient` pointing at compiled server entry point
- Watch `inform6rc.yaml` for changes → restart server

## Build order

1. ✅ **`types.ts`** — TypeScript interfaces for compiler JSON
2. ✅ **`config.ts` + `indexer.ts`** — core pipeline (async spawn, 10 s timeout, spawn counter)
3. ✅ **`server.ts` scaffold** — minimal server; VS Code extension loads and starts
4. ✅ **`diagnostics.ts`** — full pipeline validated
5. ✅ **`definition.ts` + `hover.ts`** — hover shows relative paths from workspace root
6. ✅ **`documentSymbols.ts`** — outline view with embedded routines nested under objects
7. ✅ **`client/extension.ts` + `package.json`** — `.vsix` packaging, `inform6rc.yaml` watcher
8. ✅ **Keyword/operator hover table** — `keywords.ts`; checked as last fallback after all symbol lookups
9. ✅ **Language configuration** — `language-configuration.json`; bracket matching (`[/]` `{/}` `(/)`),
   comment toggling (`!`), auto-close, and surrounding pairs. Pure VS Code extension feature — no LS involvement.

## Notes on compiler JSON

- `symbols[]` contains all symbols including system ones; `is_system: true`
  flags library/built-in symbols. `routines[]`, `objects[]`, `globals[]`,
  `constants[]`, `arrays[]` are pre-filtered to user-defined items and are
  the preferred lookup source.
- `routines[].locals[]` is the full local variable list; in Inform6 all
  declared locals are also addressable as parameters, so this is the routine
  signature.
- `files[]` is a snapshot of all parsed files in parse order; after the
  absolute-path fix, each entry is an absolute path usable directly as a URI.
- JSON is always emitted even on compilation errors (partial index +
  `errors[]`), so the LS degrades gracefully when code doesn't compile.

## Added during phase-2 (not in original plan)

- ✅ **Action navigation**: `Jump:` (action label), `##Jump` (action value),
  `<Jump ...>` / `<<Jump ...>>` (action statements), and `* noun -> Jump`
  (Verb directive grammar) all navigate to `JumpSub`.
  `<` is distinguished from comparisons (`x<a`) by checking for a non-identifier
  character before the `<`. Paren forms `<<(x)>>` are naturally excluded.
  No fallthrough to a routine named `Jump` — action context is unambiguous.
- ✅ **Relative paths in hover**: file references show paths relative to
  workspace root when the path requires ≤ 2 leading `../` segments; deeper
  paths (e.g. into a library several directories away) fall back to the
  absolute path, which is more navigable than `../../../../../../lib/foo.h`.
- ✅ **Async compiler spawn**: `spawnSync` replaced with async `spawn` so
  hover/definition/etc. remain responsive during the ~1–2 s compile window.
- ✅ **Grammar action refs**: compiler emits `grammar_action_refs[]` (file+line
  positions of action names after `->` in Verb/Extend grammar lines). The LS
  uses these to distinguish grammar arrows from array-operator `-->` and
  property-access `->`, preventing false action navigation (e.g. `Array x --> Foozle`
  no longer jumps to `FoozleSub`).
- ✅ **Workspace symbol search** (`Cmd+T`): case-insensitive substring match
  over routines, objects/classes, globals, constants, and arrays. Embedded
  routines are skipped (they appear under their parent in the document outline).
- ✅ **Completions**: two modes — dot-triggered (`ObjName.`) returns the
  object's properties, private properties, and attributes; general completion
  returns locals of the enclosing routine followed by all routines (with
  parameter list as detail), objects, globals, constants, and arrays.
- ✅ **Object shortname**: compiler emits `objects[].shortname` (the quoted
  string name, e.g. `"The Room"`, when present; absent otherwise). Hover shows
  it as `**TheRoom** "The Room" (object)`; outline shows it in the `detail`
  slot (grayed text beside the identifier in VS Code's outline view).

## Known limitations / deferred

- **Outline staleness after save**: VS Code's `documentSymbol` is pull-based
  with no server-push refresh. Outline updates on the next keystroke after a
  save+reindex, not immediately. Acceptable with autosave; may revisit with a
  custom `TreeDataProvider` if it proves annoying.

- ✅ **TextMate grammar** (`langserver/syntaxes/inform6.tmLanguage.json`):
  copied from the old project and substantially improved:
  - **Verb/Extend mini-language**: `Verb`/`Extend` directives are now a
    `begin`/`end` block with their own sub-rules. Grammar stars (`*`) →
    `keyword.control.grammar.star`, grammar arrows (`->`) →
    `keyword.control.grammar.arrow`, action names after `->` →
    `entity.name.function.action`. Built-in grammar tokens (`noun`, `held`,
    `scope=Routine`, etc.) are colored within the block; `meta`/`reverse`
    modifiers work at both the verb and grammar-line level. `first`/`last`/
    `only`/`replace` modifiers (Extend) are inside the block only.
  - **Action invocations**: `<<ActionName ...>>` (unambiguous — `begin`/`end`
    block) and `<ActionName ...>` (capital-letter heuristic to avoid matching
    comparison operators) both color the delimiters as `keyword.control.action`
    and the action name as `entity.name.function.action`.
  - **Print format specifiers**: `(char)`, `(string)`, `(The)`, `(a)`, etc.
    colored as `keyword.other.print-format` inside routine bodies.
  - **Object body sections**: `has`/`with`/`private` sections each have
    `begin`/`end` blocks (safe at the top level — these keywords only appear
    as operators inside `embeddedRoutine` blocks). Property names in
    `with`/`private` are colored as `entity.name.function.property`;
    attribute names in `has` as `variable.other.attribute`. `embeddedRoutine`
    is included inside property definitions so `[...]` routine values don't
    have their commas/semicolons misread as section delimiters.
  - **Doc-comments**: `!! ` lines → `comment.line.documentation.inform6`
    (before the plain `!` rule); users can set a distinct color in
    `editor.tokenColorCustomizations`.
  - **Removed stale library lists**: `supportFunction`, `supportConstant`,
    `supportVariable` (library functions, constants, action names, variables,
    attributes) removed — the LS classifies these from the symbol index and
    the static lists were incomplete and stale.
  - **`Fake_action`** promoted from `invalid.deprecated` to
    `keyword.other.directive` (no longer deprecated in modern Inform 6).
  - **Numeric literal fix**: `(\\b|-)\\d+` → `\\b\\d+` so `-` in `x - 1`
    is the arithmetic operator, not part of a negative number token.
  - **`CompassDirection`** removed from built-in class list (library symbol).
  - **`variable.language.inform6`** reduced to `self` only (the sole genuine
    language keyword in that list; library globals handled by the LS).
  - **`support` wrapper** collapsed; `supportOpcode` inlined.
  - **Undefined `#stringInvalid`** references removed.
- ✅ **Extension config settings** (`package.json`):
  - `inform6.enableTextMateHighlighting` (default: true) — swaps
    `inform6-active.tmLanguage.json` between the full grammar and an empty
    one at activation time; toggle command available in the command palette.
  - `inform6.enableLanguageServer` (default: true) — skips `startClient()`
    if false; `onDidChangeConfiguration` restarts or stops the client when
    the setting changes.

## Future (post-phase-2)

- Debounced reindex on keystrokes — deliberately deferred; compiler needs
  on-disk content, so save-triggered reindex is the right model. VS Code
  autosave means users already get near-real-time updates without explicit saves.
- Find references (requires compiler-side reference tracking in `expressp.c`)
- Signature help for routine calls
- Semantic token highlighting
- Rename symbol

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

**Relative paths in JSON output.** The `file` field for the main source file
is currently a bare relative path (e.g. `"small.inf"`) while included library
files are absolute. The LS needs absolute paths to build document URIs. Fix:
canonicalize all paths to absolute in `index.c` before emitting JSON.

## Config file

`inform6rc.yaml` (no leading dot — visible, not hidden) in the workspace root.

```yaml
# Path to inform6 binary (supports ~)
compiler: ~/if/if-ls3/Inform6/inform6

# Library include path (the +path argument)
libraryPath: ~/if/puny/lib

# Entry-point file for compilation (relative to workspace root)
mainFile: horror.inf
```

Existing fields from the old server (`defines`, `target`, `externalDefines`)
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
| Object | `**Name**` + parent + attributes + doc + `*file:line*` |
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

1. **`types.ts`** — TypeScript interfaces for compiler JSON; everything depends on these
2. **`config.ts` + `indexer.ts`** — core pipeline; test standalone with `ts-node`
3. **`server.ts` scaffold** — minimal server returning empty results; verify
   VS Code extension loads and server starts
4. **`diagnostics.ts`** — first visible feature; validates the full pipeline
5. **`definition.ts` + `hover.ts`** — main daily-use value
6. **`documentSymbols.ts`** — outline view
7. **`client/extension.ts` + `package.json`** — wire into VS Code as `.vsix`
8. **Keyword/operator hover table** — after everything above works

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

## Future (post-phase-2)

- Debounced reindex on keystrokes (not just save)
- Find references (requires compiler-side reference tracking in `expressp.c`)
- Completions (scope-aware: locals + globals + object properties)
- Signature help for routine calls
- Semantic token highlighting
- Workspace symbol search
- Rename symbol

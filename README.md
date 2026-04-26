# Inform 6 Language Server

A language server for [Inform 6](https://inform-fiction.org/) built on a
lightly-forked Inform 6.45 compiler. The compiler is used as an out-of-process
indexer: on each file save it runs a full compilation and emits a JSON symbol
index that the language server uses to provide semantic features.

Features: go-to-definition, hover, completions, diagnostics, semantic token
highlighting, document/workspace symbols, and snippets. See
[`langserver/README.md`](langserver/README.md) for the full feature list and
workspace configuration reference.

---

## Repository layout

```
Inform6/            Forked Inform 6.45 compiler (C)
  index.c           Our addition: -y flag, JSON symbol index output
  inform.c / ...    Upstream compiler source (lightly patched)
  makefile          Single-step build: cc *.c

langserver/         VS Code extension + language server (TypeScript)
  client/           VS Code extension host (activates the server)
  src/
    server/         LSP wiring: connection, indexer, request dispatch
    features/       Pure-function handlers: hover, definition, completions, …
    workspace/      Config loading (inform6rc.yaml)
    test/           vitest unit + integration tests
  syntaxes/         TextMate grammar for .inf / .h files
  snippets/         Code snippets (activated with zz prefix)
  scripts/          esbuild bundle scripts

test/corpus/        Manual smoke-test sources
  tiny.inf          Minimal game (no library, used in integration tests)
  small/            Standard-library game with objects, routines, verbs
  library-of-horror/ Larger PunyInform game for manual testing

.github/workflows/  CI: builds the compiler, type-checks TS, runs tests
Makefile            Top-level convenience targets (see below)
CLAUDE.md           AI-collaborator context (architecture, conventions)
```

---

## Building

### Prerequisites

- A C11 compiler (`cc` / `gcc` / `clang`)
- Node.js 18+ and npm

### Targets

```
make compiler     Build the Inform 6 compiler binary (Inform6/inform6)
make langserver   Compile TypeScript and bundle the language server
make ext          Package the VS Code extension as a .vsix
make ext-install  Package and install the extension into VS Code
make test         Run the vitest test suite
make clean        Remove all generated artifacts
```

Or drive the steps individually:

```bash
# Compiler
make -C Inform6

# Language server
cd langserver
npm install
npm run build   # compiles TS + bundles server into bundled-server/server.cjs

# Tests
cd langserver && npm test

# VS Code extension
cd langserver && npm run package-vsix   # produces inform6-lsp-0.1.0.vsix
cd langserver && npm run install-vsix   # installs it
```

---

## Using the language server outside VS Code

The bundled server speaks plain LSP over stdio. After running
`make langserver`, point your editor at:

```
node /path/to/repo/langserver/bundled-server/server.cjs --stdio
```

Configure your editor to associate the server with `*.inf` and `*.h` files.
See [`langserver/README.md`](langserver/README.md) for the `inform6rc.yaml`
workspace config (compiler path, library path, per-file settings).

### Neovim (nvim-lspconfig)

```lua
local lspconfig = require("lspconfig")
local configs   = require("lspconfig.configs")

configs.inform6 = {
  default_config = {
    cmd        = { "node", "/path/to/repo/langserver/bundled-server/server.cjs", "--stdio" },
    filetypes  = { "inform6" },
    root_dir   = lspconfig.util.root_pattern("inform6rc.yaml", ".git"),
    single_file_support = true,
  },
}

lspconfig.inform6.setup {}
```

### Helix

In `~/.config/helix/languages.toml`:

```toml
[[language]]
name = "inform6"
language-servers = ["inform6-lsp"]

[language-server.inform6-lsp]
command = "node"
args    = ["/path/to/repo/langserver/bundled-server/server.cjs", "--stdio"]
```

### IntelliJ-based IDEs (LSP4IJ)

**Language server**

1. Install the [LSP4IJ](https://plugins.jetbrains.com/plugin/23257-lsp4ij) plugin
   from the JetBrains Marketplace (*Settings → Plugins → Marketplace*).

2. Open *Settings → Languages & Frameworks → Language Servers* and add a new
   server:
   - **Name**: Inform 6
   - **Command**: `node /path/to/repo/langserver/bundled-server/server.cjs --stdio`
   - **File name patterns**: `*.inf`, `*.h`

**Syntax highlighting (TextMate bundle)**

Run `make langserver` first (or `npm run build` inside `langserver/`) to
produce the bundle, then:

1. Open *Settings → Editor → TextMate Bundles* and click **+**.
2. Point it at `langserver/textmate-dist/inform6.tmbundle`.

---

## Architecture notes

The compiler is a single-pass design with no AST. The `-y` flag (added in
`Inform6/index.c`) runs the full compilation pipeline into memory, skips
writing the output file, and dumps a JSON symbol index to stdout instead.
All compiler errors go to stderr so stdout stays clean for machine-readable
output.

The language server is purely reactive: it spawns the compiler on save,
parses the JSON, and serves all LSP requests from the resulting in-memory
index. There is no incremental parsing or in-server Inform 6 grammar.

See `CLAUDE.md` for a detailed module-by-module breakdown intended for
contributors (human or AI).

---

## Credits

- **Inform 6 compiler** — Graham Nelson and contributors (GPL-2.0)
- **[vscode-inform6](https://gitlab.com/Natrium729/vscode-inform6)** by
  Nathanaël Marion (MIT) — the TextMate grammar in `langserver/syntaxes/`
  descends from his, and the compile-and-run story-launcher logic is adapted
  from his extension
- **[IF Player](https://marketplace.visualstudio.com/items?itemName=natrium729.if-player)**
  by Nathanaël Marion — the in-editor story player used by the Compile and Run
  feature

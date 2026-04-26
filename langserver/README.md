# Inform 6 Language Server

Language intelligence for [Inform 6](https://inform-fiction.org/), the
interactive fiction programming language. Works with the standard Inform
library, PunyInform, and standalone Inform 6 projects.

## Features

### Syntax highlighting

Full TextMate grammar for Inform 6 source files (`.inf`, `.h`), including
strings, dictionary words, comments, directives, statements, and operators.
Can be toggled on/off independently of the language server via the
**Inform 6: Toggle TextMate Highlighting** command.

### Semantic token highlighting

The language server overlays compiler-aware semantic highlighting on top of
the TextMate grammar. Routines, objects, classes, constants, globals, arrays,
properties, attributes, actions, and dictionary words are each highlighted
with distinct token types.

### Go to definition

Ctrl+click (or F12) on any symbol to jump to its definition:

- Routines, objects, classes, globals, constants, arrays
- Properties and attributes (including `Object.property` dot notation)
- Action names (`##Jump`, `<Jump>`, and grammar `-> Jump` navigate to `JumpSub`)
- Library-defined symbols (properties, attributes, etc.)
- `Include "filename"` directives — jumps to the included file

### Find references

Shift+F12 (or right-click → Find All References) lists every use of a symbol
across all indexed files.

### Rename symbol

F2 renames a symbol everywhere it is referenced. The rename covers all indexed
source files. References inside inactive `#IfDef` branches are not seen by the
compiler and will not be renamed; a notification appears after the rename if
any inactive branches exist in the affected files.

### Hover information

Hover over a symbol to see its type, signature, doc comment, and source
location. Includes:

- Routine signatures with parameter names
- Object parent, attributes, and short name
- Constant values
- Local variable identification (distinguishes locals from globals)
- Print-rule keywords (`(the)`, `(The)`, `(a)`, `(name)`, etc.)
- Language keyword and directive reference

Hover is suppressed inside string literals so prose words don't trigger
false symbol lookups.

### Autocomplete

Context-aware completions triggered as you type:

- **Dot completion**: `ObjectName.` or `self.` shows that object's properties
  and attributes
- **`##`**: action names only
- **`provides` expression**: property names only (including `or` chains)
- **`ofclass` expression**: class names only (including `or` chains)
- **`class` clause** in an object header: class names only
- **`has`/`hasnt` clause**: attribute names only
- **Top of file** (column 0, outside all bodies): directives, class
  pseudo-directives, and declaration snippets
- **`->` in grammar lines**: action names appear first, followed by the full
  symbol list (so `obj->prop` access still works)
- **General**: all in-scope locals, routines, objects, globals, constants,
  arrays, and language keywords
- Completions are suppressed inside comments

### Diagnostics

Compiler errors and warnings appear inline as you edit. The full Inform 6
compiler runs on each save, so diagnostics reflect real compilation results
rather than approximate heuristics.

Opt-in: set `warnUndeclaredProperties: true` in `inform6rc.yaml` to warn when
an object uses a property name that was never formally declared with a
`Property` directive. This catches typos that the compiler silently accepts
(e.g. `prop_aa` instead of `prop_a`). Add `! Pragma:Prop` at the end of a
property line to suppress the warning for that one usage.

### Document and workspace symbols

- **Document symbols** (Ctrl+Shift+O): browse all routines, objects, classes,
  and verbs defined in the current file
- **Workspace symbols** (Ctrl+T): search across all indexed files

### Folding

Routine and object bodies fold in the editor. The **Inform 6: Fold Inactive
Branches** command (also available in the command palette) folds every
inactive `#IfDef`/`#IfNDef`/`#IfV3`/`#IfV5` block and unfolds every active
one, based on the compiler's evaluation of your defines.

### Conditional compilation graying

Inactive `#IfDef` branches are displayed at reduced opacity so you can see at
a glance which code paths are compiled. Toggle with the **Inform 6: Toggle
Inactive Branch Graying** command, or set `inform6.grayInactiveBranches` to
`false` to disable permanently.

### Compile (Ctrl+Shift+B)

The **Inform 6: Compile** command (also the ▶ button in the editor title bar)
compiles your project using `inform6rc.yaml`:

- Shows a quick-pick list of all configured targets, pre-selecting the
  currently open file if it is a listed target
- On errors or warnings: jumps the editor to the first diagnostic, shows a
  coloured toast (red for errors, yellow for warnings-only), and offers a
  **Show Output** button with the full message list
- On success: shows a green toast
- Diagnostics appear in the Problems panel with clickable links to jump to
  each location; use F8 / Shift+F8 to move between them

### Fill and wrap strings (Alt+Q)

With the cursor inside a string literal, **Alt+Q** reflows the string content
to fit within the editor ruler (default 80 columns). Indentation, leading and
trailing spaces, `^` paragraph breaks, and any suffix after the closing quote
(e.g. `,` or `;`) are all preserved.

### Snippets

Type `zz` to see available snippets:

- `zz!!` -- full game skeleton with library includes and starting room
- `zzObject`, `zzClass`, `zzRoutine`, `zzVerb` -- common declarations
- Entry point stubs: `zzChooseObjects`, `zzParseNoun`, `zzParserError`,
  `zzInScope`, `zzGamePreRoutine`, `zzGamePostRoutine`, `zzAfterLife`,
  `zzDarkToDark`, `zzNewRoom`, `zzTimePasses`, and more

Each entry point snippet includes a doc comment explaining its purpose and
return value convention.

## Setup

### Workspace configuration

Create an `inform6rc.yaml` file in your workspace root to tell the language
server how to compile your project:

```yaml
# Global defaults
compiler: ~/bin/inform6
libraryPath: ~/if/inform6lib

# List each main source file as a top-level key.
# Per-file settings override the globals.
game.inf:
game2.inf:
  libraryPath: ~/if/punylib
```

Each top-level key that isn't a global setting (`compiler`, `libraryPath`,
`switches`, `defines`, `externalDefines`) is treated as a main source file
to compile and index.

The language server re-indexes automatically when you save any `.inf` or `.h`
file, or when `inform6rc.yaml` changes.

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `inform6.enableTextMateHighlighting` | `true` | Enable TextMate grammar highlighting (reload required) |
| `inform6.enableLanguageServer` | `true` | Enable the language server |
| `inform6.grayInactiveBranches` | `true` | Gray out inactive conditional compilation branches |
| `inform6.verboseOutput` | `false` | Show verbose indexer/server logs in the output channel (useful when debugging the extension) |

### Per-file options in `inform6rc.yaml`

| Option | Default | Description |
|--------|---------|-------------|
| `warnUndeclaredProperties` | `false` | Warn on properties not formally declared with `Property` |

## Doc comments

The extension recognises `!!` (two bangs + space) as doc comments. Place them
on the line(s) immediately before a definition, or at the end of a definition
line:

```inform6
!! The player's trusty lamp. Starts off.
Object lamp "brass lamp"
  with name 'lamp' 'brass',
    description "A well-worn brass lamp.",
  has ~light;

Constant MAX_SCORE = 100;  !! Highest possible score
```

Doc comments appear in hover popups and help document your project's API.

## Credits

- **Inform 6 compiler** — Graham Nelson and contributors (GPL-2.0)
- **[vscode-inform6](https://gitlab.com/Natrium729/vscode-inform6)** by
  Nathanaël Marion (MIT) — the TextMate grammar descends from his, and the
  compile-and-run story-launcher is adapted from his extension
- **[IF Player](https://marketplace.visualstudio.com/items?itemName=natrium729.if-player)**
  by Nathanaël Marion — the in-editor story player used by Compile and Run

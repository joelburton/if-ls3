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

### Hover information

Hover over a symbol to see its type, signature, doc comment, and source
location. Includes:

- Routine signatures with parameter names
- Object parent, attributes, and short name
- Constant values
- Local variable identification (distinguishes locals from globals)
- Print-rule keywords (`(the)`, `(The)`, `(a)`, `(name)`, etc.)
- Language keyword and directive reference

### Autocomplete

- **Dot completion**: type `ObjectName.` to see that object's properties
  and attributes
- **General completion**: all in-scope locals, routines, objects, globals,
  constants, arrays, and language keywords
- Completions are suppressed inside comments

### Diagnostics

Compiler errors and warnings appear inline as you edit. The full Inform 6
compiler runs on each save, so diagnostics reflect real compilation results
rather than approximate heuristics.

### Document and workspace symbols

- **Document symbols** (Ctrl+Shift+O): browse all routines, objects, classes,
  and verbs defined in the current file
- **Workspace symbols** (Ctrl+T): search across all indexed files

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

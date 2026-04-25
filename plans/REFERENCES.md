# Plan: Add Symbol References to Compiler JSON Index

## Status

**Compiler side: COMPLETE.** The `references[]` array is implemented and
emitted in the JSON. See Implementation Notes below for the actual hook
inventory.

**Language server side: TODO.** Steps 5–6 below are not yet done.

---

## Context

The language server currently guesses what symbol the cursor is on using
heuristics: extracting the word at the cursor position, checking if it might
be an action label, scanning for strings/comments, etc. This leads to bugs
(e.g., `Jump:` in an action switch shows keyword hover instead of action
hover; symbols inside strings get false matches). Adding compiler-tracked
references with exact positions will:

1. Fix these bugs by providing authoritative "this token at line:col is
   symbol X of type Y" data
2. Unlock go-to-references
3. Simplify LS heuristic code (semantic tokens, hover, definition,
   action detection) in follow-up PRs

## Design Decisions

- **No length in loc strings**: Length is always `strlen(sym)`, so omitted.
- **No local variable references**: Locals always shadow everything
  (lexer.c:856 checks locals first), so the LS can determine local refs
  with certainty using `routines[].locals` + line ranges. No compiler
  data needed.
- **Skip system-file references by default**: References inside library
  files are excluded to keep output compact. Can be made configurable later.
- **Grouped by symbol**: Each symbol appears once with all its use-site
  locations, avoiding repetition of name/type.

## JSON Format

Compact encoding grouped by symbol. Loc strings are `file_index:line:col`.
File indices reference the existing `files[]` array (0-based). Lines are
1-based (matching the rest of the JSON). Columns are 0-based.

```json
"references": [
  {
    "sym": "Room",
    "type": "class",
    "locs": ["0:12:0"]
  },
  {
    "sym": "my_attr",
    "type": "attribute",
    "locs": ["0:13:6"]
  },
  {
    "sym": "description",
    "type": "property",
    "locs": ["0:15:4", "0:25:24"]
  },
  {
    "sym": "Foozle",
    "type": "action",
    "locs": ["0:17:6", "0:42:13"]
  },
  {
    "sym": "TheRoom",
    "type": "object",
    "locs": ["0:25:17"]
  },
  {
    "sym": "foo",
    "type": "global_variable",
    "locs": ["0:29:8"]
  },
  {
    "sym": "MY_CONST",
    "type": "constant",
    "locs": ["0:29:13"]
  },
  {
    "sym": "arr",
    "type": "array",
    "locs": ["0:29:23"]
  },
  {
    "sym": "MyFunc",
    "type": "routine",
    "locs": ["0:30:2"]
  }
]
```

Action symbols (`Foo__A` in the symbol table) are emitted with the `__A`
suffix stripped and `"type": "action"`, covering both real actions
(`ACTION_SFLAG`) and fake actions (`FAKE_ACTION_T`).

`grammar_action_refs` is kept for now (backward compat); references
subsumes it and we can remove it later.

Duplicate locs (possible when put-back tokens re-fire a hook) are
deduplicated during JSON output.

## Implementation Notes

### New lexer function — `lexer.c`

`get_last_token_start_location()` returns
`circle[last_returned_circle_pos].location`, where
`last_returned_circle_pos` is set in `get_next_token()` at the `ReturnBack`
label. Using the actual circle index (not just `circle_position`) correctly
handles put-back tokens, which don't advance `circle_position`.

### Reference capture — `index.c`

- `index_note_symbol_ref(int symindex)` — records a use-site for a symbol
  table entry. Skips system-file refs (`is_systemfile()`).
- `index_note_action_sym_ref(const char *name)` — appends `"__A"` to the
  name, looks up the symbol via `get_symbol_index()`, then delegates to
  `index_note_symbol_ref`. Used for contexts where the action name is read
  as `UQ_TT` (not entered into the symbol table).
- Both use `get_last_token_start_location()` for position;
  `col = beginning_character_number - 1` for 0-based column.
- Entries are sorted by `symbol_index` (then file/line/col) at JSON output
  time via `qsort`.

### Hook inventory — all guarded by `if (index_switch)`

| File | Location | What is captured |
|---|---|---|
| `expressp.c` | SYMBOL_TT in `evaluate_term` | All symbol refs in expressions: calls, globals, constants, objects, properties, arrays |
| `expressp.c` | ACTION_TT in `evaluate_term` | `##Action` inline refs |
| `syntax.c` | After `action_of_name()` in `parse_switch_spec` | Action switch labels (`Foozle:`) |
| `states.c` | After `action_of_name()` in action-statement handler | `<Action noun>` statements |
| `verbs.c` | After `index_note_grammar_action_ref()` | Grammar `-> Action` refs |
| `verbs.c` | After `symbols[].flags |= USED_SFLAG` in `noun=` branch | `noun=ParsingRoutine` grammar tokens |
| `verbs.c` | After `symbols[].flags |= USED_SFLAG` in `scope=` branch | `scope=ScopeRoutine` grammar tokens |
| `verbs.c` | After `symbols[].flags |= USED_SFLAG` in general grammar token branch | `<attribute>` and GPR routine grammar tokens |
| `objects.c` | In `has` segment | Attribute refs (both set and `~negated`) |
| `objects.c` | In `properties_segment_z` and `properties_segment_g` | Property name refs in `with`/`private` |
| `objects.c` | In `classes_segment` | Class inheritance refs |
| `objects.c` | In object header parsing (`SpecParent`) | Parent object refs |

## Language Server Changes — COMPLETE

### Step 5: Parse references in LS — DONE

- `langserver/src/server/types.ts` — `SymbolReference` interface and
  `references?: SymbolReference[]` on `CompilerIndex`
- Tolerant of absence (older binary): all consumers check for the field.

### Step 6: Consume references in LS features — DONE

- **`references.ts`**: `refAtPosition()` (cursor hit-test) and
  `findReferences()` (go-to-references); both tolerant of absent field.
- **`server.ts` `onDefinition`**: uses `refAtPosition`; resolves `self` to
  enclosing object; passes `isAction`/`isExplicitAction` from `ref.type`.
- **`server.ts` `onHover`**: uses `refAtPosition` for the primary path;
  falls through to keyword/local/print-rule heuristics for things not in
  `references[]`.
- **`server.ts` `onReferences`**: full go-to-references via `findReferences()`.
- **`semanticTokens.ts`**: when `references[]` is present, tokens are derived
  from exact compiler positions (global_variable → PROP, constant → ENUM,
  property/individual_property/attribute → PROP).  Locals are still collected
  via text scan (not in references).  Falls back to text scanner for older
  binaries.  Properties and attributes are now highlighted — a new capability
  vs the old text-only path.
- **Action detection**: `ref.type === "action"` replaces all `##`/`<>`/`:`
  heuristics and `grammar_action_refs[]` lookups.

## Files Modified

### Compiler (C) — COMPLETE
- `Inform6/header.h` — declared `get_last_token_start_location()`,
  `index_note_symbol_ref()`, `index_note_action_sym_ref()`
- `Inform6/lexer.c` — implemented `get_last_token_start_location()`;
  added `last_returned_circle_pos` tracking
- `Inform6/index.c` — reference struct, capture functions, lifecycle, JSON
- `Inform6/expressp.c` — hooks at SYMBOL_TT and ACTION_TT
- `Inform6/syntax.c` — hook at action switch label
- `Inform6/objects.c` — hooks at has/with(×2)/class/parent
- `Inform6/states.c` — hook at `<action>` statement
- `Inform6/verbs.c` — hooks at `->` action, `noun=`, `scope=`, GPR/attribute tokens

### Language Server (TypeScript) — COMPLETE
- `langserver/src/server/types.ts` — SymbolReference interface, references field
- `langserver/src/features/references.ts` — refAtPosition, findReferences
- `langserver/src/server/server.ts` — onDefinition, onHover, onReferences wired
- `langserver/src/features/semanticTokens.ts` — references path + text-scan fallback

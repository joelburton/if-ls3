# Plan: Track Conditional Compilation Blocks in JSON Index

## Context

Inform6 has six conditional compilation directives:

| Directive | Condition |
|-----------|-----------|
| `#IfDef name`    | symbol is defined |
| `#IfNDef name`   | symbol is not defined |
| `#IfV3`          | target VM is Z-machine v3 or earlier |
| `#IfV5`          | target VM is Z-machine v4+ (or Glulx) |
| `#IfTrue expr`   | constant expression is non-zero |
| `#IfFalse expr`  | constant expression is zero |

All can have an optional `#Ifnot` (else) clause and must end with `#Endif`.
Nesting is supported up to `MAX_IFDEF_STACK` (32) levels.

The LS currently has a `scanIfDefWarnings()` function that rescans raw source
text looking for unknown symbol names in `#IfDef`/`#IfNDef`. That works for
warnings, but it cannot know which branch the compiler actually took — that
requires running the compiler with the same flags and library path.

## What This Enables

- **Grey out inactive branches** — text in the non-taken branch can be shown
  at reduced opacity, just like `#ifdef` in C IDEs. This is only possible with
  compiler-provided `taken` data.
- **Code folding** — LSP `foldingRange` requests can cover each
  `#IfDef...#Endif` block using `start_line`/`end_line`.
- **More accurate `#IfDef` warnings** — `scanIfDefWarnings()` in the LS can be
  simplified or eliminated once the compiler reports each condition's result.

## JSON Format

```json
"conditionals": [
  {
    "directive": "ifdef",
    "file": "/abs/path/foo.inf",
    "start_line": 10, "start_col": 0,
    "else_line": 15,  "else_col": 0,
    "end_line": 20,   "end_col": 0,
    "taken": true
  },
  {
    "directive": "ifv5",
    "file": "/abs/path/foo.inf",
    "start_line": 25, "start_col": 0,
    "end_line": 28,   "end_col": 0,
    "taken": false
  }
]
```

Fields:
- `directive` — one of `"ifdef"`, `"ifndef"`, `"ifv3"`, `"ifv5"`,
  `"iftrue"`, `"iffalse"`.
- `start_line`/`start_col` — position of the `#IfDef` (etc.) keyword token.
- `else_line`/`else_col` — position of the `#Ifnot` token, if present.
- `end_line`/`end_col` — position of the `#Endif` token.
- `taken` — `true` if the FIRST branch was compiled; `false` if the else
  branch (or no branch) was compiled.

All columns are 0-based, matching the convention in `references[]`.
All `file` values are absolute paths (resolved via `realpath()`).
System-file conditionals are included (unlike symbol refs, these are useful
for folding even in library code).

`else_line`/`else_col` are omitted when there is no `#Ifnot` clause.

## Implementation

### Compiler state in `directs.c`

The existing `ifdef_stack[MAX_IFDEF_STACK]` / `ifdef_sp` tracks whether the
top-level condition was TRUE or FALSE. The skip loops (two of them — one in
`IFNOT_CODE` and one in `HashIfCondition`) scan tokens with
`dont_enter_into_symbol_table = -2` until `n` reaches 0.

There are four execution paths to cover:

| Condition | Ifnot? | What happens |
|-----------|--------|--------------|
| TRUE  | no  | Compile first branch; ENDIF_CODE handler pops stack |
| TRUE  | yes | Compile first branch; IFNOT_CODE handler skip-loops to ENDIF |
| FALSE | no  | Skip-loop to ENDIF (n→0 terminates loop) |
| FALSE | yes | Skip-loop to IFNOT (n==1 pushes FALSE and exits); compile else branch; ENDIF_CODE handler pops stack |

### New functions in `index.c`

```c
/* Called when a conditional directive is entered.
   directive: IFDEF_CODE, IFNDEF_CODE, IFV3_CODE, IFV5_CODE,
              IFTRUE_CODE, IFFALSE_CODE (constants from directs.c).
   taken: TRUE if the first branch will be compiled.
   loc: location of the directive keyword (from get_last_token_start_location()). */
extern void index_begin_conditional(int directive, int taken,
    debug_location loc);

/* Called when #Ifnot is encountered for the current top-level conditional. */
extern void index_note_conditional_else(debug_location loc);

/* Called when #Endif is encountered (or when the skip loop terminates at
   the closing #Endif). */
extern void index_end_conditional(debug_location loc);
```

`index.c` maintains a small internal stack (depth = `MAX_IFDEF_STACK`) to
match begin/else/end calls, then appends completed entries to a flat
`conditionals[]` array for JSON output.

### Hook points in `directs.c`

**Entry** — at the top of each case branch, before the condition is evaluated,
capture the keyword's start location and the directive type. After `flag` is
determined (post-`HashIfCondition`), call `index_begin_conditional()`.
Location is available from `get_last_token_start_location()` after reading
the directive token.

Because all six directives funnel into `HashIfCondition` via `goto`, the call
to `index_begin_conditional()` fits naturally at the bottom of
`HashIfCondition`, just before `if (flag) { ... } else { ... }`.

**`#Ifnot` in normal parsing** (`case IFNOT_CODE`, ~line 424): when
`ifdef_stack[ifdef_sp-1]` is TRUE (first branch was taken, now entering else),
call `index_note_conditional_else()` before entering the skip loop.

**`#Ifnot` inside the FALSE skip loop** (~line 537): when `n == 1` and
`IFNOT_CODE` is found, call `index_note_conditional_else()` before pushing
FALSE and breaking. This is the case where the first branch was NOT taken.

**`#Endif` in normal parsing** (`case ENDIF_CODE`, ~line 352): call
`index_end_conditional()` before `ifdef_sp--`.

**`#Endif` inside the IFNOT skip loop** (`case IFNOT_CODE` handler,
~line 445): when `n--` makes `n == 0` and we exit the inner loop, call
`index_end_conditional()` using the location of that `ENDIF` token.

**`#Endif` inside the FALSE skip loop** (`HashIfCondition` else branch,
~line 528): when `n--` makes `n == 0`, same — call `index_end_conditional()`.

### Column accuracy note

The directive keyword token is always freshly read (never put-back) at all six
entry points, so `get_last_token_start_location()` returns the correct column.
Inside the skip loops, tokens are read with `dont_enter_into_symbol_table = -2`
but the lexer still tracks locations normally, so
`get_last_token_start_location()` is accurate there too.

### Lifecycle wiring

Wire `conditionals` array and internal tracking stack into all four lifecycle
hooks: `init_index_vars`, `index_begin_pass`, `index_allocate_arrays`,
`index_free_arrays`.

### JSON output

Emit `"conditionals"` after `"references"` (adjust trailing comma on
`"references"`). Walk the flat `conditionals[]` array in order. Since entries
are appended in source order (the compiler processes files sequentially), no
sort is needed.

## Files Modified

- `Inform6/index.c` — struct, array, three new functions, lifecycle, JSON output
- `Inform6/directs.c` — six hook calls (entry × 1, ifnot × 2, endif × 3)
- `Inform6/header.h` — declare three new `index_` functions

## Verification

```bash
cd Inform6

# Tiny corpus (no library, simple #IfDef)
./inform6 -y ../test/corpus/tiny.inf 2>/dev/null | python3 -m json.tool | grep -A5 conditionals

# Library game — will have many #IfDef blocks from library
./inform6 -y +~/if/inform6lib/ ~/if/inform6-langserver/test/corpus/library_of_horror.inf \
    2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin)
cs=d['conditionals']
print(len(cs),'conditionals')
print(sum(1 for c in cs if not c['taken']),'not taken')
print(sum(1 for c in cs if 'else_line' in c),'with else clause')
"
```

Check that:
1. `taken` correctly reflects which branch the compiler entered.
2. `else_line` appears iff there is an `#Ifnot` clause.
3. Nested `#IfDef` blocks each produce their own entry (no merging).
4. Columns match the `#` character of each directive.
5. `start_line`/`end_line` span the full block including the directive lines
   themselves.
6. System-file conditionals appear (unlike symbol refs).

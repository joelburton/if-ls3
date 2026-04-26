# Plan: Track Include Directives in JSON Index

> **Status — 2026-04-25: Implemented.** `includes[]` is emitted by the
> compiler with `from_file`, `from_line`/`col`, `given`, `resolved`, and
> `file_index`. The LS uses it for go-to-definition on `Include` strings.

## Context

The Inform 6 `Include` directive resolves filenames through a multi-step
search path (the `+libpath` arguments, the directory of the including file if
`>` prefix is used, etc.), implemented in `translate_in_filename()` in
`files.c`. The LS has no way to replicate this search reliably — it would need
to know all the `+path` arguments the compiler was invoked with, replicate the
path-resolution algorithm, and handle the `"language__"` special case.

At the point `load_sourcefile()` is called in `directs.c`, the compiler has
already resolved and opened the file. The resolved absolute path is stored in
`InputFiles[total_input_files - 1].filename` immediately after the call
returns. Emitting this in the JSON makes hover/go-to on `Include` strings
trivial for the LS.

## JSON Format

```json
"includes": [
  {
    "from_file": "/abs/path/main.inf",
    "from_line": 3,  "from_col": 8,
    "given": "parser",
    "resolved": "/abs/path/lib/parser.h",
    "file_index": 1
  },
  {
    "from_file": "/abs/path/main.inf",
    "from_line": 4,  "from_col": 8,
    "given": ">local_defs",
    "resolved": "/abs/path/local_defs.h",
    "file_index": 2
  },
  {
    "from_file": "/abs/path/lib/parser.h",
    "from_line": 12, "from_col": 8,
    "given": "language__",
    "resolved": "/abs/path/lib/english.h",
    "file_index": 3
  }
]
```

Fields:
- `from_file` — absolute path of the file containing the `Include` directive.
- `from_line` / `from_col` — position of the string-literal token (the `"`
  character), 1-based line and 0-based column, matching the convention of
  other definition-site fields.
- `given` — the raw string argument inside the quotes, exactly as written in
  source. Preserves the `>` prefix if present and the `language__` special
  name.
- `resolved` — the absolute path that was actually opened, as stored in
  `InputFiles[].filename` after `load_sourcefile()` returns (passed through
  `realpath()` like all other file fields in the JSON).
- `file_index` — 0-based index into the top-level `files[]` array for the
  included file. Redundant with `resolved` but convenient for the LS to cross-
  reference without a path comparison.

Entries appear in source order (include directives are processed sequentially
during compilation). Does not include the main source file (that is loaded by
`inform.c`, not by an `Include` directive).

## Implementation

### Hook point — `directs.c`, `case INCLUDE_CODE` (~line 565)

The current code reads the filename string token and calls `load_sourcefile()`.
The hook fits naturally around that call:

```c
case INCLUDE_CODE:
    get_next_token();
    if (token_type != DQ_TT)
        return ebf_error_recover("filename in double-quotes");

    {   char *name = token_text;
        debug_location str_loc;

        /* Capture string-token location before reading the semicolon */
        if (index_switch)
            str_loc = get_last_token_start_location();

        get_next_token();
        if (!((token_type == SEP_TT) && (token_value == SEMICOLON_SEP)))
            ebf_curtoken_error("semicolon ';' after Include filename");

        if (strcmp(name, "language__") == 0)
             load_sourcefile(Language_Name, 0);
        else if (name[0] == '>')
             load_sourcefile(name+1, 1);
        else load_sourcefile(name, 0);

        /* After load_sourcefile(), the new file is
           InputFiles[total_input_files - 1]. */
        if (index_switch)
            index_note_include(name, str_loc);

        return FALSE;
    }
```

`index_note_include(char *given, debug_location str_loc)` in `index.c`:
- Records `given` (strdup).
- Gets `from_file` from `InputFiles[str_loc.file_index - 1].filename`.
- Gets `resolved` from `InputFiles[total_input_files - 1].filename`
  (the file just opened — pass through `realpath()` like other paths).
- Gets `file_index` = `total_input_files - 1` (0-based, matching `files[]`).
- Stores `from_line = str_loc.beginning_line_number`,
  `from_col = str_loc.beginning_character_number - 1` (0-based).

### New struct and array in `index.c`

```c
typedef struct index_include_s {
    char *from_file;      /* absolute path of including file */
    int32 from_line;
    int32 from_col;
    char *given;          /* raw argument string */
    char *resolved;       /* absolute path of included file */
    int   file_index;     /* 0-based index into files[] */
} index_include;

static index_include *includes_info;
static int includes_count;
static memory_list includes_memlist;
```

Wire into all four lifecycle hooks.

### JSON output

Emit `"includes"` after `"grammar_action_refs"` and before `"references"` (or
at the end — exact ordering TBD). Walk `includes_info[]` in order; no sort
needed.

```c
printf("  \"includes\": [\n");
first = TRUE;
for (i = 0; i < includes_count; i++) {
    index_include *inc = &includes_info[i];
    if (!first) printf(",\n");
    first = FALSE;
    printf("    {\"from_file\": ");
    json_print_abs_path(inc->from_file);
    printf(", \"from_line\": %d, \"from_col\": %d",
        (int)inc->from_line, (int)inc->from_col);
    printf(", \"given\": ");
    json_print_escaped_string(inc->given);
    printf(", \"resolved\": ");
    json_print_abs_path(inc->resolved);
    printf(", \"file_index\": %d}", inc->file_index);
}
printf("\n  ],\n");
```

## LS Usage

On hover or go-to-definition over a string literal on an `Include` line, the
LS:

1. Checks `includes[]` for an entry whose `from_file` matches the current file
   and whose `from_line` matches the cursor line.
2. Returns hover text showing `resolved` (the full path), or a definition
   location pointing to line 1, col 0 of `resolved`.

No path-search replication needed in the LS at all.

## Files Modified

- `Inform6/index.c` — struct, array, `index_note_include()`, lifecycle, JSON
- `Inform6/directs.c` — one hook call in `INCLUDE_CODE` handler
- `Inform6/header.h` — declare `index_note_include()`

## Verification

```bash
cd Inform6

# Library game with many includes
./inform6 -y +/Users/joel/if/puny/lib \
    ~/if/inform6-langserver/test/corpus/library_of_horror.inf \
    2>/dev/null | python3 -c "
import sys, json
d = json.load(sys.stdin)
for inc in d['includes']:
    print(inc['from_line'], repr(inc['given']), '->', inc['resolved'])
"
```

Check that:
1. Every `Include` in the source appears, in order.
2. `given` matches the literal string in source (including `>` prefix if present).
3. `resolved` is an absolute path that actually exists (`os.path.exists`).
4. `file_index` matches the index of `resolved` in `files[]`.
5. `from_line`/`from_col` points to the `"` character of the string literal.
6. `language__` resolves correctly to the actual language file.

# Upstream Compiler

This is a fork of the Inform 6.45 compiler by Graham Nelson.

- Upstream repo: https://github.com/DavidKinder/Inform6
- Fork base commit: `40faabc` ("Mention https://github.com/DavidKinder/Inform6/pull/365 in release notes")

## What we changed

All changes support the `-y` JSON symbol index and `-q2` silent mode for
language server use. The compiled game file output is byte-for-byte identical
to the upstream compiler.

Modified files:
- `header.h` — new externs for index hooks
- `index.c` — **new file**: JSON symbol index output
- `lexer.c` — doc comment capture (`!! ` convention)
- `symbols.c` — hook in `assign_symbol_base()` for doc attachment
- `objects.c` — hooks for object/property/attribute tracking
- `errors.c` — hook to capture errors/warnings for JSON output, stderr output
- `inform.c` — `-y`/`-q2` flag handling, lifecycle wiring for `index.c`
- `syntax.c` — hook in `parse_routine()` for local variable capture
- `verbs.c` — helper functions to expose verb/grammar data
- `text.c` — helper functions to expose dictionary data

## Updating to a new upstream version

1. Diff against the fork base: `git diff 40faabc..HEAD -- Inform6/`
2. Apply the diff to the new upstream source
3. Resolve any conflicts (most likely in `header.h` if new externs were added)
4. Verify: compile a test game with both vanilla and modified compilers,
   confirm byte-for-byte identical output

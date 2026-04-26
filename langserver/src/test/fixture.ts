/** Minimal CompilerIndex fixture for unit tests. */

import type { CompilerIndex } from "../server/types";

/** Fake absolute path used throughout the fixture — avoids real FS paths. */
export const FILE = "/project/game.inf";

export const testIndex: CompilerIndex = {
  version: 1,
  files: [FILE],

  routines: [
    // Top-level callable routine with locals.
    { name: "MyFunc", file: FILE, start_line: 58, end_line: 66, locals: ["a", "b", "x"] },
    // Action routine for the Foozle action.
    { name: "FoozleSub", file: FILE, start_line: 89, end_line: 89, locals: [] },
    // Embedded routine (not callable by bare name — should be excluded from completions).
    // The compiler emits this form ("Object.prop") for property routines on objects;
    // class-defined routines use "Class::prop".  Both forms are recognized by
    // documentSymbols nesting.
    { name: "TheRoom.before", file: FILE, start_line: 16, end_line: 19, locals: [], embedded: true },
  ],

  objects: [
    {
      name: "TheRoom",
      shortname: "The Room",
      file: FILE,
      start_line: 10,
      end_line: 20,
      is_class: false,
      parent: undefined,
      attributes: [{ name: "light", line: 11 }],
      properties: [
        { name: "description", line: 14 },
        { name: "before", line: 15 },
        { name: "my_test", line: 22 }, // also in symbols[] at line 4 — tests objectContext discrimination
      ],
      private_properties: [{ name: "super_secret", line: 13 }],
      doc: "This is the doc comment for TheRoom",
    },
    {
      name: "Room",
      file: FILE,
      start_line: 24,
      end_line: 24,
      is_class: true,
      attributes: [],
      properties: [],
      private_properties: [],
    },
  ],

  globals: [
    { name: "c", file: FILE, line: 40, doc: "Doc comment for c" },
    { name: "location", file: FILE, line: 2 },
  ],

  constants: [
    { name: "NOPE", file: FILE, line: 29 },
    { name: "Foozle", file: FILE, line: 95 },
  ],

  arrays: [{ name: "WordArray", file: FILE, line: 98, array_type: "-->", size: 10 }],

  symbols: [
    // System symbols (should be excluded from definition fallback).
    { name: "TARGET_ZCODE", type: "constant", value: 0, flags: 516, is_system: true },
    { name: "nothing", type: "object", value: 0, flags: 516, is_system: true },
    // User constant — value used by hover to show `NOPE = 0`.
    { name: "NOPE", type: "constant", value: 0, flags: 1284, is_system: false, file: FILE, line: 29 },
    { name: "Foozle", type: "constant", value: 10, flags: 1284, is_system: false, file: FILE, line: 95 },
    // Library property only in symbols[] (not in objects/routines/etc.).
    { name: "description", type: "property", value: 3, flags: 1284, is_system: false, file: FILE, line: 14 },
    // Individual property: in TheRoom.properties at line 22, but declared at line 4.
    // Used to verify objectContext path returns 22, not 4.
    { name: "my_test", type: "individual_property", value: 72, flags: 4, is_system: false, file: FILE, line: 4 },
    // Attributes — system and user-defined.
    { name: "light", type: "attribute", value: 2, flags: 516, is_system: true },
    { name: "container", type: "attribute", value: 3, flags: 516, is_system: true },
    { name: "concealed", type: "attribute", value: 8, flags: 4, is_system: false, file: FILE, line: 5 },
    // Action symbols (stored with __A suffix).
    { name: "Take__A", type: "fake_action", value: 1, flags: 4, is_system: false, file: FILE, line: 90 },
    { name: "Foozle__A", type: "fake_action", value: 2, flags: 4, is_system: false, file: FILE, line: 95 },
    // Class symbol for ofclass completions (Room already in objects[] as is_class:true).
    { name: "Room", type: "class", value: 5, flags: 4, is_system: false, file: FILE, line: 24 },
  ],

  verbs: [],
  dictionary: [],
  errors: [],
};

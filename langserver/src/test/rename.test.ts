import { describe, it, expect } from "vitest";
import { prepareRename, computeRename } from "../features/rename";
import type { CompilerIndex } from "../server/types";
import { FILE, testIndex } from "./fixture";
import { URI } from "vscode-uri";

const FILE_URI = URI.file(FILE).toString();
const OTHER_URI = URI.file("/project/other.inf").toString();

// ---------------------------------------------------------------------------
// Fixture extensions for rename tests
// ---------------------------------------------------------------------------

const OTHER = "/project/other.inf";

/** Source text fragments keyed by file path, returned by the getFileText stub. */
const SOURCE: Record<string, string> = {
  [FILE]: [
    "! game.inf", // line 1
    "Global location;", // line 2
    "", // line 3
    "[ MyFunc a b x;", // line 4  (routine def, col 2)
    "  location = location + 1;", // line 5
    "];", // line 6
    "", // line 7
    "Object TheRoom", // line 8  (object def, col 7)
    "  with description [ ];", // line 9
    ";", // line 10
    "", // line 11
    "[ FoozleSub;", // line 12 (routine def, col 2)
    "];", // line 13
    "", // line 14
    "Verb 'foozle' * -> Foozle;", // line 15 (action ref, col 20)
  ].join("\n"),
  [OTHER]: [
    "[ Helper;", // line 1
    "  MyFunc();", // line 2  (use of MyFunc, col 2)
    "];", // line 3
  ].join("\n"),
};

const getFileText = (path: string): string | null => SOURCE[path] ?? null;

/** A CompilerIndex wired up for rename tests. */
const renameIndex: CompilerIndex = {
  ...testIndex,
  files: [FILE, OTHER],
  globals: [],

  routines: [
    { name: "MyFunc", file: FILE, start_line: 4, end_line: 6, locals: ["a", "b", "x"] },
    { name: "FoozleSub", file: FILE, start_line: 12, end_line: 13, locals: [] },
  ],

  objects: [
    {
      name: "TheRoom",
      file: FILE,
      start_line: 8,
      end_line: 10,
      is_class: false,
      attributes: [],
      properties: [],
      private_properties: [],
    },
  ],

  symbols: [
    // system symbol — rename should be rejected
    { name: "nothing", type: "object", value: 0, flags: 516, is_system: true },
    // action symbol stored as Foozle__A
    { name: "Foozle__A", type: "fake_action", value: 1, flags: 4, is_system: false, file: FILE, line: 15 },
    // User symbols
    { name: "MyFunc", type: "routine", value: 0, flags: 4, is_system: false, file: FILE, line: 4 },
    { name: "FoozleSub", type: "routine", value: 0, flags: 4, is_system: false, file: FILE, line: 12 },
    { name: "TheRoom", type: "object", value: 1, flags: 4, is_system: false, file: FILE, line: 8 },
  ],

  references: [
    // MyFunc: defined in FILE line 4, used in OTHER line 2 col 2
    { sym: "MyFunc", type: "routine", locs: ["0:4:2", "1:2:2"] },
    // FoozleSub: defined in FILE line 12, used in FILE line 15 (hypothetical)
    { sym: "FoozleSub", type: "routine", locs: ["0:12:2"] },
    // Foozle: action references in FILE line 15 col 20
    { sym: "Foozle", type: "action", locs: ["0:15:20"] },
    // TheRoom: object ref
    { sym: "TheRoom", type: "object", locs: ["0:8:7"] },
  ],
};

// Convenience: position on a word in SOURCE[FILE]
function pos(line: number, col: number) {
  return { line: line - 1, character: col };
}

// ---------------------------------------------------------------------------
// prepareRename
// ---------------------------------------------------------------------------

describe("prepareRename", () => {
  it("returns range and placeholder for a routine", () => {
    // cursor on "MyFunc" at line 4, col 2
    const result = prepareRename(renameIndex, FILE, pos(4, 3), SOURCE[FILE]);
    expect(result).not.toBeNull();
    expect(result!.placeholder).toBe("MyFunc");
    expect(result!.range.start).toEqual({ line: 3, character: 2 });
    expect(result!.range.end).toEqual({ line: 3, character: 8 });
  });

  it("returns range and placeholder for an object", () => {
    const result = prepareRename(renameIndex, FILE, pos(8, 8), SOURCE[FILE]);
    expect(result).not.toBeNull();
    expect(result!.placeholder).toBe("TheRoom");
  });

  it("returns null when cursor is on whitespace", () => {
    const result = prepareRename(renameIndex, FILE, pos(3, 0), SOURCE[FILE]);
    expect(result).toBeNull();
  });

  it("returns null when cursor is in a comment", () => {
    const result = prepareRename(renameIndex, FILE, pos(1, 5), SOURCE[FILE]);
    expect(result).toBeNull();
  });

  it("returns null for a system symbol", () => {
    // "nothing" would need to be in source and referenced; simulate via a
    // position on an unknown word that resolves to a system symbol via symbols[].
    // Instead, test the guard directly: inject a ref at a known position.
    const indexWithSysRef: CompilerIndex = {
      ...renameIndex,
      references: [...renameIndex.references!, { sym: "nothing", type: "object", locs: ["0:1:0"] }],
    };
    // Position on "!" at col 0 line 1 isn't an ident — use a source with "nothing"
    const src = "nothing";
    const result = prepareRename(indexWithSysRef, FILE, { line: 0, character: 3 }, src);
    expect(result).toBeNull();
  });

  it("returns null for an unknown word not in the index", () => {
    const result = prepareRename(renameIndex, FILE, pos(2, 7), SOURCE[FILE]);
    // "location" is a global in testIndex but not in renameIndex — should be null
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeRename — basic cases
// ---------------------------------------------------------------------------

describe("computeRename", () => {
  it("renames a routine at use-site and definition", () => {
    // cursor on MyFunc in definition (line 4, col 3)
    const edit = computeRename(renameIndex, FILE, pos(4, 3), "NewFunc", getFileText);
    expect(edit).not.toBeNull();
    const fileEdits = edit!.changes![FILE_URI] ?? [];
    const otherEdits = edit!.changes![OTHER_URI] ?? [];

    // definition in FILE line 4 col 2
    expect(
      fileEdits.some((e) => e.range.start.line === 3 && e.range.start.character === 2 && e.newText === "NewFunc"),
    ).toBe(true);
    // use in OTHER line 2 col 2
    expect(
      otherEdits.some((e) => e.range.start.line === 1 && e.range.start.character === 2 && e.newText === "NewFunc"),
    ).toBe(true);
  });

  it("produces edits across multiple files", () => {
    const edit = computeRename(renameIndex, FILE, pos(4, 3), "X", getFileText);
    expect(Object.keys(edit!.changes!)).toContain(FILE_URI);
    expect(Object.keys(edit!.changes!)).toContain(OTHER_URI);
  });

  it("edit ranges have correct width (name length)", () => {
    const edit = computeRename(renameIndex, FILE, pos(4, 3), "X", getFileText);
    const fileEdits = edit!.changes![FILE_URI]!;
    const defEdit = fileEdits.find((e) => e.range.start.line === 3);
    expect(defEdit).toBeDefined();
    // "MyFunc" is 6 chars wide
    expect(defEdit!.range.end.character - defEdit!.range.start.character).toBe(6);
  });

  it("renames an object", () => {
    const edit = computeRename(renameIndex, FILE, pos(8, 8), "BigRoom", getFileText);
    expect(edit).not.toBeNull();
    const edits = edit!.changes![FILE_URI]!;
    expect(edits.some((e) => e.newText === "BigRoom")).toBe(true);
  });

  it("returns null for an unknown word", () => {
    const src = "xyz";
    const edit = computeRename(renameIndex, FILE, { line: 0, character: 1 }, "NewName", () => src);
    expect(edit).toBeNull();
  });

  it("returns null for a system symbol", () => {
    const indexWithSysRef: CompilerIndex = {
      ...renameIndex,
      references: [...renameIndex.references!, { sym: "nothing", type: "object", locs: ["0:1:0"] }],
    };
    const src = "nothing";
    const edit = computeRename(indexWithSysRef, FILE, { line: 0, character: 3 }, "X", () => src);
    expect(edit).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeRename — action / Sub tandem
// ---------------------------------------------------------------------------

describe("computeRename action/Sub tandem", () => {
  it("renaming action also renames companion Sub routine", () => {
    // cursor on Foozle action ref at line 15, col 20
    const edit = computeRename(renameIndex, FILE, pos(15, 21), "Grab", getFileText);
    expect(edit).not.toBeNull();
    const changes = edit!.changes!;
    // Action "Foozle" ref at line 15 col 20 → "Grab"
    const actionEdits = Object.values(changes)
      .flat()
      .filter((e) => e.newText === "Grab");
    expect(actionEdits.length).toBeGreaterThan(0);
    // Companion FoozleSub → GrabSub
    const subEdits = Object.values(changes)
      .flat()
      .filter((e) => e.newText === "GrabSub");
    expect(subEdits.length).toBeGreaterThan(0);
  });

  it("renaming Sub routine also renames companion action", () => {
    // cursor on FoozleSub definition at line 12, col 2
    const edit = computeRename(renameIndex, FILE, pos(12, 3), "GrabSub", getFileText);
    expect(edit).not.toBeNull();
    const changes = edit!.changes!;
    // FoozleSub → GrabSub
    const subEdits = Object.values(changes)
      .flat()
      .filter((e) => e.newText === "GrabSub");
    expect(subEdits.length).toBeGreaterThan(0);
    // Action Foozle → Grab
    const actionEdits = Object.values(changes)
      .flat()
      .filter((e) => e.newText === "Grab");
    expect(actionEdits.length).toBeGreaterThan(0);
  });

  it("renaming Sub to a name without 'Sub' suffix skips companion action", () => {
    const edit = computeRename(renameIndex, FILE, pos(12, 3), "Handler", getFileText);
    expect(edit).not.toBeNull();
    const changes = edit!.changes!;
    // FoozleSub → Handler
    const subEdits = Object.values(changes)
      .flat()
      .filter((e) => e.newText === "Handler");
    expect(subEdits.length).toBeGreaterThan(0);
    // Action Foozle should NOT be renamed
    const actionEdits = Object.values(changes)
      .flat()
      .filter((e) => e.newText === "Foozle" || e.newText === "Fooz");
    expect(actionEdits.length).toBe(0);
  });

  it("non-action routine ending in Sub without a matching action is not treated as Sub", () => {
    // "FoozleSub" only pairs with the action because references[] has a Foozle action entry.
    // A routine named "XSub" with no matching action in references[] gets no companion.
    const indexNoAction: CompilerIndex = {
      ...renameIndex,
      references: renameIndex.references!.filter((r) => r.type !== "action"),
    };
    const edit = computeRename(indexNoAction, FILE, pos(12, 3), "YSub", getFileText);
    if (edit) {
      const allNewTexts = Object.values(edit.changes!)
        .flat()
        .map((e) => e.newText);
      expect(allNewTexts).not.toContain("Y"); // no companion action rename
    }
  });
});

// ---------------------------------------------------------------------------
// computeRename — class rename (pseudo-directive class name)
// ---------------------------------------------------------------------------

describe("computeRename class rename", () => {
  const CLASS_SRC = [
    "Class Room;", // line 1 — "Room" at col 6
    "Room Closet;", // line 2 — "Room" as pseudo-directive at col 0
    "Room Kitchen;", // line 3 — "Room" as pseudo-directive at col 0
  ].join("\n");

  const classIndex: CompilerIndex = {
    ...testIndex,
    files: [FILE],
    globals: [],
    routines: [],
    objects: [
      {
        name: "Room",
        file: FILE,
        start_line: 1,
        end_line: 1,
        is_class: true,
        attributes: [],
        properties: [],
        private_properties: [],
      },
      {
        name: "Closet",
        file: FILE,
        start_line: 2,
        end_line: 2,
        is_class: false,
        attributes: [],
        properties: [],
        private_properties: [],
      },
      {
        name: "Kitchen",
        file: FILE,
        start_line: 3,
        end_line: 3,
        is_class: false,
        attributes: [],
        properties: [],
        private_properties: [],
      },
    ],
    symbols: [{ name: "Room", type: "class", value: 5, flags: 4, is_system: false, file: FILE, line: 1 }],
    // references[] has only pseudo-directive uses; definition is found via resolveSymbol
    references: [{ sym: "Room", type: "class", locs: ["0:2:0", "0:3:0"] }],
  };

  const getClassText = (_path: string) => CLASS_SRC;

  it("prepareRename accepts cursor on the pseudo-directive class name", () => {
    // cursor inside "Room" at line 2 col 1 (0-based)
    const result = prepareRename(classIndex, FILE, { line: 1, character: 1 }, CLASS_SRC);
    expect(result).not.toBeNull();
    expect(result!.placeholder).toBe("Room");
    expect(result!.range.start).toEqual({ line: 1, character: 0 });
    expect(result!.range.end).toEqual({ line: 1, character: 4 });
  });

  it("renaming a class from its definition renames the definition and all pseudo-directive uses", () => {
    // cursor inside "Room" in "Class Room;" — line 0 (0-based), col 7
    const edit = computeRename(classIndex, FILE, { line: 0, character: 7 }, "Hall", getClassText);
    expect(edit).not.toBeNull();
    const edits = edit!.changes![FILE_URI]!;

    // definition "Class Room;" line 1 col 6
    expect(edits.some((e) => e.range.start.line === 0 && e.range.start.character === 6 && e.newText === "Hall")).toBe(
      true,
    );
    // pseudo-directive uses on lines 2 and 3 col 0
    expect(edits.some((e) => e.range.start.line === 1 && e.range.start.character === 0 && e.newText === "Hall")).toBe(
      true,
    );
    expect(edits.some((e) => e.range.start.line === 2 && e.range.start.character === 0 && e.newText === "Hall")).toBe(
      true,
    );
  });

  it("renaming from a pseudo-directive use renames the definition and all uses", () => {
    // cursor on "Room" in "Room Closet;" — line 1 (0-based), col 1
    const edit = computeRename(classIndex, FILE, { line: 1, character: 1 }, "Hall", getClassText);
    expect(edit).not.toBeNull();
    const edits = edit!.changes![FILE_URI]!;
    expect(edits).toHaveLength(3); // definition + two pseudo-directive uses
    expect(edits.every((e) => e.newText === "Hall")).toBe(true);
  });

  it("edit range at pseudo-directive has correct width", () => {
    const edit = computeRename(classIndex, FILE, { line: 1, character: 1 }, "Hall", getClassText);
    const edits = edit!.changes![FILE_URI]!;
    const useEdit = edits.find((e) => e.range.start.line === 1);
    expect(useEdit).toBeDefined();
    // "Room" is 4 chars wide
    expect(useEdit!.range.end.character - useEdit!.range.start.character).toBe(4);
  });
});

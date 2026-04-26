/**
 * Static keyword/directive hover help and completions for Inform6.
 *
 * Hand-written from the Inform 6 Designer's Manual (DM4) and the Inform 6.4x
 * release notes.  To add or update an entry, edit the relevant constant below.
 * To add an entirely new keyword category, add entries to KEYWORD_HELP and/or
 * KEYWORD_COMPLETIONS following the existing patterns.
 *
 * Keys are lowercase. Lookup is case-sensitive:
 * - Statement keywords (if, else, for, …) match only all-lowercase spellings.
 * - Directives (Verb, Array, #Ifdef, …) match only lead-cap spellings (first
 *   character uppercase).  This prevents directive names from triggering hover
 *   when they appear as words inside string literals (e.g. "verb").
 * Directive entries are keyable without the leading `#` because wordAtPosition
 * extracts only `\w` characters (e.g. hovering `#Ifdef` yields "Ifdef").
 */
export const KEYWORD_HELP: Record<string, string> = {
  // ── Control flow ────────────────────────────────────────────────────────
  if: "**if** (*expr*) *statement*\n\nConditional: execute *statement* if *expr* is non-zero.",
  else: "**else** *statement*\n\nOptional second branch of an `if` statement.",
  for: "**for** (*init* : *cond* : *step*) *statement*\n\nC-style loop. Any part may be omitted.",
  while: "**while** (*expr*) *statement*\n\nLoop while *expr* is non-zero.",
  do: "**do** *statement* **until** (*expr*)\n\nExecute *statement*, then repeat while *expr* is zero.",
  until: "**until** (*expr*) — tail condition of a `do … until` loop.",
  switch:
    "**switch** (*expr*) \\{ … \\}\n\nMulti-way branch. Cases may be integer literals, strings, or `##Action` names.",
  break: "**break**\n\nExit the nearest enclosing `for`, `while`, `do`, or `switch`.",
  continue: "**continue**\n\nSkip to the next iteration of the nearest enclosing loop.",
  return:
    "**return** *expr*\n\nReturn *expr* from the current routine. `return true` and `return false` are idiomatic.",
  rtrue: "**rtrue** — shorthand for `return true;`",
  rfalse: "**rfalse** — shorthand for `return false;`",
  jump: "**jump** *label*\n\nUnconditional jump to *label* within the current routine.",
  quit: "**quit** — halt the game immediately.",
  restart: "**restart** — restart the game from the beginning.",
  restore: "**restore** — prompt the player to restore a saved game.",
  save: "**save** — prompt the player to save the game.",

  // ── Object/attribute tests ───────────────────────────────────────────────
  move: "**move** *obj* **to** *dest*\n\nMove object *obj* to become a child of *dest*.",
  remove: "**remove** *obj*\n\nDetach *obj* from its parent (makes it parentless).",
  give: "**give** *obj* *attr* (or `give *obj* ~*attr*`)\n\nSet (or clear) attribute *attr* on *obj*.",
  has: "**has** — test attribute: `*obj* has *attr*`",
  hasnt: "**hasnt** — test attribute negated: `*obj* hasnt *attr*`",
  in: "**in** — test containment: `*obj* in *parent*`",
  notin: "**notin** — test containment negated: `*obj* notin *parent*`",
  ofclass: "**ofclass** — test class membership: `*obj* ofclass *Class*`",

  // ── Object tree traversal ─────────────────────────────────────────────────
  objectloop:
    "**objectloop** (*var*)\n\nIterate over every object in the game, assigning each to *var*.\n\n`objectloop (var in obj)` — iterate over direct children of *obj*.\n`objectloop (var ofclass C)` — iterate over instances of class *C*.",

  // ── Print / I/O ───────────────────────────────────────────────────────────
  print:
    '**print** *item*, …\n\nPrint one or more items. Items may be:\n- A string literal: `"text"`\n- An expression: `(expr)`\n- A print rule: `(name) obj`, `(The) obj`, `(a) obj`, `(number) n`, etc.',
  print_ret: "**print_ret** *item*, …\n\nPrint items followed by a newline, then return `true`.",
  new_line: "**new_line** — print a newline character.",
  read: "**read** *buffer* *parse*\n\nRead a line of player input into *buffer* and parse it into *parse*.",

  // ── Directives (keyed without leading `#`) ────────────────────────────────
  array:
    "**Array** *name* *type* *size/values*\n\nDeclare an array.\n\nTypes:\n- `->` byte array\n- `-->` word array\n- `string` Z-string\n- `table` length-prefixed word array\n- `buffer` length-prefixed byte array",
  attribute: "**Attribute** *name* [**alias** *name*]\n\nDeclare a new object attribute (up to 48 attributes allowed).",
  class:
    "**Class** *Name* [(*n*)] [*classes*] … ;\n\nDefine an object class. The optional (*n*) pre-allocates *n* instances.",
  constant: "**Constant** *NAME* [= *value*]\n\nDeclare a compile-time constant.",
  default: "**Default** *Name* *value*\n\nDeclare a constant only if *Name* has not already been defined.",
  extend:
    "**Extend** *verb* [**replace** | **last** | **first**] *grammar* ;\n\nAdd or replace grammar lines for an existing verb.",
  fake_action: "**Fake_Action** *Name*\n\nDeclare an action number without generating a grammar entry.",
  global: "**Global** *name* [= *value*]\n\nDeclare a global variable.",
  ifdef: "**#Ifdef** *SYMBOL*\n\nConditionally compile the following block if *SYMBOL* is defined.",
  ifndef: "**#Ifndef** *SYMBOL*\n\nConditionally compile the following block if *SYMBOL* is not defined.",
  ifnot: "**#Ifnot**\n\nElse branch of `#Ifdef` / `#Ifndef`.",
  endif: "**#Endif**\n\nClose a conditional compilation block.",
  ifv3: "**#IfV3**\n\nTrue when the compilation target is Z-machine version 3.",
  ifv5: "**#IfV5**\n\nTrue when the compilation target is Z-machine version 4/5/6/8 or Glulx (i.e. not Z3).",
  include:
    '**Include** "*file*"\n\nInclude another source file at this point. The path is resolved relative to the library path in `inform6rc.yaml`.',
  message: '**Message** "*text*"\n\nEmit a compile-time informational message.',
  nearby: "**Nearby** *name* [*parent*] … ;\n\nDeclare an object as an initial sibling of the previous object.",
  object: "**Object** [*name*] [*parent*] … ;\n\nDeclare a game object.",
  property: "**Property** *name* [*default*]\n\nDeclare a new object property.",
  replace: "**Replace** *name*\n\nAllow a subsequent definition of *name* to silently override a library definition.",
  stub: "**Stub** *name* *n*\n\nDeclare a routine with *n* parameters that does nothing (forward declaration for optional routines).",
  verb: "**Verb** *'token'* … *grammar* ;\n\nDefine vocabulary and grammar for a player command.",

  // ── Object-body clause keywords ───────────────────────────────────────────
  with: "**with** — opens the property clause of an object or class definition.",
  private: "**private** — opens the private property clause (inaccessible from outside the object).",

  // ── Directive modifiers ───────────────────────────────────────────────────
  individual: "**individual** — used in `Property name individual` to declare a per-object (individual) property.",
  alias:
    "**alias** *name* — used in `Property`/`Attribute` to create an alternative name for an existing property or attribute.",

  // ── Verb/grammar tokens ───────────────────────────────────────────────────
  // `noun` has two senses, both lower-case identifiers:
  //   1. Grammar token in a Verb line (`* noun -> Take`).
  //   2. The primary object of the current player command, available as a
  //      pseudo-local inside an action routine.
  noun:
    "**noun**\n\n" +
    "- *Grammar token* (in a `Verb`/`Extend` line): matches the primary object noun.\n" +
    "- *Inside an action routine*: the primary object of the current player command.",
  held: "**held** — grammar token: like `noun` but the object must be held by the player.",
  multi: "**multi** — grammar token: matches multiple objects.",
  multiheld: "**multiheld** — grammar token: matches multiple held objects.",
  multiexcept: "**multiexcept** — grammar token: matches multiple objects except one specified.",
  multiinside: "**multiinside** — grammar token: matches multiple objects inside a container.",
  creature: "**creature** — grammar token: matches an animate object.",
  topic: "**topic** — grammar token: matches any sequence of words as a string topic.",
  special: "**special** — grammar token: matches a special dictionary word.",
  number: "**number** — grammar token: matches a number typed by the player.",
  "scope=": "**scope=***Routine* — grammar token: uses *Routine* to determine the scope of matchable objects.",
  only: "**only** — grammar line modifier: restricts this grammar line to exact token matches.",
  reverse: "**reverse** — grammar line modifier: swaps the roles of `noun` and `second`.",

  // ── Implicit locals in object routines ───────────────────────────────────
  // `noun` is documented above with both its grammar-token and action-routine
  // senses combined into a single entry.
  self: "**self** — implicit local in object/class routines; the object receiving the message.",
  sender: "**sender** — implicit local in object routines; the object that sent the message (or `nothing`).",
  second: "**second** — the secondary object of the current player command.",
  actor: "**actor** — the actor performing the current action (usually `player`).",

  // ── Built-in constants ────────────────────────────────────────────────────
  nothing: "**nothing** — the null object (value 0). Tests as false in boolean contexts.",
  true: "**true** — the integer constant 1.",
  false: "**false** — the integer constant 0.",
};

/**
 * Print-rule keywords recognised inside `print (…) expr`.
 * Keys are **case-sensitive** because `The` ≠ `the` and `A` ≠ `a`.
 * Each value is user-facing Markdown.
 */
const PRINT_RULE_HELP: Record<string, string> = {
  char: "**print (char)** *expr*\n\nPrint *expr* as a single ZSCII/Unicode character (like `@print_char`).",
  name: "**print (name)** *obj*\n\nPrint the short name of *obj* (the internal name, without articles).",
  the: '**print (the)** *obj*\n\nPrint the definite article + short name of *obj*, e.g. `"the sword"`.\n\nHandled by the library\'s `DefArt` routine, which respects `proper`, `pluralname`, etc.',
  The: '**print (The)** *obj*\n\nLike `(the)` but capitalised: `"The sword"`. Uses the library\'s `CDefArt` routine.',
  a: '**print (a)** *obj*\n\nPrint the indefinite article + short name, e.g. `"a sword"` or `"some coins"`.\n\nUses the library\'s `InDefArt` routine.',
  A: '**print (A)** *obj*\n\nLike `(a)` but capitalised: `"A sword"`. Uses the library\'s `CInDefArt` routine.',
  an: "**print (an)** *obj*\n\nSynonym for `(a)` — the library chooses the correct article regardless.",
  number:
    '**print (number)** *expr*\n\nPrint *expr* as a decimal number in words (e.g. `"twelve"`).\n\nUses the library\'s `EnglishNumber` routine.',
  address: "**print (address)** *expr*\n\nPrint a dictionary word given its packed address.",
  string: "**print (string)** *expr*\n\nPrint a string given its packed address (like `@print_paddr`).",
  object:
    "**print (object)** *expr*\n\nPrint an object's internal (hardware) name given its object number (like `@print_obj`).",
  property: "**print (property)** *expr*\n\nPrint the name of a property given its property number.",
};

/**
 * Return true if `col` in `lineText` is inside a `print (…)` print-rule
 * context — i.e. the word is preceded by `(` and there's a `print` or
 * `print_ret` earlier on the line.
 */
function isPrintRuleContext(lineText: string, wordStart: number): boolean {
  // Walk back from wordStart past optional whitespace to find '('
  let i = wordStart - 1;
  while (i >= 0 && lineText[i] === " ") i--;
  if (i < 0 || lineText[i] !== "(") return false;

  // Walk back past whitespace/commas to find 'print' or 'print_ret'
  // (could be preceded by other print items, e.g.  print "x", (The) obj)
  const before = lineText.slice(0, i).trimEnd();
  return /\bprint_ret\b/.test(before) || /\bprint\b/.test(before);
}

/**
 * Return hover Markdown for a print-rule keyword (case-sensitive), or null
 * if the word is not a print rule or is not in a `print (…)` context.
 */
export function findPrintRuleHover(word: string, lineText?: string, wordStart?: number): string | null {
  if (lineText == null || wordStart == null) return null;
  if (!isPrintRuleContext(lineText, wordStart)) return null;
  return PRINT_RULE_HELP[word] ?? null;
}

/** Keyword completion entries with display labels and CompletionItemKind values. */
export const KEYWORD_COMPLETIONS: { label: string; kind: "keyword" | "directive" }[] = [
  // Statements
  { label: "if", kind: "keyword" },
  { label: "else", kind: "keyword" },
  { label: "for", kind: "keyword" },
  { label: "while", kind: "keyword" },
  { label: "do", kind: "keyword" },
  { label: "until", kind: "keyword" },
  { label: "switch", kind: "keyword" },
  { label: "break", kind: "keyword" },
  { label: "continue", kind: "keyword" },
  { label: "return", kind: "keyword" },
  { label: "rtrue", kind: "keyword" },
  { label: "rfalse", kind: "keyword" },
  { label: "jump", kind: "keyword" },
  { label: "quit", kind: "keyword" },
  { label: "restart", kind: "keyword" },
  { label: "restore", kind: "keyword" },
  { label: "save", kind: "keyword" },
  { label: "move", kind: "keyword" },
  { label: "remove", kind: "keyword" },
  { label: "give", kind: "keyword" },
  { label: "has", kind: "keyword" },
  { label: "hasnt", kind: "keyword" },
  { label: "in", kind: "keyword" },
  { label: "notin", kind: "keyword" },
  { label: "ofclass", kind: "keyword" },
  { label: "objectloop", kind: "keyword" },
  { label: "print", kind: "keyword" },
  { label: "print_ret", kind: "keyword" },
  { label: "new_line", kind: "keyword" },
  { label: "read", kind: "keyword" },
  { label: "self", kind: "keyword" },
  { label: "nothing", kind: "keyword" },
  { label: "true", kind: "keyword" },
  { label: "false", kind: "keyword" },
  // Object-body clause keywords
  { label: "with", kind: "keyword" },
  { label: "private", kind: "keyword" },
  // Directive modifiers
  { label: "individual", kind: "keyword" },
  { label: "alias", kind: "keyword" },
  // Verb/grammar tokens
  { label: "noun", kind: "keyword" },
  { label: "held", kind: "keyword" },
  { label: "multi", kind: "keyword" },
  { label: "multiheld", kind: "keyword" },
  { label: "multiexcept", kind: "keyword" },
  { label: "multiinside", kind: "keyword" },
  { label: "creature", kind: "keyword" },
  { label: "topic", kind: "keyword" },
  { label: "special", kind: "keyword" },
  { label: "number", kind: "keyword" },
  { label: "scope=", kind: "keyword" },
  { label: "only", kind: "keyword" },
  { label: "reverse", kind: "keyword" },
  // Directives (capitalised as conventionally written)
  { label: "Array", kind: "directive" },
  { label: "Attribute", kind: "directive" },
  { label: "Class", kind: "directive" },
  { label: "Constant", kind: "directive" },
  { label: "Default", kind: "directive" },
  { label: "Extend", kind: "directive" },
  { label: "Fake_Action", kind: "directive" },
  { label: "Global", kind: "directive" },
  { label: "Include", kind: "directive" },
  { label: "Message", kind: "directive" },
  { label: "Nearby", kind: "directive" },
  { label: "Object", kind: "directive" },
  { label: "Property", kind: "directive" },
  { label: "Replace", kind: "directive" },
  { label: "Stub", kind: "directive" },
  { label: "Verb", kind: "directive" },
  { label: "#Ifdef", kind: "directive" },
  { label: "#Ifndef", kind: "directive" },
  { label: "#Ifnot", kind: "directive" },
  { label: "#Endif", kind: "directive" },
  { label: "#Ifv3", kind: "directive" },
  { label: "#Ifv5", kind: "directive" },
];

/**
 * Lowercase keys in KEYWORD_HELP that are compiler directives.
 * Directives are written with lead-cap in Inform 6 (Verb, Array, #Ifdef, …)
 * and only match when the hovered word starts with an uppercase letter.
 */
const DIRECTIVE_KEYS = new Set([
  "array",
  "attribute",
  "class",
  "constant",
  "default",
  "extend",
  "fake_action",
  "global",
  "ifdef",
  "ifndef",
  "ifnot",
  "endif",
  "ifv3",
  "ifv5",
  "include",
  "message",
  "nearby",
  "object",
  "property",
  "replace",
  "stub",
  "verb",
]);

/**
 * Return hover Markdown for a keyword or directive, or null if not matched.
 *
 * Case rules:
 * - Directive keywords (Verb, Array, #Ifdef, …) require a lead-cap first
 *   character so that e.g. "verb" inside a string literal doesn't trigger.
 * - Statement keywords (if, else, for, …) require an exact all-lowercase
 *   match — Inform 6 keywords are case-sensitive identifiers.
 */
export function findKeywordHover(word: string): string | null {
  const lower = word.toLowerCase();
  if (DIRECTIVE_KEYS.has(lower)) {
    return /^[A-Z]/.test(word) ? (KEYWORD_HELP[lower] ?? null) : null;
  }
  // Statement keywords, built-in constants, implicit locals — all-lowercase only.
  return word === lower ? (KEYWORD_HELP[lower] ?? null) : null;
}

/** TypeScript interfaces matching the `inform6 -y` JSON output schema. */

export interface GrammarActionRef {
  file: string;
  line: number;
}

export interface SymbolReference {
  sym: string;
  type: string;
  locs: string[]; // "fileIndex:line:col" — 0-based file index, 1-based line, 0-based col
}

export interface IncludeInfo {
  from_file: string;
  from_line: number; // 1-based
  from_col: number;  // 0-based
  given: string;     // raw argument as written in source
  resolved: string;  // absolute path of the included file
  file_index: number; // 0-based index into files[]
}

export interface CompilerIndex {
  version: number;
  files: string[];
  symbols: SymbolInfo[];
  routines: RoutineInfo[];
  objects: ObjectInfo[];
  globals: GlobalInfo[];
  constants: ConstantInfo[];
  arrays: ArrayInfo[];
  verbs: VerbInfo[];
  dictionary: DictionaryWord[];
  errors: CompilerError[];
  grammar_action_refs: GrammarActionRef[];
  includes?: IncludeInfo[];
  references?: SymbolReference[];
}

export interface SymbolInfo {
  name: string;
  type: string;
  value: number;
  flags: number;
  is_system: boolean;
  file?: string;
  line?: number;
  doc?: string;
  formal_declaration?: boolean; // property/individual_property only
}

export interface RoutineInfo {
  name: string;
  file: string;
  start_line: number;
  end_line: number;
  locals: string[];
  embedded?: boolean;
  doc?: string;
}

/** An attribute or property entry inside an object/class body. */
export interface PropertyRef {
  name: string;
  line: number;
}

export interface ObjectInfo {
  name: string;
  shortname?: string;
  file: string;
  start_line: number;
  end_line: number;
  is_class?: boolean;
  parent?: string;
  attributes: PropertyRef[];
  properties: PropertyRef[];
  private_properties: PropertyRef[];
  doc?: string;
}

export interface GlobalInfo {
  name: string;
  file: string;
  line: number;
  doc?: string;
}

export interface ConstantInfo {
  name: string;
  file: string;
  line: number;
  doc?: string;
}

export interface ArrayInfo {
  name: string;
  file: string;
  line: number;
  array_type: string;
  size: number;
  is_static?: boolean;
  doc?: string;
}

export interface VerbInfo {
  verb_num: number;
  words: string[];
  actions: string[];
  file: string;
  line: number;
}

export interface DictionaryWord {
  word: string;
  noun?: boolean;
  verb?: boolean;
  preposition?: boolean;
  meta?: boolean;
  plural?: boolean;
}

export interface CompilerError {
  file: string;
  line: number;
  message: string;
  severity: "error" | "warning" | "fatal";
}

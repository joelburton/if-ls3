/** TypeScript interfaces matching the `inform6 -y` JSON output schema. */

export interface GrammarActionRef {
  file: string;
  line: number;
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

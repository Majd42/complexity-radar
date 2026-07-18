/**
 * Language definitions that drive the heuristic analyzer.
 *
 * The analyzer is deliberately parser-free: it strips comments/strings, finds
 * function signatures with regexes, isolates each body by bracket- or
 * indentation-matching, then counts decision points. That keeps the tool a
 * single dependency-free package that works across many languages, at the cost
 * of the precision a real per-language AST would give you. JS/TS, Python and Go
 * detection is reliable; Java and C# extraction is best-effort.
 */

export type BlockStyle = "brace" | "indent";

export interface LanguageDef {
  /** Stable id used in reports. */
  id: string;
  /** Human-friendly label. */
  label: string;
  /** File extensions (with leading dot) that map to this language. */
  extensions: string[];
  /** Line-comment tokens. */
  lineComment: string[];
  /** Block-comment [open, close] pairs. */
  blockComment: [string, string][];
  /** String / char delimiters. List longer ones first (e.g. `"""` before `"`). */
  strings: string[];
  /** How function bodies are delimited. */
  block: BlockStyle;
  /**
   * Signature patterns. Each must capture the function name in group 1 and end
   * at the opening parenthesis of the parameter list (`\(`), so the analyzer can
   * bracket-match the params and then locate the body.
   */
  signaturePatterns: RegExp[];
  /** Keywords that each introduce one decision point (word-boundary matched). */
  decisionKeywords: string[];
  /** Operators that each introduce one decision point. */
  decisionOperators: DecisionOperator[];
  /** Keyword sets driving the cognitive-complexity heuristic. */
  cognitive: CognitiveDef;
}

export type DecisionOperator = "&&" | "||" | "??" | "?";

/**
 * Cognitive-complexity keyword sets (SonarSource-style, heuristic).
 *
 * Unlike cyclomatic complexity, cognitive complexity charges more for deeply
 * nested control flow and counts a `switch` once rather than once per `case`.
 */
export interface CognitiveDef {
  /**
   * Structures that add `1 + current nesting level` and open a new nesting
   * level for their body (`if`, loops, `switch`, `catch`, …).
   */
  nesting: string[];
  /**
   * Structures that add a flat `1` (no nesting penalty) but still nest their
   * body — the `else` / `elif` family. An `else if` is treated as a single
   * increment, not two.
   */
  flat: string[];
  /**
   * Binary logical tokens (`&&`, `||`, or word forms like `and`/`or`). Each
   * maximal run of the same token adds `1`, with no nesting penalty.
   */
  logical: string[];
}

/** Names that a signature regex may capture but which are never functions. */
export const RESERVED_NAMES = new Set([
  "if", "else", "for", "while", "switch", "case", "default", "do", "with",
  "return", "throw", "try", "catch", "finally", "break", "continue",
  "function", "class", "const", "let", "var", "new", "delete", "typeof",
  "void", "in", "of", "await", "yield", "instanceof", "super", "this",
  "import", "export", "from", "as", "extends", "implements", "public",
  "private", "protected", "static", "async", "get", "set", "readonly",
  "foreach", "func", "def", "elif", "except", "and", "or", "not", "using",
  "namespace", "struct", "interface", "enum", "package", "select",
]);

const C_LINE = ["//"];
const C_BLOCK: [string, string][] = [["/*", "*/"]];

export const LANGUAGES: LanguageDef[] = [
  {
    id: "typescript",
    label: "TypeScript",
    extensions: [".ts", ".tsx", ".mts", ".cts"],
    lineComment: C_LINE,
    blockComment: C_BLOCK,
    strings: ["`", '"', "'"],
    block: "brace",
    signaturePatterns: [
      // function foo(  /  function* foo(
      /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g,
      // const foo = (…) =>  /  foo: function(…)  /  foo = async (…) =>
      /\b([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s+)?(?:function\s*\*?\s*)?\(/g,
      // class / object methods:  name(…) {   (with optional modifiers)
      /(?:^|[\n;{}])\s*(?:(?:public|private|protected|static|async|get|set|readonly|override|abstract)\s+)*([A-Za-z_$][\w$]*)\s*\(/g,
    ],
    decisionKeywords: ["if", "for", "while", "case", "catch"],
    decisionOperators: ["&&", "||", "??", "?"],
    cognitive: {
      nesting: ["if", "for", "while", "switch", "catch"],
      flat: ["else"],
      logical: ["&&", "||"],
    },
  },
  {
    id: "javascript",
    label: "JavaScript",
    extensions: [".js", ".jsx", ".mjs", ".cjs"],
    lineComment: C_LINE,
    blockComment: C_BLOCK,
    strings: ["`", '"', "'"],
    block: "brace",
    signaturePatterns: [
      /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g,
      /\b([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s+)?(?:function\s*\*?\s*)?\(/g,
      /(?:^|[\n;{}])\s*(?:(?:public|private|protected|static|async|get|set)\s+)*([A-Za-z_$][\w$]*)\s*\(/g,
    ],
    decisionKeywords: ["if", "for", "while", "case", "catch"],
    decisionOperators: ["&&", "||", "??", "?"],
    cognitive: {
      nesting: ["if", "for", "while", "switch", "catch"],
      flat: ["else"],
      logical: ["&&", "||"],
    },
  },
  {
    id: "python",
    label: "Python",
    extensions: [".py", ".pyi"],
    lineComment: ["#"],
    blockComment: [],
    strings: ['"""', "'''", '"', "'"],
    block: "indent",
    signaturePatterns: [/\bdef\s+([A-Za-z_]\w*)\s*\(/g],
    decisionKeywords: ["if", "elif", "for", "while", "except", "case", "and", "or"],
    decisionOperators: [],
    cognitive: {
      nesting: ["if", "for", "while", "except"],
      flat: ["elif", "else"],
      logical: ["and", "or"],
    },
  },
  {
    id: "go",
    label: "Go",
    extensions: [".go"],
    lineComment: C_LINE,
    blockComment: C_BLOCK,
    strings: ["`", '"', "'"],
    block: "brace",
    // func name(  or  func (recv T) name(
    signaturePatterns: [/\bfunc\s*(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/g],
    decisionKeywords: ["if", "for", "case"],
    decisionOperators: ["&&", "||"],
    cognitive: {
      nesting: ["if", "for", "switch"],
      flat: ["else"],
      logical: ["&&", "||"],
    },
  },
  {
    id: "java",
    label: "Java",
    extensions: [".java"],
    lineComment: C_LINE,
    blockComment: C_BLOCK,
    strings: ['"""', '"', "'"],
    block: "brace",
    // [modifiers] returnType name(   — requires a type token before the name.
    signaturePatterns: [
      /(?:^|[\n;{}])\s*(?:@\w+\s*)*(?:(?:public|private|protected|static|final|abstract|synchronized|native|default)\s+)*[A-Za-z_][\w<>\[\].,\s]*?\s+([A-Za-z_]\w*)\s*\(/g,
    ],
    decisionKeywords: ["if", "for", "while", "case", "catch"],
    decisionOperators: ["&&", "||", "?"],
    cognitive: {
      nesting: ["if", "for", "while", "switch", "catch"],
      flat: ["else"],
      logical: ["&&", "||"],
    },
  },
  {
    id: "csharp",
    label: "C#",
    extensions: [".cs"],
    lineComment: C_LINE,
    blockComment: C_BLOCK,
    strings: ['"""', '"', "'"],
    block: "brace",
    signaturePatterns: [
      /(?:^|[\n;{}])\s*(?:\[[^\]]*\]\s*)*(?:(?:public|private|protected|internal|static|virtual|override|sealed|async|partial|abstract|extern|new|unsafe)\s+)*[A-Za-z_][\w<>\[\].,\s]*?\s+([A-Za-z_]\w*)\s*\(/g,
    ],
    decisionKeywords: ["if", "for", "foreach", "while", "case", "catch"],
    decisionOperators: ["&&", "||", "??", "?"],
    cognitive: {
      nesting: ["if", "for", "foreach", "while", "switch", "catch"],
      flat: ["else"],
      logical: ["&&", "||"],
    },
  },
];

const EXT_MAP: Map<string, LanguageDef> = (() => {
  const map = new Map<string, LanguageDef>();
  for (const lang of LANGUAGES) {
    for (const ext of lang.extensions) map.set(ext, lang);
  }
  return map;
})();

/** Look up a language by file extension (case-insensitive, leading dot). */
export function languageForExtension(ext: string): LanguageDef | undefined {
  return EXT_MAP.get(ext.toLowerCase());
}

/**
 * Language definitions that drive the heuristic analyzer.
 *
 * The analyzer is deliberately parser-free: it strips comments/strings, finds
 * function signatures with regexes, isolates each body by bracket- or
 * indentation-matching, then counts decision points. That keeps the tool a
 * single dependency-free package that works across many languages, at the cost
 * of the precision a real per-language AST would give you. JS/TS, Python and Go
 * detection is reliable; Java, C# and Ruby extraction is best-effort. Ruby's
 * `def`…`end` bodies use a third block style ("keyword") that brackets openers
 * against `end`s line by line.
 */

export type BlockStyle = "brace" | "indent" | "keyword";

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
  /**
   * Single quotes may denote a lifetime/label rather than a char literal
   * (Rust: `'a`, `'static`, `'outer: loop`). When set, a `'` is only treated as
   * a string/char delimiter when it actually closes as a char literal.
   */
  lifetimeQuotes?: boolean;
  /** How function bodies are delimited. */
  block: BlockStyle;
  /**
   * For `block: "keyword"` languages (Ruby): keywords that, when they lead a
   * line, open a block terminated by {@link blockCloser} (`def`, `if`, `while`,
   * `case`, `begin`, …). A trailing `do` opens one too. Used to bracket-match a
   * method body by counting openers against closers.
   */
  blockOpeners?: string[];
  /** For `block: "keyword"` languages: the token that closes a block (`end`). */
  blockCloser?: string;
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

export type DecisionOperator = "&&" | "||" | "??" | "?" | "=>";

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
  "fn", "impl", "trait", "mut", "dyn", "move", "unsafe", "where", "loop",
  "match", "pub", "crate", "mod", "ref", "type",
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
  {
    id: "rust",
    label: "Rust",
    extensions: [".rs"],
    lineComment: C_LINE, // covers `//`, `///` and `//!` doc comments
    blockComment: C_BLOCK,
    // No `'` here: single quotes are handled via `lifetimeQuotes` so lifetimes
    // (`'a`, `'static`) and loop labels (`'outer:`) aren't mistaken for strings.
    strings: ['"'],
    lifetimeQuotes: true,
    block: "brace",
    // fn name(  /  pub fn name(  /  async fn name<'a, T>(  /  const fn name(
    signaturePatterns: [/\bfn\s+([A-Za-z_]\w*)\s*(?:<[^{(;]*>)?\s*\(/g],
    // No ternary in Rust, and `?` is the try operator — never a decision.
    // Each `match` arm (`=>`) is a branch, mirroring how `case` scores a switch.
    decisionKeywords: ["if", "while", "for", "loop"],
    decisionOperators: ["&&", "||", "=>"],
    cognitive: {
      // `match` counts once (like `switch`) and opens a nesting level.
      nesting: ["if", "while", "for", "loop", "match"],
      flat: ["else"],
      logical: ["&&", "||"],
    },
  },
  {
    id: "ruby",
    label: "Ruby",
    extensions: [".rb"],
    lineComment: ["#"],
    // `=begin`/`=end` block comments are line-anchored and rare; like Python
    // (docstrings) we skip them rather than risk matching a stray `=begin`.
    blockComment: [],
    strings: ['"', "'", "`"],
    // Bodies run from `def` to the matching `end`, not by braces or indentation.
    block: "keyword",
    blockOpeners: ["def", "class", "module", "if", "unless", "while", "until", "for", "case", "begin"],
    blockCloser: "end",
    // `def name` / `def name(…)` / `def self.name` / `def Klass.name`. Method
    // names may end in `?` (predicates), `!` (bang), or `=` (setters). Params
    // are often parenless, so the keyword extractor resolves them itself.
    signaturePatterns: [/\bdef\s+(?:self\.|[A-Z]\w*\.)?([A-Za-z_]\w*[?!=]?)/g],
    // `?` is deliberately NOT a decision operator: predicate methods (`empty?`,
    // `nil?`) and char literals (`?a`) would swamp any real ternary count.
    // `case`/`when` is scored via each `when`, mirroring `switch`/`case`.
    decisionKeywords: ["if", "elsif", "unless", "while", "until", "for", "when", "rescue", "and", "or"],
    decisionOperators: ["&&", "||"],
    cognitive: {
      nesting: ["if", "unless", "while", "until", "for", "case"],
      flat: ["elsif", "else"],
      logical: ["&&", "||", "and", "or"],
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

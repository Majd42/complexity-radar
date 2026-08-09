import {
  cleanSource,
  countNonBlankLines,
  escapeRegExp,
  LineIndex,
  matchBracket,
} from "./clean.js";
import {
  type DecisionOperator,
  type LanguageDef,
  RESERVED_NAMES,
} from "./languages.js";
import type { FunctionMetric, Severity } from "./types.js";

/** Default severity thresholds, roughly aligned with common McCabe guidance. */
export const SEVERITY_THRESHOLDS = { moderate: 11, high: 21, veryHigh: 41 } as const;

export function severityFor(complexity: number): Severity {
  if (complexity >= SEVERITY_THRESHOLDS.veryHigh) return "veryHigh";
  if (complexity >= SEVERITY_THRESHOLDS.high) return "high";
  if (complexity >= SEVERITY_THRESHOLDS.moderate) return "moderate";
  return "low";
}

/**
 * Count decision points in a cleaned function body and return the cyclomatic
 * complexity (1 + decisions).
 */
export function complexityOf(cleanBody: string, lang: LanguageDef): number {
  let decisions = 0;

  for (const kw of lang.decisionKeywords) {
    const re = new RegExp(`\\b${escapeRegExp(kw)}\\b`, "g");
    const m = cleanBody.match(re);
    if (m) decisions += m.length;
  }

  decisions += countOperators(cleanBody, lang.decisionOperators);

  return decisions + 1;
}

function countOperators(body: string, ops: DecisionOperator[]): number {
  let count = 0;
  if (ops.includes("&&")) count += matchCount(body, /&&/g);
  if (ops.includes("||")) count += matchCount(body, /\|\|/g);
  if (ops.includes("??")) count += matchCount(body, /\?\?/g);
  // Each `=>` is a `match` arm (Rust) — a branch, like a `case`.
  if (ops.includes("=>")) count += matchCount(body, /=>/g);
  if (ops.includes("?")) {
    // Ternary `?` only: drop nullish `??` and optional-chaining `?.` first.
    const ternaryOnly = body.replace(/\?\?/g, "  ").replace(/\?\./g, "  ");
    count += matchCount(ternaryOnly, /\?/g);
  }
  return count;
}

function matchCount(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? m.length : 0;
}

/**
 * Cognitive complexity of a cleaned function body (SonarSource-style heuristic).
 *
 * The difference from cyclomatic complexity is that nesting is penalised —
 * each control structure adds `1 + the current nesting depth` — while a
 * `switch` counts once instead of once per `case`, and `else`/`elif` add a
 * flat `1`. Being parser-free the numbers are directional, not exact, but they
 * track how hard a function is to follow far better than a raw path count.
 */
export function cognitiveOf(cleanBody: string, lang: LanguageDef): number {
  const structural =
    lang.block === "brace"
      ? cognitiveBrace(cleanBody, lang)
      : cognitiveIndent(cleanBody, lang);
  return structural + logicalSequences(cleanBody, lang.cognitive.logical);
}

function isWordChar(c: string | undefined): boolean {
  return c !== undefined && (/[\w$]/.test(c));
}

/** Cognitive scoring for brace-delimited languages, tracking brace nesting. */
function cognitiveBrace(body: string, lang: LanguageDef): number {
  const nestKw = lang.cognitive.nesting;
  const flatKw = lang.cognitive.flat;
  // Only languages with a real ternary treat `?` as a conditional. In Rust `?`
  // is the try operator and must not be charged as a branch.
  const hasTernary = lang.decisionOperators.includes("?");
  let score = 0;
  let nesting = 0;
  let parenDepth = 0;
  // Whether the next `{` opens a nesting scope (a control keyword is pending).
  let pendingNest = false;
  const braceNests: boolean[] = [];
  const n = body.length;

  let i = 0;
  while (i < n) {
    const c = body[i]!;

    if (c === "(") { parenDepth++; i++; continue; }
    if (c === ")") { if (parenDepth > 0) parenDepth--; i++; continue; }
    if (c === "{") {
      braceNests.push(pendingNest);
      if (pendingNest) nesting++;
      pendingNest = false;
      i++;
      continue;
    }
    if (c === "}") {
      if (braceNests.pop()) nesting = Math.max(0, nesting - 1);
      i++;
      continue;
    }
    // End of a braceless statement drops any pending nesting attachment, so an
    // `if (x) return;` doesn't wrongly nest an unrelated later block.
    if (c === ";" && parenDepth === 0) { pendingNest = false; i++; continue; }

    if (c === "?" && hasTernary) {
      const next = body[i + 1];
      if (next === "?" || next === "." || next === ":") { i += 2; continue; }
      // Ternary: a conditional, charged like a nested branch.
      score += 1 + nesting;
      i++;
      continue;
    }

    if (isWordChar(c) && !isWordChar(body[i - 1])) {
      let j = i + 1;
      while (j < n && isWordChar(body[j])) j++;
      const word = body.slice(i, j);
      if (nestKw.includes(word)) {
        score += 1 + nesting;
        pendingNest = true;
      } else if (flatKw.includes(word)) {
        score += 1;
        pendingNest = true; // the else/elif body still nests its contents
        // Collapse `else if` into a single increment: skip the trailing `if`.
        let k = j;
        while (k < n && /\s/.test(body[k]!)) k++;
        if (body.startsWith("if", k) && !isWordChar(body[k + 2])) j = k + 2;
      }
      i = j;
      continue;
    }

    i++;
  }
  return score;
}

/** Cognitive scoring for indentation-delimited languages (Python). */
function cognitiveIndent(body: string, lang: LanguageDef): number {
  const nestKw = lang.cognitive.nesting;
  const flatKw = lang.cognitive.flat;
  const stack: number[] = []; // indents of enclosing control blocks
  let score = 0;

  for (const line of body.split("\n")) {
    if (line.trim() === "") continue;
    const ind = indentOf(line);
    while (stack.length > 0 && ind <= stack[stack.length - 1]!) stack.pop();
    const nesting = stack.length;

    const first = leadingWord(line);
    if (!first) continue;
    if (nestKw.includes(first)) {
      score += 1 + nesting;
      stack.push(ind);
    } else if (flatKw.includes(first)) {
      score += 1;
      stack.push(ind);
    }
  }
  return score;
}

/** The first identifier token on a (possibly indented) line, or "". */
function leadingWord(line: string): string {
  const m = /^\s*([A-Za-z_]\w*)/.exec(line);
  return m ? m[1]! : "";
}

/**
 * Count maximal runs of the same binary logical token. `a && b && c` is one
 * run (+1); `a && b || c` is two (+1 each). A run is broken by an intervening
 * expression boundary (`;`, braces, parens, newline), so operators in separate
 * expressions never merge into one run.
 */
function logicalSequences(body: string, logical: string[]): number {
  if (logical.length === 0) return 0;
  const parts = logical.map((op) =>
    /^[A-Za-z]/.test(op) ? `\\b${escapeRegExp(op)}\\b` : escapeRegExp(op),
  );
  const re = new RegExp(parts.join("|"), "g");
  let count = 0;
  let prev: string | null = null;
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (/[;{}()\n]/.test(body.slice(lastEnd, m.index))) prev = null;
    if (m[0] !== prev) count++;
    prev = m[0];
    lastEnd = m.index + m[0].length;
  }
  return count;
}

/**
 * Analyse a single source string and return one {@link FunctionMetric} per
 * detected function, plus the file's total non-blank LOC.
 */
export function analyzeSource(
  src: string,
  lang: LanguageDef,
): { functions: FunctionMetric[]; loc: number } {
  const clean = cleanSource(src, lang);
  const lines = new LineIndex(src);
  const loc = countNonBlankLines(clean);
  const functions =
    lang.block === "brace"
      ? extractBraceFunctions(src, clean, lang, lines)
      : lang.block === "keyword"
        ? extractKeywordFunctions(src, clean, lang, lines)
        : extractIndentFunctions(src, clean, lang, lines);
  return { functions, loc };
}

function extractBraceFunctions(
  src: string,
  clean: string,
  lang: LanguageDef,
  lines: LineIndex,
): FunctionMetric[] {
  const seen = new Set<number>(); // body-brace offsets already recorded
  const results: FunctionMetric[] = [];

  for (const pattern of lang.signaturePatterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(clean)) !== null) {
      const name = match[1];
      if (!name || RESERVED_NAMES.has(name)) continue;

      // The pattern ends at the opening paren of the parameter list.
      const parenOpen = match.index + match[0].length - 1;
      if (clean[parenOpen] !== "(") continue;
      const parenClose = matchBracket(clean, parenOpen);
      if (parenClose < 0) continue;

      const braceOpen = clean.indexOf("{", parenClose + 1);
      const semi = clean.indexOf(";", parenClose + 1);
      const arrow = clean.indexOf("=>", parenClose + 1);
      const params = countParams(clean.slice(parenOpen + 1, parenClose));

      // Expression-bodied arrow / lambda: `(…) => expr` with no block. Common
      // in JS/TS and C#, and easy to miss. Detect it before the block path.
      const isArrow =
        arrow >= 0 &&
        arrow - parenClose < 120 &&
        (braceOpen < 0 || arrow < braceOpen) &&
        (semi < 0 || arrow < semi);
      let afterArrow = arrow + 2;
      while (isArrow && afterArrow < clean.length && /\s/.test(clean[afterArrow]!)) afterArrow++;

      if (isArrow && clean[afterArrow] !== "{") {
        if (seen.has(afterArrow)) continue;
        const end = scanExpression(clean, afterArrow);
        seen.add(afterArrow);
        const body = clean.slice(afterArrow, end + 1);
        const complexity = complexityOf(body, lang);
        results.push({
          name,
          line: lines.lineAt(match.index),
          endLine: lines.lineAt(end),
          complexity,
          cognitive: cognitiveOf(body, lang),
          loc: countNonBlankLines(body),
          maxNesting: 0,
          params,
          severity: severityFor(complexity),
        });
        continue;
      }

      // Block body: the next brace, with no intervening ';' (else it's a
      // declaration, interface method, or abstract signature — no body).
      if (braceOpen < 0) continue;
      if (semi >= 0 && semi < braceOpen && !(isArrow && arrow < semi)) continue;
      // Guard against a huge gap that usually means a mis-match.
      if (braceOpen - parenClose > 200) continue;
      if (seen.has(braceOpen)) continue;

      const braceClose = matchBracket(clean, braceOpen);
      if (braceClose < 0) continue;
      seen.add(braceOpen);

      const body = clean.slice(braceOpen, braceClose + 1);
      const complexity = complexityOf(body, lang);

      results.push({
        name,
        line: lines.lineAt(match.index),
        endLine: lines.lineAt(braceClose),
        complexity,
        cognitive: cognitiveOf(body, lang),
        loc: countNonBlankLines(body),
        maxNesting: braceNesting(body),
        params,
        severity: severityFor(complexity),
      });
    }
  }

  results.sort((a, b) => a.line - b.line);
  return results;
}

function extractIndentFunctions(
  src: string,
  clean: string,
  lang: LanguageDef,
  lines: LineIndex,
): FunctionMetric[] {
  const cleanLines = clean.split("\n");
  const srcLines = src.split("\n");
  const results: FunctionMetric[] = [];

  const pattern = lang.signaturePatterns[0];
  if (!pattern) return results;
  pattern.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(clean)) !== null) {
    const name = match[1];
    if (!name || RESERVED_NAMES.has(name)) continue;

    const defLine0 = lines.lineAt(match.index) - 1; // 0-based
    const defIndent = indentOf(cleanLines[defLine0] ?? "");

    // Body runs until the first non-blank line indented no deeper than the def.
    let endLine0 = defLine0;
    for (let l = defLine0 + 1; l < cleanLines.length; l++) {
      const line = cleanLines[l] ?? "";
      if (line.trim() === "") continue; // blank lines don't end a block
      if (indentOf(line) <= defIndent) break;
      endLine0 = l;
    }

    const bodyLines = cleanLines.slice(defLine0, endLine0 + 1);
    const body = bodyLines.join("\n");
    const params = countParams(clean.slice(match.index + match[0].length, matchBracket(clean, match.index + match[0].length - 1)));
    const complexity = complexityOf(body, lang);

    results.push({
      name,
      line: defLine0 + 1,
      endLine: endLine0 + 1,
      complexity,
      cognitive: cognitiveOf(body, lang),
      loc: countNonBlankLines(srcLines.slice(defLine0, endLine0 + 1).join("\n")),
      maxNesting: indentNesting(bodyLines, defIndent),
      params,
      severity: severityFor(complexity),
    });
  }

  results.sort((a, b) => a.line - b.line);
  return results;
}

/**
 * Extract functions for keyword/`end`-delimited languages (Ruby).
 *
 * Unlike braces or indentation, a Ruby method body is closed by an `end` that
 * balances the `def` — with every intervening `if`/`while`/`case`/`do`/… also
 * claiming its own `end`. We bracket-match those openers against `end`s line by
 * line. Params may be parenless (`def foo a, b`) and one-line "endless" methods
 * (`def foo(x) = expr`) have no `end` at all; both are handled here.
 */
function extractKeywordFunctions(
  src: string,
  clean: string,
  lang: LanguageDef,
  lines: LineIndex,
): FunctionMetric[] {
  const openers = new Set(lang.blockOpeners ?? []);
  const closer = lang.blockCloser ?? "end";
  const cleanLines = clean.split("\n");
  const srcLines = src.split("\n");
  const results: FunctionMetric[] = [];

  const pattern = lang.signaturePatterns[0];
  if (!pattern) return results;
  pattern.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(clean)) !== null) {
    const name = match[1];
    if (!name) continue;

    // Locate the (optional) parameter list and where the signature body starts.
    const afterName = match.index + match[0].length;
    let params = 0;
    let sigEnd = afterName;
    const hasParens = clean[afterName] === "(";
    if (hasParens) {
      const close = matchBracket(clean, afterName);
      if (close < 0) continue;
      params = countParams(clean.slice(afterName + 1, close));
      sigEnd = close + 1;
    }

    // "Endless" method: `def foo = expr` / `def foo(x) = expr` — a single bare
    // `=` (not `==`, `=~`, `=>`) after the signature, and no `end`.
    let k = sigEnd;
    while (k < clean.length && (clean[k] === " " || clean[k] === "\t")) k++;
    const isEndless =
      clean[k] === "=" && !["=", "~", ">"].includes(clean[k + 1] ?? "");

    if (isEndless) {
      let eol = clean.indexOf("\n", k);
      if (eol < 0) eol = clean.length;
      const body = clean.slice(k + 1, eol);
      const complexity = complexityOf(body, lang);
      results.push({
        name,
        line: lines.lineAt(match.index),
        endLine: lines.lineAt(Math.max(k, eol - 1)),
        complexity,
        cognitive: cognitiveOf(body, lang),
        loc: countNonBlankLines(body),
        maxNesting: 0,
        params,
        severity: severityFor(complexity),
      });
      continue;
    }

    // Parenless params run to the end of the signature line (`def foo a, b`).
    if (!hasParens) {
      let eol = clean.indexOf("\n", afterName);
      if (eol < 0) eol = clean.length;
      const paramText = clean.slice(afterName, eol);
      params = paramText.trim() === "" ? 0 : countParams(paramText);
    }

    // Block body: scan lines until the `def`'s matching `end` closes it.
    const startLine0 = lines.lineAt(sigEnd) - 1; // 0-based signature line
    let depth = 1; // the `def` itself
    let endLine0 = startLine0;
    for (let l = startLine0 + 1; l < cleanLines.length; l++) {
      depth += lineDepthDelta(cleanLines[l] ?? "", openers, closer);
      endLine0 = l;
      if (depth <= 0) break;
    }

    const bodyLines = cleanLines.slice(startLine0, endLine0 + 1);
    const body = bodyLines.join("\n");
    const complexity = complexityOf(body, lang);
    results.push({
      name,
      line: lines.lineAt(match.index),
      endLine: endLine0 + 1,
      complexity,
      cognitive: cognitiveOf(body, lang),
      loc: countNonBlankLines(srcLines.slice(startLine0, endLine0 + 1).join("\n")),
      maxNesting: indentNesting(bodyLines, indentOf(cleanLines[startLine0] ?? "")),
      params,
      severity: severityFor(complexity),
    });
  }

  results.sort((a, b) => a.line - b.line);
  return results;
}

/**
 * Net change in block depth for one cleaned Ruby line: openers minus `end`s.
 * A leading control keyword (`if`, `while`, `case`, `begin`, `def`, …) opens
 * one block; otherwise each trailing `do` (`items.each do |x|`) opens one.
 * Trailing modifiers (`return x if y`) never lead the line, so they don't nest.
 */
function lineDepthDelta(line: string, openers: Set<string>, closer: string): number {
  const closes = (line.match(new RegExp(`\\b${escapeRegExp(closer)}\\b`, "g")) || []).length;
  const lead = leadingWord(line);
  const opens = openers.has(lead) ? 1 : (line.match(/\bdo\b/g) || []).length;
  return opens - closes;
}

function indentOf(line: string): number {
  let i = 0;
  while (i < line.length && (line[i] === " " || line[i] === "\t")) i++;
  return i;
}

function indentNesting(bodyLines: string[], defIndent: number): number {
  const stack: number[] = [defIndent];
  let max = 0;
  for (const line of bodyLines) {
    if (line.trim() === "") continue;
    const ind = indentOf(line);
    while (stack.length > 1 && ind <= stack[stack.length - 1]!) stack.pop();
    if (ind > stack[stack.length - 1]!) stack.push(ind);
    max = Math.max(max, stack.length - 1);
  }
  return max;
}

/**
 * Delimit an expression-bodied arrow: scan from `start` until a `;` or a `,`
 * at depth 0, or a closing bracket that belongs to an enclosing scope.
 */
function scanExpression(clean: string, start: number): number {
  let depth = 0;
  for (let k = start; k < clean.length; k++) {
    const c = clean[k];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) return k - 1;
      depth--;
    } else if ((c === ";" || c === ",") && depth === 0) return k - 1;
  }
  return clean.length - 1;
}

function braceNesting(body: string): number {
  let depth = 0;
  let max = 0;
  for (const c of body) {
    if (c === "{") {
      depth++;
      max = Math.max(max, depth);
    } else if (c === "}") {
      depth--;
    }
  }
  // The body's own outer braces are depth 1; report nesting beyond that.
  return Math.max(0, max - 1);
}

/** Count top-level (comma-separated) parameters in a cleaned param string. */
function countParams(paramText: string): number {
  const trimmed = paramText.trim();
  if (trimmed === "") return 0;
  let depth = 0;
  let count = 1;
  for (const c of paramText) {
    if (c === "(" || c === "[" || c === "{" || c === "<") depth++;
    else if (c === ")" || c === "]" || c === "}" || c === ">") depth--;
    else if (c === "," && depth === 0) count++;
  }
  return count;
}

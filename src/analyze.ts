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
      loc: countNonBlankLines(srcLines.slice(defLine0, endLine0 + 1).join("\n")),
      maxNesting: indentNesting(bodyLines, defIndent),
      params,
      severity: severityFor(complexity),
    });
  }

  results.sort((a, b) => a.line - b.line);
  return results;
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

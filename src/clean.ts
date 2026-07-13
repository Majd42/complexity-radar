import type { LanguageDef } from "./languages.js";

/**
 * Return a copy of `src` in which every character that lives inside a comment
 * or a string literal has been replaced by a space, while newlines and all
 * other characters keep their original position.
 *
 * Preserving offsets is the whole point: downstream code can brace-match and
 * map offsets back to line numbers against the cleaned text, and keyword
 * counting never trips over the word "if" that happened to sit in a comment or
 * a string.
 */
export function cleanSource(src: string, lang: LanguageDef): string {
  const out = src.split("");
  const n = src.length;

  const blank = (start: number, end: number): void => {
    for (let k = start; k < end && k < n; k++) {
      if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
    }
  };

  let i = 0;
  while (i < n) {
    // Line comments -> to end of line.
    const lc = lang.lineComment.find((token) => src.startsWith(token, i));
    if (lc) {
      let j = src.indexOf("\n", i);
      if (j < 0) j = n;
      blank(i, j);
      i = j;
      continue;
    }

    // Block comments -> to the closing token (or EOF).
    const bc = lang.blockComment.find(([open]) => src.startsWith(open, i));
    if (bc) {
      const [open, close] = bc;
      let j = src.indexOf(close, i + open.length);
      j = j < 0 ? n : j + close.length;
      blank(i, j);
      i = j;
      continue;
    }

    // String / char literals. Longer delimiters (""" ''') are tried first
    // because the language table lists them first.
    const delim = lang.strings.find((d) => src.startsWith(d, i));
    if (delim) {
      const raw = delim === "`"; // backtick == no backslash escapes (Go raw / good enough for JS)
      let j = i + delim.length;
      while (j < n) {
        if (!raw && src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src.startsWith(delim, j)) {
          j += delim.length;
          break;
        }
        j++;
      }
      blank(i, Math.min(j, n));
      i = Math.min(j, n);
      continue;
    }

    i++;
  }

  return out.join("");
}

/** Maps character offsets in a source string to 1-based line numbers. */
export class LineIndex {
  private readonly starts: number[];

  constructor(src: string) {
    const starts = [0];
    for (let i = 0; i < src.length; i++) {
      if (src[i] === "\n") starts.push(i + 1);
    }
    this.starts = starts;
  }

  /** 1-based line number containing `offset`. */
  lineAt(offset: number): number {
    const starts = this.starts;
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }
}

/**
 * Given the index of an opening bracket, return the index of the matching
 * closing bracket, or -1 if unbalanced. Operates on cleaned text, so brackets
 * inside strings/comments have already been removed.
 */
export function matchBracket(text: string, openIndex: number): number {
  const open = text[openIndex];
  const close = open === "(" ? ")" : open === "{" ? "}" : open === "[" ? "]" : "";
  if (!close) return -1;
  let depth = 0;
  for (let k = openIndex; k < text.length; k++) {
    const c = text[k];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return k;
    }
  }
  return -1;
}

/** Escape a string for safe use inside a RegExp. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Count non-blank lines in a chunk of text. */
export function countNonBlankLines(text: string): number {
  let count = 0;
  for (const line of text.split("\n")) {
    if (line.trim() !== "") count++;
  }
  return count;
}

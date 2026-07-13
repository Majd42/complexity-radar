import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import { languageForExtension, type LanguageDef } from "./languages.js";

/** Directory names skipped by default (build output, deps, VCS, caches, envs). */
export const DEFAULT_IGNORE_DIRS = new Set([
  "node_modules", "dist", "build", "out", ".next", ".nuxt", "coverage",
  ".nyc_output", "vendor", "__pycache__", ".venv", "venv", "env", "bin",
  "obj", "target", ".gradle", ".cache", "tmp", ".tmp",
]);

const DEFAULT_MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MiB
const MINIFIED_LINE_THRESHOLD = 5000; // a single line this long => treat as minified

export interface DiscoveredFile {
  absPath: string;
  relPath: string;
  language: LanguageDef;
  content: string;
}

export interface WalkOptions {
  ignore?: string[];
  maxFileSize?: number;
}

/**
 * Recursively collect analysable source files under one or more roots.
 *
 * Skips default ignore directories, any dot-directory, user-supplied globs,
 * oversized files, and files that look minified.
 */
export function walk(paths: string[], root: string, options: WalkOptions = {}): DiscoveredFile[] {
  const maxSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const globs = (options.ignore ?? []).map(globToRegExp);
  const files: DiscoveredFile[] = [];
  const visited = new Set<string>();

  const isIgnoredByGlob = (relPath: string): boolean =>
    globs.some((re) => re.test(relPath));

  const visit = (absPath: string): void => {
    let stat;
    try {
      stat = statSync(absPath);
    } catch {
      return;
    }

    if (stat.isDirectory()) {
      let entries: string[];
      try {
        entries = readdirSync(absPath);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.startsWith(".")) continue; // skip dot-dirs / dot-files
        if (DEFAULT_IGNORE_DIRS.has(entry)) continue;
        const child = resolve(absPath, entry);
        const rel = toPosix(relative(root, child));
        if (rel && isIgnoredByGlob(rel)) continue;
        visit(child);
      }
      return;
    }

    if (!stat.isFile()) return;
    if (stat.size > maxSize) return;

    const language = languageForExtension(extname(absPath));
    if (!language) return;

    const relPath = toPosix(relative(root, absPath)) || absPath;
    if (isIgnoredByGlob(relPath)) return;
    if (visited.has(absPath)) return;
    visited.add(absPath);

    let content: string;
    try {
      content = readFileSync(absPath, "utf8");
    } catch {
      return;
    }
    if (looksMinified(content)) return;

    files.push({ absPath, relPath, language, content });
  };

  for (const p of paths) visit(resolve(root, p));
  files.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return files;
}

function looksMinified(content: string): boolean {
  let lineLen = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") lineLen = 0;
    else if (++lineLen > MINIFIED_LINE_THRESHOLD) return true;
  }
  return false;
}

function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}

/** Tiny glob -> RegExp supporting `*`, `**`, and `?`. Matches against posix paths. */
function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp(`(^|/)${re}(/|$)`);
}

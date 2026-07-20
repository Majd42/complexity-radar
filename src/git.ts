import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * Git churn for a set of files, keyed by absolute path. Churn is the number of
 * commits that touched a file within the configured window — the standard
 * "how often does this change?" signal that, multiplied by complexity, surfaces
 * the code most worth refactoring.
 */
export interface Churn {
  /** The `--since` window used, or `null` for the full history. */
  since: string | null;
  /** Total commits observed across every counted file. */
  total: number;
  /** Commits that touched the given absolute file path (0 if untracked/new). */
  get(absPath: string): number;
}

/** A commit hash line in `git log --format=%H` output: 40 lowercase hex chars. */
const HASH_LINE = /^[0-9a-f]{40}$/;

/**
 * Resolve the top-level directory of the git repository containing `dir`, or
 * `null` when `dir` is not inside a repo (or git is unavailable).
 */
export function gitTopLevel(dir: string): string | null {
  try {
    const out = execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const top = out.trim();
    return top === "" ? null : top;
  } catch {
    return null;
  }
}

/** Whether `dir` is inside a git repository. */
export function isGitRepo(dir: string): boolean {
  return gitTopLevel(dir) !== null;
}

/**
 * Compute per-file churn for the repository containing `root`. Returns `null`
 * when `root` is not a git repo or git cannot be invoked — callers treat that
 * as "churn unavailable" rather than an error.
 */
export function collectChurn(root: string, since: string | null = null): Churn | null {
  const repoRoot = gitTopLevel(root);
  if (!repoRoot) return null;

  const args = ["-C", root, "log", "--no-renames", "--format=%H", "--name-only"];
  if (since) args.push(`--since=${since}`);

  let output: string;
  try {
    output = execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      // Histories can be large; give git plenty of room before it's a failure.
      maxBuffer: 512 * 1024 * 1024,
    });
  } catch {
    return null;
  }

  return makeChurn(parseChurn(output, repoRoot), since);
}

/**
 * Parse `git log --format=%H --name-only` output into a commit count per file,
 * keyed by normalised absolute path. Exported for testing without a live repo.
 */
export function parseChurn(logOutput: string, repoRoot: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const raw of logOutput.split("\n")) {
    const line = raw.trim();
    // Blank separators and the per-commit hash lines carry no file to count.
    if (line === "" || HASH_LINE.test(line)) continue;
    const key = normKey(resolve(repoRoot, line));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function makeChurn(counts: Map<string, number>, since: string | null): Churn {
  let total = 0;
  for (const n of counts.values()) total += n;
  return {
    since,
    total,
    get: (absPath) => counts.get(normKey(absPath)) ?? 0,
  };
}

/**
 * Normalise an absolute path for use as a churn map key. Git prints POSIX paths
 * while the file walker yields native ones, and Windows paths are
 * case-insensitive — resolving and lower-casing on win32 reconciles both sides.
 */
function normKey(p: string): string {
  const r = resolve(p);
  return process.platform === "win32" ? r.toLowerCase() : r;
}

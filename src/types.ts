/** Severity buckets for a cyclomatic-complexity score. */
export type Severity = "low" | "moderate" | "high" | "veryHigh";

/** Metrics for a single function or method. */
export interface FunctionMetric {
  /** Function / method name as detected from the signature. */
  name: string;
  /** 1-based line where the signature begins. */
  line: number;
  /** 1-based line where the body ends. */
  endLine: number;
  /** McCabe cyclomatic complexity (1 + number of decision points). */
  complexity: number;
  /**
   * Cognitive complexity (SonarSource-style, heuristic): like cyclomatic, but
   * nesting is penalised and a `switch` counts once rather than per `case`.
   * Reads closer to how hard the function actually is to follow.
   */
  cognitive: number;
  /** Non-blank lines of code in the body. */
  loc: number;
  /** Maximum block-nesting depth inside the body. */
  maxNesting: number;
  /** Number of declared parameters. */
  params: number;
  /** Severity bucket derived from `complexity`. */
  severity: Severity;
}

/** Aggregated metrics for one source file. */
export interface FileReport {
  /** Absolute path on disk. */
  absPath: string;
  /** Path relative to the analysis root, using forward slashes. */
  relPath: string;
  /** Language id (e.g. "typescript", "python"). */
  language: string;
  /** Non-blank lines of code in the whole file. */
  loc: number;
  /** Metrics for every function detected in the file. */
  functions: FunctionMetric[];
  /** Sum of function complexities. */
  totalComplexity: number;
  /** Highest single-function complexity in the file. */
  maxComplexity: number;
  /** Mean function complexity (0 when no functions were found). */
  avgComplexity: number;
  /** Highest single-function cognitive complexity in the file. */
  maxCognitive: number;
  /**
   * Number of git commits that touched this file within the churn window, or
   * `null` when churn analysis was not run (not a git repo, or disabled).
   */
  commits: number | null;
}

/** A function metric annotated with its originating file, for ranking. */
export interface Hotspot extends FunctionMetric {
  relPath: string;
  language: string;
  /** Commits touching the originating file, or `null` when churn is unavailable. */
  commits: number | null;
  /**
   * Churn-weighted risk: `complexity × commits`. High risk means a function is
   * both complex and frequently changed — the real refactor target. `null` when
   * churn is unavailable.
   */
  risk: number | null;
}

/** Git-churn rollup, present only when churn analysis ran. */
export interface ChurnSummary {
  /** The `--since` window used (e.g. "6 months ago"), or `null` for full history. */
  since: string | null;
  /** Total commits observed across all analysed files in the window. */
  totalCommits: number;
  /**
   * Functions ranked by {@link Hotspot.risk} (complexity × churn), highest
   * first. The natural "where do I refactor first?" list.
   */
  hotspots: Hotspot[];
}

/** Per-language rollup. */
export interface LanguageSummary {
  language: string;
  files: number;
  functions: number;
  totalLoc: number;
  avgComplexity: number;
  maxComplexity: number;
}

/** The complete result of analysing a codebase. */
export interface ProjectReport {
  /** ISO-8601 timestamp of when the report was produced. */
  generatedAt: string;
  /** Absolute analysis root. */
  root: string;
  /** Per-file reports, in discovery order. */
  files: FileReport[];
  summary: {
    fileCount: number;
    functionCount: number;
    totalLoc: number;
    avgComplexity: number;
    maxComplexity: number;
    /** Mean cognitive complexity across all functions. */
    avgCognitive: number;
    /** Highest single-function cognitive complexity in the codebase. */
    maxCognitive: number;
    /** Worst offenders across the whole codebase, highest complexity first. */
    hotspots: Hotspot[];
    /** Per-language breakdown. */
    byLanguage: LanguageSummary[];
    /** Count of functions in each severity bucket. */
    severity: Record<Severity, number>;
    /** Functions whose complexity exceeds the configured threshold. */
    overThreshold: number;
    /** The threshold used, if any. */
    threshold: number | null;
    /** Git-churn rollup, or `null` when churn analysis did not run. */
    churn: ChurnSummary | null;
  };
}

/**
 * How one function changed relative to a baseline report.
 *
 * - `new` — present now, absent in the baseline.
 * - `removed` — present in the baseline, gone now.
 * - `worsened` — matched a baseline function; cyclomatic complexity went up.
 * - `improved` — matched a baseline function; cyclomatic complexity went down.
 * - `same` — matched a baseline function; cyclomatic complexity unchanged.
 */
export type DeltaStatus = "new" | "removed" | "worsened" | "improved" | "same";

/** A single function's change relative to a baseline report. */
export interface FunctionDelta {
  name: string;
  relPath: string;
  language: string;
  /** Current line (baseline line for a `removed` function). */
  line: number;
  status: DeltaStatus;
  /** Current cyclomatic complexity (0 when `removed`). */
  complexity: number;
  /** Baseline cyclomatic complexity (0 when `new`). */
  baseComplexity: number;
  /** `complexity - baseComplexity`. */
  complexityDelta: number;
  /** Current cognitive complexity (0 when `removed`). */
  cognitive: number;
  /** Baseline cognitive complexity (0 when `new`). */
  baseCognitive: number;
  /** `cognitive - baseCognitive`. */
  cognitiveDelta: number;
}

/** The result of diffing a report against a baseline. */
export interface DeltaSummary {
  /** `generatedAt` of the baseline report, or `null` when unavailable. */
  baselineGeneratedAt: string | null;
  /** Net change in summed cyclomatic complexity across all functions. */
  totalComplexityDelta: number;
  /** Count of matched functions whose complexity rose. */
  worsened: number;
  /** Count of matched functions whose complexity fell. */
  improved: number;
  /** Count of functions new since the baseline. */
  added: number;
  /** Count of functions removed since the baseline. */
  removed: number;
  /**
   * Functions that count as regressions under the gate policy: any function
   * whose complexity rose, plus new functions above the threshold (when one is
   * set). Highest complexity increase first.
   */
  regressions: FunctionDelta[];
  /** Every function whose status is not `same`, largest increase first. */
  changes: FunctionDelta[];
}

/** Options accepted by {@link analyzeProject}. */
export interface AnalyzeOptions {
  /** Extra ignore globs (in addition to the sensible defaults). */
  ignore?: string[];
  /** Max hotspots to keep in the summary. Defaults to 25. */
  top?: number;
  /** Complexity threshold used to compute `overThreshold`. */
  threshold?: number | null;
  /** Skip files larger than this many bytes (default 2 MiB). */
  maxFileSize?: number;
  /**
   * Compute git churn (commits per file) and a `complexity × churn` risk
   * ranking. Defaults to `true`, which auto-enables when the analysis root is
   * inside a git repository; set `false` to skip git entirely.
   */
  churn?: boolean;
  /**
   * Git date expression bounding the churn window (e.g. `"6 months ago"`,
   * `"2024-01-01"`). `null`/undefined means the full history. Ignored when
   * churn is disabled.
   */
  since?: string | null;
}

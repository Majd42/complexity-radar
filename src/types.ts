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
}

/** A function metric annotated with its originating file, for ranking. */
export interface Hotspot extends FunctionMetric {
  relPath: string;
  language: string;
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
  };
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
}

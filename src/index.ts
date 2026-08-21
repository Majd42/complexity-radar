import { resolve } from "node:path";
import { analyzeSource } from "./analyze.js";
import { type Churn, collectChurn } from "./git.js";
import { walk } from "./walk.js";
import type {
  AnalyzeOptions,
  ChurnSummary,
  FileReport,
  Hotspot,
  LanguageSummary,
  ProjectReport,
  Severity,
} from "./types.js";

export * from "./types.js";
export { analyzeSource, complexityOf, cognitiveOf, severityFor, SEVERITY_THRESHOLDS } from "./analyze.js";
export { renderHtml } from "./report.js";
export { renderMarkdown } from "./markdown.js";
export { diffReports } from "./delta.js";
export type { DiffOptions } from "./delta.js";
export { LANGUAGES } from "./languages.js";
export { collectChurn, isGitRepo } from "./git.js";
export { loadConfig, validateConfig, CONFIG_FILENAMES } from "./config.js";
export type { FileConfig, LoadedConfig } from "./config.js";

/**
 * Analyse one or more paths and produce a complete {@link ProjectReport}.
 *
 * @param paths Files or directories to scan. Defaults to `["."]`.
 * @param root  Base directory for relative paths. Defaults to `process.cwd()`.
 */
export function analyzeProject(
  paths: string[] = ["."],
  root: string = process.cwd(),
  options: AnalyzeOptions = {},
): ProjectReport {
  const absRoot = resolve(root);
  const top = options.top ?? 25;
  const threshold = options.threshold ?? null;

  // Churn defaults on and auto-detects a repo; collectChurn returns null when
  // `absRoot` isn't in one, so a plain directory scan just skips git silently.
  const churn: Churn | null =
    options.churn === false ? null : collectChurn(absRoot, options.since ?? null);

  const discovered = walk(paths.length ? paths : ["."], absRoot, {
    ignore: options.ignore,
    maxFileSize: options.maxFileSize,
  });

  const files: FileReport[] = [];
  for (const file of discovered) {
    const { functions, loc } = analyzeSource(file.content, file.language);
    const complexities = functions.map((f) => f.complexity);
    const totalComplexity = complexities.reduce((a, b) => a + b, 0);
    files.push({
      absPath: file.absPath,
      relPath: file.relPath,
      language: file.language.id,
      loc,
      functions,
      totalComplexity,
      maxComplexity: complexities.length ? Math.max(...complexities) : 0,
      avgComplexity: functions.length ? totalComplexity / functions.length : 0,
      maxCognitive: functions.length ? Math.max(...functions.map((f) => f.cognitive)) : 0,
      commits: churn ? churn.get(file.absPath) : null,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    root: absRoot,
    files,
    summary: buildSummary(files, top, threshold, churn),
  };
}

function buildSummary(
  files: FileReport[],
  top: number,
  threshold: number | null,
  churn: Churn | null,
): ProjectReport["summary"] {
  const severity: Record<Severity, number> = { low: 0, moderate: 0, high: 0, veryHigh: 0 };
  const byLang = new Map<string, { files: number; functions: number; loc: number; total: number; max: number }>();
  const hotspots: Hotspot[] = [];

  let functionCount = 0;
  let totalLoc = 0;
  let totalComplexity = 0;
  let maxComplexity = 0;
  let totalCognitive = 0;
  let maxCognitive = 0;
  let overThreshold = 0;

  const labelFor = (id: string) => LANGUAGE_LABELS[id] ?? id;

  for (const file of files) {
    totalLoc += file.loc;
    const lang = byLang.get(file.language) ?? { files: 0, functions: 0, loc: 0, total: 0, max: 0 };
    lang.files++;
    lang.loc += file.loc;

    for (const fn of file.functions) {
      functionCount++;
      totalComplexity += fn.complexity;
      maxComplexity = Math.max(maxComplexity, fn.complexity);
      totalCognitive += fn.cognitive;
      maxCognitive = Math.max(maxCognitive, fn.cognitive);
      severity[fn.severity]++;
      if (threshold !== null && fn.complexity > threshold) overThreshold++;

      lang.functions++;
      lang.total += fn.complexity;
      lang.max = Math.max(lang.max, fn.complexity);

      const commits = file.commits;
      const risk = commits === null ? null : fn.complexity * commits;
      hotspots.push({ ...fn, relPath: file.relPath, language: file.language, commits, risk });
    }
    byLang.set(file.language, lang);
  }

  const churnSummary = churn ? buildChurnSummary(hotspots, churn, top) : null;

  hotspots.sort((a, b) => b.complexity - a.complexity || b.loc - a.loc);

  const byLanguage: LanguageSummary[] = [...byLang.entries()]
    .map(([id, v]) => ({
      language: labelFor(id),
      files: v.files,
      functions: v.functions,
      totalLoc: v.loc,
      avgComplexity: v.functions ? v.total / v.functions : 0,
      maxComplexity: v.max,
    }))
    .sort((a, b) => b.maxComplexity - a.maxComplexity);

  return {
    fileCount: files.length,
    functionCount,
    totalLoc,
    avgComplexity: functionCount ? totalComplexity / functionCount : 0,
    maxComplexity,
    avgCognitive: functionCount ? totalCognitive / functionCount : 0,
    maxCognitive,
    hotspots: hotspots.slice(0, top),
    byLanguage,
    severity,
    overThreshold,
    threshold,
    churn: churnSummary,
  };
}

/**
 * Rank hotspots by `complexity × churn` risk. Ties break on raw complexity so a
 * complex function edges out an equally-churned simpler one. Functions in files
 * with no commits (risk 0) are dropped — they carry no churn signal.
 */
function buildChurnSummary(hotspots: Hotspot[], churn: Churn, top: number): ChurnSummary {
  const ranked = hotspots
    .filter((h) => (h.risk ?? 0) > 0)
    .sort((a, b) => (b.risk ?? 0) - (a.risk ?? 0) || b.complexity - a.complexity)
    .slice(0, top);
  return { since: churn.since, totalCommits: churn.total, hotspots: ranked };
}

const LANGUAGE_LABELS: Record<string, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  python: "Python",
  go: "Go",
  java: "Java",
  csharp: "C#",
};

#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "./index.js";
import { renderHtml } from "./report.js";
import { renderMarkdown } from "./markdown.js";
import { diffReports } from "./delta.js";
import { type LoadedConfig, loadConfig } from "./config.js";
import type { DeltaSummary, ProjectReport, Severity } from "./types.js";

/** Fully-resolved options after merging defaults, config file, and CLI flags. */
interface CliOptions {
  paths: string[];
  output: string;
  json: string | null;
  markdown: string | null;
  threshold: number | null;
  top: number;
  ignore: string[];
  quiet: boolean;
  churn: boolean;
  since: string | null;
  baseline: string | null;
  failOnRegression: boolean;
}

/**
 * Only the flags the user actually passed. Kept separate from {@link CliOptions}
 * so a config file can supply anything the command line left unset — an omitted
 * flag is `undefined` here, not a default that would clobber the config.
 */
interface CliArgs {
  paths: string[];
  output?: string;
  json?: string;
  markdown?: string;
  threshold?: number;
  top?: number;
  ignore: string[];
  quiet?: boolean;
  churn?: boolean; // set to `false` only by --no-churn
  since?: string;
  baseline?: string;
  failOnRegression?: boolean;
  config?: string;
  noConfig?: boolean;
}

const HELP = `complexity-radar — cyclomatic complexity & tech-debt dashboard

Usage:
  complexity-radar [paths...] [options]

Arguments:
  paths                 Files or directories to scan (default: current directory)

Options:
  -o, --output <file>   HTML report path (default: complexity-report.html)
  -j, --json <file>     Also write the raw report as JSON
  -m, --markdown <file> Also write a Markdown summary (great for PR/CI comments)
  -t, --threshold <n>   Exit with code 1 if any function exceeds complexity n
      --top <n>         Number of hot spots to include (default: 25)
  -i, --ignore <glob>   Extra ignore glob (repeatable, comma-separated)
      --since <when>    Git date bounding the churn window (e.g. "6 months ago")
      --no-churn        Skip git churn analysis (complexity × change frequency)
  -b, --baseline <file> Compare against an earlier --json report and show the delta
      --fail-on-regression  Exit 1 if any function got more complex vs the baseline
  -c, --config <file>   Load settings from a config file (default: auto-discover)
      --no-config       Ignore any config file and use defaults + flags only
  -q, --quiet           Only print the summary line
  -h, --help            Show this help
  -v, --version         Show version

Config file:
  Settings can live in complexity-radar.json (or .complexity-radar.json, or a
  "complexity-radar" key in package.json), discovered by walking up from the
  current directory. Every flag above has a matching field. Command-line flags
  win over the file; --ignore globs from both are combined.

Examples:
  complexity-radar
  complexity-radar src -o report.html --top 40
  complexity-radar . --threshold 15 --ignore "**/*.test.ts,**/generated/**"
  complexity-radar . --since "6 months ago"      # recent-churn risk ranking
  complexity-radar src -m summary.md             # Markdown for a PR comment
  complexity-radar . --json base.json            # on main: save a baseline
  complexity-radar . -b base.json --fail-on-regression   # on a PR: gate on it
  complexity-radar --config .complexity-radar.json       # explicit config file
`;

function parseArgs(argv: string[]): CliArgs | { help: true } | { version: true } {
  const args: CliArgs = { paths: [], ignore: [] };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`Option ${arg} requires a value`);
      return v;
    };
    switch (arg) {
      case "-h": case "--help": return { help: true };
      case "-v": case "--version": return { version: true };
      case "-o": case "--output": args.output = next(); break;
      case "-j": case "--json": args.json = next(); break;
      case "-m": case "--markdown": args.markdown = next(); break;
      case "-t": case "--threshold": args.threshold = parseIntOrFail(next(), arg); break;
      case "--top": args.top = parseIntOrFail(next(), arg); break;
      case "-i": case "--ignore":
        args.ignore.push(...next().split(",").map((s) => s.trim()).filter(Boolean));
        break;
      case "--since": args.since = next(); break;
      case "--no-churn": args.churn = false; break;
      case "-b": case "--baseline": args.baseline = next(); break;
      case "--fail-on-regression": args.failOnRegression = true; break;
      case "-c": case "--config": args.config = next(); break;
      case "--no-config": args.noConfig = true; break;
      case "-q": case "--quiet": args.quiet = true; break;
      default:
        if (arg.startsWith("-")) fail(`Unknown option: ${arg}`);
        args.paths.push(arg);
    }
  }

  return args;
}

/**
 * Merge defaults, the config file, and CLI flags into the final options.
 * Precedence: a CLI flag beats the config file, which beats the built-in
 * default. `ignore` is the exception — config globs and CLI globs are combined.
 * Path-like values taken from the config are resolved against the config file's
 * directory so they hold no matter which sub-directory the tool runs from.
 */
function resolveOptions(args: CliArgs, loaded: LoadedConfig | null): CliOptions {
  const c = loaded?.config ?? {};
  const dir = loaded?.dir ?? process.cwd();
  // Resolve a config-supplied path against the config's own directory.
  const cfgPath = (v: string | null | undefined): string | null =>
    v == null ? null : resolve(dir, v);

  const cliPaths = args.paths.length ? args.paths : null;
  const cfgPaths = c.paths && c.paths.length ? c.paths.map((p) => resolve(dir, p)) : null;

  return {
    paths: cliPaths ?? cfgPaths ?? ["."],
    output: args.output ?? cfgPath(c.output) ?? "complexity-report.html",
    json: args.json ?? cfgPath(c.json),
    markdown: args.markdown ?? cfgPath(c.markdown),
    threshold: args.threshold ?? c.threshold ?? null,
    top: args.top ?? c.top ?? 25,
    // Ignore globs are additive: everything the config lists plus the CLI's.
    ignore: [...(c.ignore ?? []), ...args.ignore],
    quiet: args.quiet ?? c.quiet ?? false,
    churn: args.churn ?? c.churn ?? true,
    since: args.since ?? c.since ?? null,
    baseline: args.baseline ?? cfgPath(c.baseline),
    failOnRegression: args.failOnRegression ?? c.failOnRegression ?? false,
  };
}

function parseIntOrFail(value: string, flag: string): number {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) fail(`${flag} expects an integer, got "${value}"`);
  return n;
}

function fail(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  process.exit(2);
}

function getVersion(): string {
  // Read from the packaged package.json so `--version` never drifts out of sync
  // with the published release. cli.js lives in dist/, so package.json is one
  // level up.
  try {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    if (typeof pkg.version === "string") return pkg.version;
  } catch {
    // Fall through to the unknown marker below.
  }
  return "0.0.0-unknown";
}

function main(): void {
  const parsed = parseArgs(process.argv.slice(2));
  if ("help" in parsed) {
    process.stdout.write(HELP);
    return;
  }
  if ("version" in parsed) {
    process.stdout.write(getVersion() + "\n");
    return;
  }

  let loaded: LoadedConfig | null = null;
  if (!parsed.noConfig) {
    try {
      loaded = loadConfig(process.cwd(), parsed.config);
    } catch (err) {
      fail((err as Error).message);
    }
  }

  const opts = resolveOptions(parsed, loaded);
  if (loaded && !opts.quiet) {
    process.stdout.write(`Using config ${relative(process.cwd(), loaded.path) || loaded.path}\n`);
  }
  const started = Date.now();
  const report = analyzeProject(opts.paths, process.cwd(), {
    ignore: opts.ignore,
    top: opts.top,
    threshold: opts.threshold,
    churn: opts.churn,
    since: opts.since,
  });

  const delta = opts.baseline ? diffAgainstBaseline(report, opts) : null;

  const outPath = resolve(process.cwd(), opts.output);
  writeFileSync(outPath, renderHtml(report), "utf8");
  if (opts.json) {
    writeFileSync(resolve(process.cwd(), opts.json), JSON.stringify(report, null, 2), "utf8");
  }
  if (opts.markdown) {
    writeFileSync(resolve(process.cwd(), opts.markdown), renderMarkdown(report, delta), "utf8");
  }

  if (!opts.quiet) printSummary(report, started);
  if (!opts.quiet && delta) printDelta(delta);
  process.stdout.write(`Report written to ${outPath}\n`);

  let failed = false;
  if (opts.threshold !== null && report.summary.overThreshold > 0) {
    process.stderr.write(
      `\n${report.summary.overThreshold} function(s) exceed the complexity threshold of ${opts.threshold}.\n`,
    );
    failed = true;
  }
  if (opts.failOnRegression && delta && delta.regressions.length > 0) {
    process.stderr.write(
      `\n${delta.regressions.length} function(s) regressed against the baseline.\n`,
    );
    failed = true;
  }
  if (failed) process.exit(1);
}

/** Load the baseline JSON report and diff the current report against it. */
function diffAgainstBaseline(report: ProjectReport, opts: CliOptions): DeltaSummary {
  const path = resolve(process.cwd(), opts.baseline!);
  let baseline: ProjectReport;
  try {
    baseline = JSON.parse(readFileSync(path, "utf8")) as ProjectReport;
  } catch (err) {
    fail(`could not read baseline "${opts.baseline}": ${(err as Error).message}`);
  }
  if (!Array.isArray(baseline.files)) {
    fail(`baseline "${opts.baseline}" is not a complexity-radar JSON report (no "files" array)`);
  }
  return diffReports(report, baseline, { threshold: opts.threshold });
}

function printSummary(report: ProjectReport, started: number): void {
  const s = report.summary;
  const ms = Date.now() - started;
  const out = process.stdout;

  out.write(`\nComplexity Radar\n`);
  out.write(`  Scanned ${s.fileCount} file(s), ${s.functionCount} function(s), ${fmt(s.totalLoc)} LOC in ${ms}ms\n`);
  out.write(`  Avg complexity ${s.avgComplexity.toFixed(1)} · Max ${s.maxComplexity}\n`);
  out.write(`  Avg cognitive ${s.avgCognitive.toFixed(1)} · Max ${s.maxCognitive}\n`);
  out.write(
    `  Severity: ${paint("low", s.severity.low)} low · ` +
    `${paint("moderate", s.severity.moderate)} moderate · ` +
    `${paint("high", s.severity.high)} high · ` +
    `${paint("veryHigh", s.severity.veryHigh)} very high\n`,
  );

  if (s.hotspots.length > 0) {
    out.write(`\n  Top hot spots:\n`);
    for (const h of s.hotspots.slice(0, 10)) {
      out.write(
        `    ${paint(h.severity, String(h.complexity).padStart(3))}  ` +
        `${h.relPath}:${h.line} ${dim(h.name)}\n`,
      );
    }
  }

  if (s.churn && s.churn.hotspots.length > 0) {
    const window = s.churn.since ? `since ${s.churn.since}` : "full history";
    out.write(`\n  Top risk (complexity × churn, ${window}):\n`);
    for (const h of s.churn.hotspots.slice(0, 10)) {
      out.write(
        `    ${paint(h.severity, String(h.risk ?? 0).padStart(4))}  ` +
        `${dim(`c${h.complexity}×${h.commits}`)}  ` +
        `${h.relPath}:${h.line} ${dim(h.name)}\n`,
      );
    }
  }
  out.write("\n");
}

function printDelta(delta: DeltaSummary): void {
  const out = process.stdout;
  const net = delta.totalComplexityDelta;
  const netStr = net > 0 ? red(`+${net}`) : net < 0 ? green(String(net)) : "0";

  out.write(`\n  Baseline comparison`);
  out.write(delta.baselineGeneratedAt ? dim(` (${delta.baselineGeneratedAt})`) : "");
  out.write(`\n`);
  out.write(
    `    Δ total complexity ${netStr} · ` +
    `${red(String(delta.worsened))} worse · ${green(String(delta.improved))} better · ` +
    `${delta.added} new · ${delta.removed} removed\n`,
  );

  if (delta.regressions.length > 0) {
    out.write(`\n  ${red(`Regressions (${delta.regressions.length}):`)}\n`);
    for (const d of delta.regressions.slice(0, 10)) {
      const change = d.status === "new"
        ? `new c${d.complexity}`
        : `c${d.baseComplexity}→${d.complexity}`;
      out.write(
        `    ${red(`+${d.complexityDelta}`.padStart(4))}  ` +
        `${dim(change.padEnd(12))}  ${d.relPath}:${d.line} ${dim(d.name)}\n`,
      );
    }
  } else {
    out.write(`    ${green("No regressions.")}\n`);
  }
  out.write("\n");
}

const COLORS: Record<Severity, string> = {
  low: "\x1b[32m",
  moderate: "\x1b[33m",
  high: "\x1b[35m",
  veryHigh: "\x1b[31m",
};
const RESET = "\x1b[0m";
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

function paint(sev: Severity, value: string | number): string {
  return useColor ? `${COLORS[sev]}${value}${RESET}` : String(value);
}
function dim(value: string): string {
  return useColor ? `\x1b[2m${value}${RESET}` : value;
}
function red(value: string): string {
  return useColor ? `\x1b[31m${value}${RESET}` : value;
}
function green(value: string): string {
  return useColor ? `\x1b[32m${value}${RESET}` : value;
}
function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

main();

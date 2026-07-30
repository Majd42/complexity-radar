#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "./index.js";
import { renderHtml } from "./report.js";
import { renderMarkdown } from "./markdown.js";
import type { ProjectReport, Severity } from "./types.js";

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
  -q, --quiet           Only print the summary line
  -h, --help            Show this help
  -v, --version         Show version

Examples:
  complexity-radar
  complexity-radar src -o report.html --top 40
  complexity-radar . --threshold 15 --ignore "**/*.test.ts,**/generated/**"
  complexity-radar . --since "6 months ago"      # recent-churn risk ranking
  complexity-radar src -m summary.md             # Markdown for a PR comment
`;

function parseArgs(argv: string[]): CliOptions | { help: true } | { version: true } {
  const opts: CliOptions = {
    paths: [],
    output: "complexity-report.html",
    json: null,
    markdown: null,
    threshold: null,
    top: 25,
    ignore: [],
    quiet: false,
    churn: true,
    since: null,
  };

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
      case "-o": case "--output": opts.output = next(); break;
      case "-j": case "--json": opts.json = next(); break;
      case "-m": case "--markdown": opts.markdown = next(); break;
      case "-t": case "--threshold": opts.threshold = parseIntOrFail(next(), arg); break;
      case "--top": opts.top = parseIntOrFail(next(), arg); break;
      case "-i": case "--ignore":
        opts.ignore.push(...next().split(",").map((s) => s.trim()).filter(Boolean));
        break;
      case "--since": opts.since = next(); break;
      case "--no-churn": opts.churn = false; break;
      case "-q": case "--quiet": opts.quiet = true; break;
      default:
        if (arg.startsWith("-")) fail(`Unknown option: ${arg}`);
        opts.paths.push(arg);
    }
  }

  if (opts.paths.length === 0) opts.paths.push(".");
  return opts;
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

  const opts = parsed;
  const started = Date.now();
  const report = analyzeProject(opts.paths, process.cwd(), {
    ignore: opts.ignore,
    top: opts.top,
    threshold: opts.threshold,
    churn: opts.churn,
    since: opts.since,
  });

  const outPath = resolve(process.cwd(), opts.output);
  writeFileSync(outPath, renderHtml(report), "utf8");
  if (opts.json) {
    writeFileSync(resolve(process.cwd(), opts.json), JSON.stringify(report, null, 2), "utf8");
  }
  if (opts.markdown) {
    writeFileSync(resolve(process.cwd(), opts.markdown), renderMarkdown(report), "utf8");
  }

  if (!opts.quiet) printSummary(report, started);
  process.stdout.write(`Report written to ${outPath}\n`);

  if (opts.threshold !== null && report.summary.overThreshold > 0) {
    process.stderr.write(
      `\n${report.summary.overThreshold} function(s) exceed the complexity threshold of ${opts.threshold}.\n`,
    );
    process.exit(1);
  }
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
function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

main();

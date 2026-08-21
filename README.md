# Complexity Radar ◎

A zero-dependency **complexity & tech-debt dashboard**. Point it at a codebase
and it walks the tree, scores every function for both **cyclomatic** and
**cognitive** complexity, and writes a single self-contained HTML report
highlighting the hot spots per file and method.

Supports **JavaScript, TypeScript, Python, Go, Java, C#, Rust, and Ruby** out of the
box, and runs anywhere Node ≥ 18 does — no compiler toolchains, no language
servers.

![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)

## Why

**Cyclomatic complexity** (McCabe, 1976) counts the number of independent paths
through a function — essentially `1 + the number of decision points` (`if`,
`for`, `while`, `case`, `catch`, `&&`, `||`, ternaries, …). High numbers
correlate with code that is hard to test and bug-prone.

**Cognitive complexity** (SonarSource) measures how hard the code is to *follow*.
It builds on the same signals but **penalises nesting** — a branch three levels
deep costs more than a flat one — counts a `switch` once instead of once per
`case`, and collapses `a && b && c` into a single increment. The two metrics
often disagree, and that disagreement is informative: a flat function stuffed
with boolean operators can have a high cyclomatic score yet be easy to read,
while a modestly-branchy but deeply-nested function is the real refactor target.

Complexity Radar reports both side by side so you know where to aim a refactor.

**Git churn × complexity.** A complex function nobody touches is rarely worth
the risk of a refactor; a complex function that changes every week is where bugs
actually breed. When run inside a git repository, Complexity Radar counts how
many commits have touched each file and ranks functions by a **risk score of
`complexity × churn`** — the classic hotspot signal. This surfaces the code that
is both hard to change *and* changed often, which is where refactoring pays off
first. Churn is on by default; use `--no-churn` to skip it or `--since` to bound
the window (e.g. only the last few months of activity).

## Install

```bash
# Run without installing
npx complexity-radar

# Or install globally
npm install -g complexity-radar
```

Or clone and build from source:

```bash
git clone https://github.com/Majd42/complexity-radar.git
cd complexity-radar
npm install
npm run build
node dist/cli.js --help
```

## Usage

```bash
# Scan the current directory, write complexity-report.html
complexity-radar

# Scan specific folders, keep the 40 worst functions
complexity-radar src lib -o report.html --top 40

# Fail CI if any function's complexity exceeds 15
complexity-radar . --threshold 15

# Ignore extra paths and also emit raw JSON
complexity-radar . --ignore "**/*.test.ts,**/generated/**" --json report.json

# Write a Markdown summary to drop into a pull request or CI comment
complexity-radar src --markdown summary.md

# Gate a PR on *regressions*: save a baseline on main, compare against it
complexity-radar . --json baseline.json                 # on main
complexity-radar . --baseline baseline.json --fail-on-regression   # on the PR

# Commit your settings once in complexity-radar.json, then just run:
complexity-radar
```

### Options

| Flag | Description |
| --- | --- |
| `-o, --output <file>` | HTML report path (default `complexity-report.html`) |
| `-j, --json <file>` | Also write the raw report as JSON |
| `-m, --markdown <file>` | Also write a Markdown summary — ideal for PR/CI comments |
| `-t, --threshold <n>` | Exit with code `1` if any function exceeds complexity `n` (CI gate) |
| `--top <n>` | Number of hot spots to include (default `25`) |
| `-i, --ignore <glob>` | Extra ignore glob, repeatable or comma-separated |
| `--since <when>` | Git date bounding the churn window (e.g. `"6 months ago"`, `2024-01-01`) |
| `--no-churn` | Skip git churn analysis (the `complexity × churn` risk ranking) |
| `-b, --baseline <file>` | Compare against an earlier `--json` report and show the per-function delta |
| `--fail-on-regression` | Exit with code `1` if any function got more complex vs the baseline (CI gate) |
| `-c, --config <file>` | Load settings from a config file (default: auto-discover, see below) |
| `--no-config` | Ignore any config file; use built-in defaults plus flags only |
| `-q, --quiet` | Only print the summary line |
| `-h, --help` / `-v, --version` | Help / version |

Build directories (`node_modules`, `dist`, `target`, `__pycache__`, …),
dot-directories, oversized files, and minified files are skipped automatically.

### Configuration file

Rather than repeating flags in every CI job, commit them once. Complexity Radar
looks for a **`complexity-radar.json`** (or `.complexity-radar.json`, or a
`"complexity-radar"` key in `package.json`), discovered by walking up from the
current directory — so it works from any sub-folder of the repo. Every flag has
a matching field:

```json
{
  "paths": ["src", "lib"],
  "ignore": ["**/*.test.ts", "**/generated/**"],
  "threshold": 15,
  "top": 40,
  "since": "6 months ago",
  "output": "reports/complexity.html"
}
```

**Command-line flags win over the file**, so a committed config sets the team
default and any run can still override it (`complexity-radar --top 10`). The one
exception is `--ignore`: CLI globs are *added* to the config's rather than
replacing them. Path-like values (`paths`, `output`, `json`, `markdown`,
`baseline`) resolve relative to the config file's own directory. Pass
`--no-config` to ignore any file and run on defaults, or `--config <file>` to
point at an explicit one. A `$schema` key is allowed (for editor autocomplete)
and unknown keys warn but don't fail.

## The report

The generated HTML is fully self-contained (inline CSS/JS, no network requests),
theme-aware (light/dark), and includes:

- **Summary cards** — files, functions, lines of code, average & max complexity,
  max cognitive complexity, and (in a git repo) the top risk score.
- **Severity distribution** — how many functions fall into each risk band.
- **Risk hot spots** — when run in a git repo, functions ranked by
  `complexity × churn`: the ones both complex and frequently changed.
- **Hot spots** — the worst functions, sortable and filterable, with file/line
  links and both complexity metrics side by side.
- **By language** — a per-language rollup.
- **Files** — collapsible per-file breakdowns of every function.

Pass `--markdown <file>` to also emit a plain-text Markdown summary (headline
metrics, severity, hot spots, and the risk ranking) — the format you paste
straight into a pull request or CI comment. Combine it with `--threshold` to
gate CI and post the results in one run.

### Baseline comparison & regression gating

An absolute `--threshold` is a blunt gate: on a legacy codebase it's either
always red or set so high it never fires. What you usually want to block in a
pull request is a **regression** — code that got *worse* — not the debt that was
already there. That's what `--baseline` is for.

Save a baseline from your main branch's `--json` output, then compare a branch
against it:

```bash
# On main (e.g. a scheduled job or a push to main):
complexity-radar . --json baseline.json

# On a pull request:
complexity-radar . --baseline baseline.json --markdown delta.md --fail-on-regression
```

Functions are matched across the two runs by file path and name (a function
that merely moved down the file reads as unchanged), and each is classified as
**worsened**, **improved**, **new**, or **removed**. `--fail-on-regression`
exits `1` when any function's cyclomatic complexity rose — or, if you also pass
`--threshold`, when a *new* function lands above it. The `--markdown` output
gains a **Baseline comparison** section (`c8 → c12 (+4)` per function) that
reads naturally as a PR comment. Pair it with the `--json` you already emit and
one run both gates the merge and posts the diff.

### Severity bands

| Band | Complexity | Meaning |
| --- | --- | --- |
| 🟢 Low | ≤ 10 | Simple, easy to test |
| 🟡 Moderate | 11–20 | Getting complex, watch it |
| 🟠 High | 21–40 | Hard to test, refactor candidate |
| 🔴 Very high | ≥ 41 | Unmaintainable, split it up |

The same bands colour the cognitive-complexity badges. Cognitive scores tend to
run a little lower than cyclomatic on flat code and higher on deeply-nested code.

## Programmatic API

```ts
import { analyzeProject, renderHtml } from "complexity-radar";
import { writeFileSync } from "node:fs";

const report = analyzeProject(["src"], process.cwd(), { threshold: 15 });

console.log(report.summary.avgComplexity, report.summary.avgCognitive);
for (const hot of report.summary.hotspots) {
  console.log(`${hot.complexity}\t${hot.cognitive}\t${hot.relPath}:${hot.line} ${hot.name}`);
}

// When run inside a git repo, `summary.churn` ranks functions by risk = complexity × churn.
for (const hot of report.summary.churn?.hotspots ?? []) {
  console.log(`risk ${hot.risk}\t${hot.commits} commits\t${hot.relPath}:${hot.line} ${hot.name}`);
}

writeFileSync("report.html", renderHtml(report));
```

`diffReports(current, baseline)` compares two reports and returns the
per-function delta (worsened / improved / new / removed) plus the list of
regressions — the same data behind `--baseline` and `--fail-on-regression`:

```ts
import { analyzeProject, diffReports } from "complexity-radar";
import { readFileSync } from "node:fs";

const baseline = JSON.parse(readFileSync("baseline.json", "utf8"));
const current = analyzeProject(["src"], process.cwd());
const delta = diffReports(current, baseline, { threshold: 15 });

if (delta.regressions.length > 0) {
  for (const r of delta.regressions) {
    console.log(`${r.relPath}:${r.line} ${r.name}  ${r.baseComplexity}→${r.complexity}`);
  }
  process.exitCode = 1;
}
```

## How it works (and its limits)

Complexity Radar is intentionally **parser-free**. For each file it:

1. Blanks out comments and string literals while preserving character offsets.
2. Finds function signatures with per-language regexes.
3. Isolates each body by bracket-matching (`{…}`) or, for Python, by indentation.
4. Counts decision points in the body to produce the McCabe score, walks the
   body tracking nesting (via braces or indentation) for the cognitive score,
   and records lines of code, nesting depth, and parameter count.

Churn is measured separately by shelling out to `git log --name-only` and
counting the commits that touched each file (bounded by `--since` when given);
outside a git repo, or with `--no-churn`, that step is skipped and the risk
ranking is simply omitted. Churn is per **file**, so every function in a file
inherits that file's change frequency.

This keeps the tool a single tiny package that works across many languages, but
it is a **heuristic**, not a compiler. Detection is reliable for JS/TS, Python,
Go, and Rust; Java, C# and Ruby extraction is best-effort. For Rust, `match`
arms are counted as branches, the `?` try operator is (correctly) not, and
lifetimes (`'a`) and loop labels (`'outer:`) are distinguished from char
literals. For Ruby, bodies are matched from `def` to their balancing `end`
(so trailing modifiers like `return x if y` don't nest), `case`/`when` scores
per branch, parenless params and one-line "endless" methods (`def f(x) = …`)
are handled, and `?` is *not* treated as a ternary so predicate methods
(`empty?`, `nil?`) aren't miscounted. Treat the scores as directional
signals for where to look, not as exact ground truth. Expression-bodied arrows
are supported; deeply unusual constructs (e.g. object-literal TS return types)
may occasionally be mis-attributed.

## Development

```bash
npm install
npm test          # run the test suite (node:test, no extra runners)
npm run build     # compile TypeScript to dist/
npm run dev -- src --top 20   # run the CLI from source via tsx
```

## License

[MIT](LICENSE) © Majd Shaheen

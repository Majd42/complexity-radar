# Complexity Radar ◎

A zero-dependency **complexity & tech-debt dashboard**. Point it at a codebase
and it walks the tree, scores every function for both **cyclomatic** and
**cognitive** complexity, and writes a single self-contained HTML report
highlighting the hot spots per file and method.

Supports **JavaScript, TypeScript, Python, Go, Java, and C#** out of the box, and
runs anywhere Node ≥ 18 does — no compiler toolchains, no language servers.

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
```

### Options

| Flag | Description |
| --- | --- |
| `-o, --output <file>` | HTML report path (default `complexity-report.html`) |
| `-j, --json <file>` | Also write the raw report as JSON |
| `-t, --threshold <n>` | Exit with code `1` if any function exceeds complexity `n` (CI gate) |
| `--top <n>` | Number of hot spots to include (default `25`) |
| `-i, --ignore <glob>` | Extra ignore glob, repeatable or comma-separated |
| `-q, --quiet` | Only print the summary line |
| `-h, --help` / `-v, --version` | Help / version |

Build directories (`node_modules`, `dist`, `target`, `__pycache__`, …),
dot-directories, oversized files, and minified files are skipped automatically.

## The report

The generated HTML is fully self-contained (inline CSS/JS, no network requests),
theme-aware (light/dark), and includes:

- **Summary cards** — files, functions, lines of code, average & max complexity,
  and max cognitive complexity.
- **Severity distribution** — how many functions fall into each risk band.
- **Hot spots** — the worst functions, sortable and filterable, with file/line
  links and both complexity metrics side by side.
- **By language** — a per-language rollup.
- **Files** — collapsible per-file breakdowns of every function.

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

writeFileSync("report.html", renderHtml(report));
```

## How it works (and its limits)

Complexity Radar is intentionally **parser-free**. For each file it:

1. Blanks out comments and string literals while preserving character offsets.
2. Finds function signatures with per-language regexes.
3. Isolates each body by bracket-matching (`{…}`) or, for Python, by indentation.
4. Counts decision points in the body to produce the McCabe score, walks the
   body tracking nesting (via braces or indentation) for the cognitive score,
   and records lines of code, nesting depth, and parameter count.

This keeps the tool a single tiny package that works across many languages, but
it is a **heuristic**, not a compiler. Detection is reliable for JS/TS, Python,
and Go; Java and C# extraction is best-effort. Treat the scores as directional
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

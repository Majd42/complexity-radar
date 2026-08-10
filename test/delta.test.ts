import assert from "node:assert/strict";
import { test } from "node:test";
import { diffReports } from "../src/delta.js";
import { renderMarkdown } from "../src/markdown.js";
import type {
  FileReport,
  FunctionMetric,
  ProjectReport,
} from "../src/types.js";

function fn(over: Partial<FunctionMetric> = {}): FunctionMetric {
  return {
    name: "f",
    line: 1,
    endLine: 10,
    complexity: 5,
    cognitive: 6,
    loc: 8,
    maxNesting: 2,
    params: 1,
    severity: "low",
    ...over,
  };
}

function file(relPath: string, functions: FunctionMetric[]): FileReport {
  return {
    absPath: "/repo/" + relPath,
    relPath,
    language: "typescript",
    loc: 100,
    functions,
    totalComplexity: functions.reduce((a, b) => a + b.complexity, 0),
    maxComplexity: Math.max(0, ...functions.map((f) => f.complexity)),
    avgComplexity: 0,
    maxCognitive: Math.max(0, ...functions.map((f) => f.cognitive)),
    commits: null,
  };
}

function report(files: FileReport[], generatedAt = "2026-08-01T00:00:00.000Z"): ProjectReport {
  return {
    generatedAt,
    root: "/repo",
    files,
    // The summary is not read by diffReports; a minimal stub keeps the test focused.
    summary: {} as ProjectReport["summary"],
  };
}

test("a function whose complexity rose is a worsened regression", () => {
  const base = report([file("a.ts", [fn({ name: "g", complexity: 8, cognitive: 9 })])]);
  const cur = report([file("a.ts", [fn({ name: "g", complexity: 12, cognitive: 15 })])]);

  const d = diffReports(cur, base);
  assert.equal(d.worsened, 1);
  assert.equal(d.regressions.length, 1);
  const r = d.regressions[0]!;
  assert.equal(r.status, "worsened");
  assert.equal(r.baseComplexity, 8);
  assert.equal(r.complexity, 12);
  assert.equal(r.complexityDelta, 4);
  assert.equal(r.cognitiveDelta, 6);
  assert.equal(d.totalComplexityDelta, 4);
});

test("a function whose complexity fell is an improvement, not a regression", () => {
  const base = report([file("a.ts", [fn({ name: "g", complexity: 12 })])]);
  const cur = report([file("a.ts", [fn({ name: "g", complexity: 7 })])]);

  const d = diffReports(cur, base);
  assert.equal(d.improved, 1);
  assert.equal(d.worsened, 0);
  assert.equal(d.regressions.length, 0);
  assert.equal(d.totalComplexityDelta, -5);
  assert.equal(d.changes[0]!.status, "improved");
});

test("new and removed functions are counted and never falsely matched", () => {
  const base = report([file("a.ts", [fn({ name: "gone", complexity: 4 })])]);
  const cur = report([file("a.ts", [fn({ name: "fresh", complexity: 9 })])]);

  const d = diffReports(cur, base);
  assert.equal(d.added, 1);
  assert.equal(d.removed, 1);
  assert.equal(d.worsened, 0);
  const added = d.changes.find((c) => c.status === "new")!;
  const gone = d.changes.find((c) => c.status === "removed")!;
  assert.equal(added.baseComplexity, 0);
  assert.equal(gone.complexity, 0);
  assert.equal(gone.baseComplexity, 4);
});

test("a new function counts as a regression only above the threshold", () => {
  const base = report([file("a.ts", [])]);
  const cur = report([file("a.ts", [fn({ name: "big", complexity: 20 })])]);

  assert.equal(diffReports(cur, base).regressions.length, 0);
  assert.equal(diffReports(cur, base, { threshold: 15 }).regressions.length, 1);
  assert.equal(diffReports(cur, base, { threshold: 25 }).regressions.length, 0);
});

test("a function that only moved lines reads as unchanged", () => {
  const base = report([file("a.ts", [fn({ name: "g", line: 3, complexity: 6 })])]);
  const cur = report([file("a.ts", [fn({ name: "g", line: 40, complexity: 6 })])]);

  const d = diffReports(cur, base);
  assert.equal(d.worsened, 0);
  assert.equal(d.improved, 0);
  assert.equal(d.changes.length, 0);
});

test("same-named functions in a file are paired in line order", () => {
  const base = report([
    file("a.ts", [
      fn({ name: "h", line: 1, complexity: 3 }),
      fn({ name: "h", line: 20, complexity: 5 }),
    ]),
  ]);
  const cur = report([
    file("a.ts", [
      fn({ name: "h", line: 1, complexity: 4 }), // +1
      fn({ name: "h", line: 20, complexity: 5 }), // same
    ]),
  ]);

  const d = diffReports(cur, base);
  assert.equal(d.worsened, 1);
  assert.equal(d.changes.length, 1);
  assert.equal(d.changes[0]!.complexityDelta, 1);
});

test("changes are sorted with the largest increase first", () => {
  const base = report([
    file("a.ts", [fn({ name: "a", complexity: 5 }), fn({ name: "b", complexity: 5 })]),
  ]);
  const cur = report([
    file("a.ts", [fn({ name: "a", complexity: 6 }), fn({ name: "b", complexity: 15 })]),
  ]);

  const d = diffReports(cur, base);
  assert.deepEqual(d.changes.map((c) => c.name), ["b", "a"]);
});

test("renderMarkdown prepends a baseline comparison with a verdict", () => {
  const base = report([file("a.ts", [fn({ name: "g", complexity: 8 })])]);
  const cur = report([file("a.ts", [fn({ name: "g", complexity: 12 })])]);
  const cur2 = { ...cur, summary: markdownableSummary() };

  const md = renderMarkdown(cur2, diffReports(cur, base));
  assert.match(md, /## Baseline comparison/);
  assert.match(md, /⚠️ \*\*1 regression\(s\)\*\*/);
  assert.match(md, /8 → 12 \(\+4\)/);
});

/** A summary with just enough shape for renderMarkdown to run. */
function markdownableSummary(): ProjectReport["summary"] {
  return {
    fileCount: 1,
    functionCount: 1,
    totalLoc: 100,
    avgComplexity: 12,
    maxComplexity: 12,
    avgCognitive: 6,
    maxCognitive: 6,
    hotspots: [],
    byLanguage: [],
    severity: { low: 0, moderate: 1, high: 0, veryHigh: 0 },
    overThreshold: 0,
    threshold: null,
    churn: null,
  };
}

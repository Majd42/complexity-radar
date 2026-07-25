import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMarkdown } from "../src/markdown.js";
import type { Hotspot, ProjectReport } from "../src/types.js";

function hotspot(over: Partial<Hotspot> = {}): Hotspot {
  return {
    name: "handle",
    line: 12,
    endLine: 40,
    complexity: 18,
    cognitive: 25,
    loc: 30,
    maxNesting: 4,
    params: 3,
    severity: "high",
    relPath: "src/server.ts",
    language: "typescript",
    commits: null,
    risk: null,
    ...over,
  };
}

function report(over: Partial<ProjectReport["summary"]> = {}): ProjectReport {
  return {
    generatedAt: "2026-07-25T00:00:00.000Z",
    root: "/repo",
    files: [],
    summary: {
      fileCount: 3,
      functionCount: 5,
      totalLoc: 1200,
      avgComplexity: 4.2,
      maxComplexity: 18,
      avgCognitive: 6.1,
      maxCognitive: 25,
      hotspots: [hotspot()],
      byLanguage: [],
      severity: { low: 3, moderate: 1, high: 1, veryHigh: 0 },
      overThreshold: 0,
      threshold: null,
      churn: null,
      ...over,
    },
  };
}

test("renders headline metrics and a hot spots table", () => {
  const md = renderMarkdown(report());
  assert.match(md, /^# Complexity Radar/);
  assert.match(md, /## Hot spots/);
  assert.match(md, /`handle`/);
  assert.match(md, /src\/server\.ts:12/);
  assert.ok(md.endsWith("\n"));
});

test("shows a threshold verdict when a threshold was set", () => {
  const pass = renderMarkdown(report({ threshold: 20, overThreshold: 0 }));
  assert.match(pass, /✅ 0 function\(s\) over the complexity threshold of 20/);
  const fail = renderMarkdown(report({ threshold: 10, overThreshold: 2 }));
  assert.match(fail, /⚠️ 2 function\(s\) over the complexity threshold of 10/);
});

test("omits the risk section when churn did not run", () => {
  const md = renderMarkdown(report({ churn: null }));
  assert.doesNotMatch(md, /## Risk hot spots/);
});

test("renders the risk section with churn window and risk scores", () => {
  const risky = hotspot({ commits: 9, risk: 162 });
  const md = renderMarkdown(
    report({
      churn: { since: "6 months ago", totalCommits: 40, hotspots: [risky] },
    }),
  );
  assert.match(md, /## Risk hot spots/);
  assert.match(md, /since 6 months ago/);
  assert.match(md, /\| 162 \| 18 \| 9 \|/);
});

test("escapes pipe characters so table cells do not break", () => {
  const md = renderMarkdown(report({ hotspots: [hotspot({ name: "a|b" })] }));
  assert.match(md, /`a\\\|b`/);
  assert.doesNotMatch(md, /`a\|b`/);
});

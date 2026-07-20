import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { analyzeProject } from "../src/index.js";
import { collectChurn, isGitRepo, parseChurn } from "../src/git.js";

// Sample of `git log --no-renames --format=%H --name-only` output: two commits,
// with src/a.ts touched twice and src/b.ts once.
const SAMPLE_LOG = [
  "a".repeat(40),
  "",
  "src/a.ts",
  "src/b.ts",
  "",
  "b".repeat(40),
  "",
  "src/a.ts",
  "",
].join("\n");

test("parseChurn counts commits per file and ignores hash lines", () => {
  const counts = parseChurn(SAMPLE_LOG, "/repo");
  assert.equal(counts.size, 2); // a.ts and b.ts, hashes excluded
  let total = 0;
  for (const n of counts.values()) total += n;
  assert.equal(total, 3); // a.ts×2 + b.ts×1
  assert.equal(Math.max(...counts.values()), 2);
});

test("collectChurn returns null outside a git repo", () => {
  const dir = mkdtempSync(join(tmpdir(), "cr-nogit-"));
  assert.equal(isGitRepo(dir), false);
  assert.equal(collectChurn(dir), null);
});

test("analyzeProject attaches churn and a risk ranking in a git repo", () => {
  const dir = mkdtempSync(join(tmpdir(), "cr-git-"));
  const git = (...args: string[]) => {
    try {
      execFileSync("git", ["-C", dir, "-c", "user.email=t@t.co", "-c", "user.name=T", ...args], {
        stdio: "ignore",
      });
      return true;
    } catch {
      return false;
    }
  };

  if (!git("init", "-q")) return; // git unavailable — nothing to assert

  mkdirSync(join(dir, "src"));
  const file = join(dir, "src", "hot.ts");
  const branchy = `export function hot(x: number) {
    if (x > 0) { return 1; }
    if (x > 1) { return 2; }
    return x > 2 ? 3 : 0;
  }`;
  writeFileSync(file, branchy);
  git("add", "-A");
  git("commit", "-q", "-m", "one");
  // A second commit touching the same file → churn of 2.
  writeFileSync(file, branchy + "\n// touched\n");
  git("add", "-A");
  git("commit", "-q", "-m", "two");

  const report = analyzeProject([dir], dir, { since: null });

  const hot = report.files.find((f) => f.relPath === "src/hot.ts");
  assert.ok(hot, "file should be analysed");
  assert.equal(hot.commits, 2);

  assert.ok(report.summary.churn, "churn summary should be present");
  const top = report.summary.churn.hotspots[0];
  assert.ok(top, "a risk hotspot should be ranked");
  assert.equal(top.name, "hot");
  assert.equal(top.commits, 2);
  assert.equal(top.risk, top.complexity * 2);
});

test("analyzeProject omits churn when disabled", () => {
  const report = analyzeProject([resolve("src")], resolve("."), { churn: false });
  assert.equal(report.summary.churn, null);
  for (const file of report.files) assert.equal(file.commits, null);
});

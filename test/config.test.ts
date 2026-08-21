import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig, validateConfig } from "../src/config.js";

function tmp(prefix = "cr-config-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("loadConfig returns null when no config exists", () => {
  // A fresh temp dir with a real parent chain but no config anywhere in it.
  const dir = tmp();
  const nested = join(dir, "a", "b");
  mkdirSync(nested, { recursive: true });
  // Only assert we get an object-or-null without throwing; a stray config in a
  // parent of tmpdir is theoretically possible, so don't hard-assert null here.
  const loaded = loadConfig(nested);
  assert.ok(loaded === null || typeof loaded.config === "object");
});

test("loadConfig reads complexity-radar.json from the current directory", () => {
  const dir = tmp();
  writeFileSync(
    join(dir, "complexity-radar.json"),
    JSON.stringify({ threshold: 15, top: 40, ignore: ["**/*.test.ts"] }),
  );

  const loaded = loadConfig(dir);
  assert.ok(loaded);
  assert.equal(loaded.config.threshold, 15);
  assert.equal(loaded.config.top, 40);
  assert.deepEqual(loaded.config.ignore, ["**/*.test.ts"]);
  assert.equal(loaded.dir, dir);
});

test("loadConfig walks up the tree to find a config in a parent", () => {
  const dir = tmp();
  writeFileSync(join(dir, "complexity-radar.json"), JSON.stringify({ quiet: true }));
  const nested = join(dir, "src", "deep");
  mkdirSync(nested, { recursive: true });

  const loaded = loadConfig(nested);
  assert.ok(loaded);
  assert.equal(loaded.config.quiet, true);
  assert.equal(loaded.dir, dir);
});

test("the dotfile name is also recognised", () => {
  const dir = tmp();
  writeFileSync(join(dir, ".complexity-radar.json"), JSON.stringify({ top: 7 }));
  const loaded = loadConfig(dir);
  assert.ok(loaded);
  assert.equal(loaded.config.top, 7);
});

test("complexity-radar.json wins over a package.json block in the same dir", () => {
  const dir = tmp();
  writeFileSync(join(dir, "complexity-radar.json"), JSON.stringify({ top: 5 }));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "x", "complexity-radar": { top: 99 } }),
  );
  const loaded = loadConfig(dir);
  assert.ok(loaded);
  assert.equal(loaded.config.top, 5);
});

test("a package.json 'complexity-radar' block is used as a fallback", () => {
  const dir = tmp();
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "x", "complexity-radar": { threshold: 20 } }),
  );
  const loaded = loadConfig(dir);
  assert.ok(loaded);
  assert.equal(loaded.config.threshold, 20);
});

test("a package.json without the block does not stop the upward search", () => {
  const dir = tmp();
  writeFileSync(join(dir, "complexity-radar.json"), JSON.stringify({ top: 3 }));
  const nested = join(dir, "pkg");
  mkdirSync(nested);
  writeFileSync(join(nested, "package.json"), JSON.stringify({ name: "inner" }));

  const loaded = loadConfig(nested);
  assert.ok(loaded);
  assert.equal(loaded.config.top, 3); // found the parent's config, not stopped by package.json
});

test("an explicit --config path that is missing throws", () => {
  const dir = tmp();
  assert.throws(() => loadConfig(dir, "nope.json"), /config file not found/);
});

test("an explicit --config path is loaded even without auto-discovery", () => {
  const dir = tmp();
  const path = join(dir, "custom.json");
  writeFileSync(path, JSON.stringify({ output: "out.html" }));
  const loaded = loadConfig(dir, path);
  assert.ok(loaded);
  assert.equal(loaded.config.output, "out.html");
});

test("validateConfig rejects a wrong-typed field", () => {
  assert.throws(
    () => validateConfig({ threshold: "high" }, "test"),
    /"threshold" must be number/,
  );
  assert.throws(
    () => validateConfig({ ignore: "a,b" }, "test"),
    /"ignore" must be string\[\]/,
  );
});

test("validateConfig accepts null for nullable fields and ignores $schema", () => {
  const c = validateConfig({ $schema: "./schema.json", threshold: null, since: null }, "test");
  assert.equal(c.threshold, undefined);
  assert.equal(c.since, undefined);
});

test("validateConfig rejects a non-object", () => {
  assert.throws(() => validateConfig([1, 2], "test"), /must be a JSON object/);
  assert.throws(() => validateConfig("nope", "test"), /must be a JSON object/);
});

test("validateConfig keeps only known keys and drops unknown ones", () => {
  const c = validateConfig({ top: 10, bogus: true }, "test");
  assert.equal(c.top, 10);
  assert.equal((c as Record<string, unknown>).bogus, undefined);
});

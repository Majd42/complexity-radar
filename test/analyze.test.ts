import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeSource, cognitiveOf, complexityOf, severityFor } from "../src/analyze.js";
import { cleanSource } from "../src/clean.js";
import { LANGUAGES, languageForExtension } from "../src/languages.js";

const ts = LANGUAGES.find((l) => l.id === "typescript")!;
const js = LANGUAGES.find((l) => l.id === "javascript")!;
const py = LANGUAGES.find((l) => l.id === "python")!;
const go = LANGUAGES.find((l) => l.id === "go")!;

test("a straight-line function has complexity 1", () => {
  const src = `function add(a, b) { return a + b; }`;
  const { functions } = analyzeSource(src, ts);
  assert.equal(functions.length, 1);
  assert.equal(functions[0]!.name, "add");
  assert.equal(functions[0]!.complexity, 1);
  assert.equal(functions[0]!.params, 2);
});

test("each decision point adds one", () => {
  const src = `function f(x) {
    if (x > 0) { return 1; }
    for (let i = 0; i < x; i++) { if (i % 2 === 0 && i > 3) {} }
    return x > 5 ? 1 : 0;
  }`;
  // base 1 + if + inner-if + for + (&&) + (ternary ?) = 6
  const { functions } = analyzeSource(src, ts);
  assert.equal(functions[0]!.complexity, 6);
});

test("keywords inside strings and comments are not counted", () => {
  const src = `function g() {
    // if for while switch
    const s = "if (a && b) for while";
    return 1;
  }`;
  const { functions } = analyzeSource(src, ts);
  assert.equal(functions[0]!.complexity, 1);
});

test("optional chaining and nullish are not miscounted as ternary", () => {
  const src = `function h(o) { return o?.a ?? o?.b; }`;
  const { functions } = analyzeSource(src, ts);
  // ?? counts as one decision; ?. must not add ternary points.
  assert.equal(functions[0]!.complexity, 2);
});

test("arrow functions assigned to variables are detected", () => {
  const src = `const isEven = (n) => n % 2 === 0 && n > 0;`;
  const { functions } = analyzeSource(src, js);
  assert.equal(functions.length, 1);
  assert.equal(functions[0]!.name, "isEven");
});

test("nested params with destructuring and defaults count correctly", () => {
  const src = `function build({ a, b } = {}, [c, d], e = f(1, 2)) { return a; }`;
  const { functions } = analyzeSource(src, ts);
  assert.equal(functions[0]!.params, 3);
});

test("python def bodies are delimited by indentation", () => {
  const src = [
    "def outer(x):",
    "    if x:",
    "        return 1",
    "    return 0",
    "",
    "def other():",
    "    return 2",
  ].join("\n");
  const { functions } = analyzeSource(src, py);
  assert.equal(functions.length, 2);
  const outer = functions.find((f) => f.name === "outer")!;
  assert.equal(outer.complexity, 2); // base + if
  assert.equal(outer.endLine, 4);
});

test("python boolean operators add decisions", () => {
  const src = ["def f(a, b):", "    return a and b or not a"].join("\n");
  const { functions } = analyzeSource(src, py);
  assert.equal(functions[0]!.complexity, 3); // base + and + or
});

test("go functions with receivers are detected", () => {
  const src = `func (s *Server) Handle(w int) int {
    if w > 0 && w < 10 {
      return 1
    }
    return 0
  }`;
  const { functions } = analyzeSource(src, go);
  assert.equal(functions.length, 1);
  assert.equal(functions[0]!.name, "Handle");
  assert.equal(functions[0]!.complexity, 3); // base + if + &&
});

test("severity buckets map as documented", () => {
  assert.equal(severityFor(1), "low");
  assert.equal(severityFor(10), "low");
  assert.equal(severityFor(11), "moderate");
  assert.equal(severityFor(21), "high");
  assert.equal(severityFor(41), "veryHigh");
});

test("cleanSource preserves length and newlines", () => {
  const src = `a "string with\nnewline" // comment\n`;
  const cleaned = cleanSource(src, ts);
  assert.equal(cleaned.length, src.length);
  assert.equal((cleaned.match(/\n/g) || []).length, (src.match(/\n/g) || []).length);
});

test("extensions resolve to languages", () => {
  assert.equal(languageForExtension(".TS")?.id, "typescript");
  assert.equal(languageForExtension(".py")?.id, "python");
  assert.equal(languageForExtension(".unknown"), undefined);
});

test("complexityOf counts a clean body directly", () => {
  assert.equal(complexityOf("{ if (a) {} while (b) {} }", ts), 3);
});

test("a straight-line function has cognitive complexity 0", () => {
  const { functions } = analyzeSource(`function add(a, b) { return a + b; }`, ts);
  assert.equal(functions[0]!.cognitive, 0);
});

test("cognitive complexity penalises nesting", () => {
  const src = `function f(x) {
    if (x > 0) {
      for (const y of x) {
        if (y) {}
      }
    }
  }`;
  // if(+1) + for(+1+1) + if(+1+2) = 6, versus cyclomatic base+3 = 4.
  const { functions } = analyzeSource(src, ts);
  assert.equal(functions[0]!.cognitive, 6);
  assert.equal(functions[0]!.complexity, 4);
});

test("a switch is one cognitive increment but many cyclomatic ones", () => {
  const src = `function s(x) {
    switch (x) {
      case 1: return 1;
      case 2: return 2;
      case 3: return 3;
    }
  }`;
  const { functions } = analyzeSource(src, ts);
  assert.equal(functions[0]!.cognitive, 1); // one switch
  assert.equal(functions[0]!.complexity, 4); // base + 3 cases
});

test("else if collapses to a single cognitive increment", () => {
  const src = `function g(x) {
    if (x > 2) {}
    else if (x > 1) {}
    else {}
  }`;
  // if(+1) + else-if(+1) + else(+1) = 3, none nested.
  const { functions } = analyzeSource(src, ts);
  assert.equal(functions[0]!.cognitive, 3);
});

test("cognitive counts runs of logical operators, not each operator", () => {
  const { functions } = analyzeSource(`function h(a, b, c, d) { return a && b && c || d; }`, js);
  // a && b && c is one run (+1), || d is a second run (+1) = 2.
  assert.equal(functions[0]!.cognitive, 2);
});

test("python cognitive complexity tracks indentation nesting", () => {
  const src = [
    "def f(x):",
    "    if x:",
    "        for y in x:",
    "            if y:",
    "                pass",
  ].join("\n");
  // if(+1) + for(+1+1) + if(+1+2) = 6.
  const { functions } = analyzeSource(src, py);
  assert.equal(functions[0]!.cognitive, 6);
});

test("cognitiveOf scores a clean body directly with nesting weight", () => {
  // if at depth 0 (+1), while nested at depth 1 (+2) = 3.
  assert.equal(cognitiveOf("{ if (a) { while (b) {} } }", ts), 3);
});

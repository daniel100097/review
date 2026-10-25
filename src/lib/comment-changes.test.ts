import { expect, test } from "bun:test";
import { commentOnlyLines, withoutCommentChanges } from "./comment-changes";
import { parseHunks } from "./diff";
import { highlightDiff } from "./highlight";

const analyze = (path: string, patch: string[]) => {
  const lines = parseHunks(patch.join("\n"));
  const tokens = highlightDiff(path, lines);
  return { lines, commentOnly: commentOnlyLines(lines, tokens), ...withoutCommentChanges(lines, tokens) };
};

test("hides added doc comments and edited trailing comments", () => {
  const { commentOnly, onlyComments } = analyze("a.ts", [
    "@@ -1,4 +1,7 @@",
    " const a = 1;",
    "+/**",
    "+ * Explains b.",
    "+ */",
    " const b = 2;",
    "-const c = 3; // old",
    "+const c = 3; // new",
  ]);
  expect(commentOnly).toEqual([false, false, true, true, true, false, true, true]);
  expect(onlyComments).toBe(true);
});

test("keeps runs that also change code", () => {
  const { commentOnly, view } = analyze("a.ts", [
    "@@ -1,3 +1,4 @@",
    " const a = 1;",
    "+// Explains b.",
    " const b = 2;",
    "-const c = 3; // old",
    "+const c = 4; // new",
  ]);
  expect(commentOnly).toEqual([false, false, true, false, false, false]);
  // The comment-only run becomes a marker; the code change stays.
  expect(view).toEqual([0, 1, { hidden: 1, first: 2 }, 3, 4, 5]);
});

test("treats moving a comment above its line as comment-only", () => {
  const { onlyComments } = analyze("a.ts", ["@@ -1 +1,2 @@", "-run(); // why", "+// why", "+run();"]);
  expect(onlyComments).toBe(true);
});

test("depends on the language's comment syntax", () => {
  // `#` starts a comment in Python and YAML, but not in TypeScript.
  expect(analyze("a.py", ["@@ -1 +1,2 @@", "+# note", " x = 1"]).onlyComments).toBe(true);
  expect(analyze("a.yaml", ["@@ -1 +1,2 @@", "+# note", " x: 1"]).onlyComments).toBe(true);
  expect(analyze("a.ts", ["@@ -1 +1,2 @@", "+# note", " x = 1"]).onlyComments).toBe(false);
  // `//` is a comment in Go but not in Python.
  expect(analyze("a.go", ["@@ -1 +1,2 @@", "+// note", " x := 1"]).onlyComments).toBe(true);
  expect(analyze("a.py", ["@@ -1 +1,2 @@", "+// note", " x = 1"]).onlyComments).toBe(false);
});

test("treats tool directives as code", () => {
  for (const [path, line] of [
    ["a.go", "//go:build linux"],
    ["a.go", "//go:embed assets"],
    ["a.ts", "// @ts-expect-error legacy API"],
    ["a.ts", "// eslint-disable-next-line no-console"],
    ["a.ts", "/* oxlint-disable no-shadow */"],
    ["a.py", "# type: ignore"],
    ["a.py", "# noqa: E501"],
    ["run.sh", "#!/usr/bin/env bash"],
  ] as const)
    expect(analyze(path, ["@@ -1 +1,2 @@", `+${line}`, " x"]).onlyComments).toBe(false);
});

test("never hides whitespace-only changes or unknown languages", () => {
  expect(analyze("a.ts", ["@@ -1 +1,2 @@", "+", " x = 1"]).onlyComments).toBe(false);
  expect(analyze("NOTES", ["@@ -1 +1,2 @@", "+# note", " x"]).onlyComments).toBe(false);
});

test("drops hunks that only change comments", () => {
  const { view } = analyze("a.ts", [
    "@@ -1,2 +1,3 @@",
    " a();",
    "+// note",
    " b();",
    "@@ -10,2 +11,2 @@",
    " c();",
    "-d();",
    "+e();",
  ]);
  expect(view).toEqual([4, 5, 6, 7]);
});

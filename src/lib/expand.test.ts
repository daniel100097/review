import { expect, test } from "bun:test";
import { parseHunks } from "./diff";
import { expandLines } from "./expand";

// New file: n1..n61. Line 11 replaced `x`, and n41 was added, so old numbers are one lower after it.
const content = Array.from({ length: 61 }, (_, i) => `n${i + 1}`);
const lines = parseHunks(
  ["@@ -10,3 +10,3 @@ fn a", " n10", "-x", "+n11", " n12", "@@ -40,2 +40,3 @@ fn b", " n40", "+n41", " n42"].join("\n"),
);
const show = (result: ReturnType<typeof expandLines>) =>
  result.lines.map((l, i) => (l.kind === "hunk" ? `${l.content} ${JSON.stringify(result.gaps.get(i))}` : `${l.oldLine ?? "-"} ${l.newLine ?? "-"} ${l.content}`));

test("marks hidden lines at hunk headers and after the last hunk before the file is loaded", () => {
  expect(show(expandLines(lines, undefined, [[1, 20]]))).toEqual([
    '@@ -10,3 +10,3 @@ fn a {"from":1,"to":9,"edge":"top"}',
    "10 10 n10",
    "11 - x",
    "- 11 n11",
    "12 12 n12",
    '@@ -40,2 +40,3 @@ fn b {"from":13,"to":39}',
    "40 40 n40",
    "- 41 n41",
    "41 42 n42",
    ' {"from":43,"edge":"bottom"}',
  ]);
});

test("reveals lines from both ends of a gap and renumbers the header below them", () => {
  const result = show(expandLines(lines, content, [[13, 14], [38, 39], [43, 44]]));
  expect(result.slice(4)).toEqual([
    "12 12 n12",
    "13 13 n13",
    "14 14 n14",
    '@@ -38,6 +38,7 @@ fn b {"from":15,"to":37}',
    "38 38 n38",
    "39 39 n39",
    "40 40 n40",
    "- 41 n41",
    "41 42 n42",
    "42 43 n43",
    "43 44 n44",
    ' {"from":45,"to":61,"edge":"bottom"}',
  ]);
});

test("drops headers of fully revealed gaps", () => {
  const result = show(expandLines(lines, content, [[1, Infinity]]));
  expect(result).toHaveLength(61 + 1);
  expect(result.slice(0, 2)).toEqual(["1 1 n1", "2 2 n2"]);
  expect(result.at(-1)).toBe("60 61 n61");
  expect(result.filter(l => l.startsWith("@@"))).toEqual([]);
});

test("keeps a header that hides nothing and adds none at the end of the file", () => {
  const atStart = parseHunks(["@@ -1,2 +1,2 @@", "-a", "+n1", " n2"].join("\n"));
  expect(show(expandLines(atStart, ["n1", "n2"], []))).toEqual(["@@ -1,2 +1,2 @@ undefined", "1 - a", "- 1 n1", "2 2 n2"]);
});

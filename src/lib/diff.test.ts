import { expect, test } from "bun:test";
import { parseHunks } from "./diff";

test("numbers lines across hunks", () => {
  const patch = ["@@ -1,2 +1,2 @@", " keep", "-old", "+new", "@@ -10 +10,2 @@", " ctx", "+added", "\\ No newline at end of file"].join(
    "\n",
  );
  expect(parseHunks(patch)).toEqual([
    { kind: "hunk", content: "@@ -1,2 +1,2 @@" },
    { kind: "context", content: "keep", oldLine: 1, newLine: 1 },
    { kind: "del", content: "old", oldLine: 2 },
    { kind: "add", content: "new", newLine: 2 },
    { kind: "hunk", content: "@@ -10 +10,2 @@" },
    { kind: "context", content: "ctx", oldLine: 10, newLine: 10 },
    { kind: "add", content: "added", newLine: 11 },
  ]);
});

test("empty patch has no lines", () => {
  expect(parseHunks("")).toEqual([]);
});

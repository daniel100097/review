import { expect, test } from "bun:test";
import type { FileDiff, PullRequest } from "../providers/types";
import { coverageErrors, patchCap, walkthroughPrompt } from "./walkthrough";

test("accepts every file in exactly one group", () => {
  expect(coverageErrors([{ files: ["f2"] }, { files: ["f1", "f3"] }], 3)).toEqual([]);
});

test("reports unknown, duplicated and missing files", () => {
  expect(coverageErrors([{ files: ["f1", "f9"] }, { files: ["f1"] }], 3)).toEqual([
    "Unknown file IDs: f9.",
    "Files in more than one group: f1. Put each file in exactly one group.",
    "Files in no group: f2, f3.",
  ]);
});

test("cuts only the largest patches to fit the budget", () => {
  expect(patchCap([10, 20, 30], 100)).toBe(Infinity);
  // 10 and 20 fit whole; the two big ones share what's left.
  expect(patchCap([10, 20, 1000, 5000], 130)).toBe(50);
});

test("lists files by ID with line counts and cuts huge patches", () => {
  const pull = { number: 7, title: "Fix it", body: "", author: { name: "Alice" }, sourceBranch: "fix", targetBranch: "main" } as PullRequest;
  const files: FileDiff[] = [
    { oldPath: "a.ts", newPath: "b.ts", status: "renamed", patch: "@@ -1 +1 @@\n-old\n+new" },
    { oldPath: "logo.png", newPath: "logo.png", status: "added", patch: "" },
    { oldPath: "pnpm-lock.yaml", newPath: "pnpm-lock.yaml", status: "modified", patch: ["@@ -1 +1 @@", ...Array(100_000).fill("+lock")].join("\n") },
  ];
  const prompt = walkthroughPrompt(pull, files);
  expect(prompt).toContain("f1 renamed a.ts → b.ts (+1 −1)\nf2 added logo.png (+0 −0)\nf3 modified pnpm-lock.yaml (+100000 −0)");
  expect(prompt).toContain("## f1 a.ts → b.ts\n```diff\n@@ -1 +1 @@\n-old\n+new\n```");
  expect(prompt).toContain("## f2 logo.png\n```diff\n(binary file or no textual changes)");
  expect(prompt).toMatch(/\+lock\n\[\d+ more lines omitted\]/);
  expect(prompt.length).toBeLessThan(260_000);
  expect(prompt).not.toContain("<description>");
});

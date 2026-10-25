import { expect, test } from "bun:test";
import { questionPrompt } from "./questions";

const context = {
  number: 7,
  title: "Fix rounding",
  body: "",
  author: { name: "Alice" },
  sourceBranch: "fix",
  targetBranch: "main",
  path: "src/price.ts",
  excerpt: "   10    10   const a = 1;\n         11 + const b = 2;",
  baseSha: "base123",
  headSha: "head456",
  fileDiff: ["@@ -1 +1 @@", ...Array(700).fill("+x")].join("\n"),
};

test("gives the agent the commits, the selected lines and the file's diff", () => {
  const prompt = questionPrompt(context, [], "Why b?");
  expect(prompt).toContain("`git diff base123 head456` is the pull request's diff");
  expect(prompt).toContain("these lines of src/price.ts");
  expect(prompt).toContain("         11 + const b = 2;");
  expect(prompt).toContain("[101 more lines omitted]");
  expect(prompt).toContain("# Question\nWhy b?");
  expect(prompt).not.toContain("Earlier in this conversation");
});

test("replays finished turns when the agent's session is gone", () => {
  const prompt = questionPrompt(
    context,
    [
      { role: "user", body: "What is a?", status: "done" },
      { role: "agent", body: "A constant.", status: "done" },
      { role: "user", body: "And c?", status: "done" },
      { role: "agent", body: "", status: "failed" },
    ],
    "Why b?",
  );
  expect(prompt).toContain("# Earlier in this conversation\n**Reviewer:** What is a?\n\n**You:** A constant.\n\n**Reviewer:** And c?\n\n# Question");
});

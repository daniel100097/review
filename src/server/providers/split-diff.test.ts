import { expect, test } from "bun:test";
import { splitGitDiff } from "./split-diff";

test("splits a git diff into files with status and patch", () => {
  const diff = [
    "diff --git a/src/a.ts b/src/a.ts",
    "index 1111111..2222222 100644",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,2 +1,2 @@",
    "-old",
    "+new",
    " same",
    "diff --git a/added.txt b/added.txt",
    "new file mode 100644",
    "index 0000000..3333333",
    "--- /dev/null",
    "+++ b/added.txt",
    "@@ -0,0 +1 @@",
    "+hello",
    "diff --git a/gone.txt b/gone.txt",
    "deleted file mode 100644",
    "--- a/gone.txt",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-bye",
    "diff --git a/old name.txt b/new name.txt",
    "similarity index 100%",
    "rename from old name.txt",
    "rename to new name.txt",
    "diff --git a/logo.png b/logo.png",
    "index 4444444..5555555 100644",
    "Binary files a/logo.png and b/logo.png differ",
    "",
  ].join("\n");

  expect(splitGitDiff(diff)).toEqual([
    { oldPath: "src/a.ts", newPath: "src/a.ts", status: "modified", patch: "@@ -1,2 +1,2 @@\n-old\n+new\n same" },
    { oldPath: "added.txt", newPath: "added.txt", status: "added", patch: "@@ -0,0 +1 @@\n+hello" },
    { oldPath: "gone.txt", newPath: "gone.txt", status: "deleted", patch: "@@ -1 +0,0 @@\n-bye" },
    { oldPath: "old name.txt", newPath: "new name.txt", status: "renamed", patch: "" },
    { oldPath: "logo.png", newPath: "logo.png", status: "modified", patch: "" },
  ]);
});

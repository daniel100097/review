import { afterEach, expect, mock, spyOn, test } from "bun:test";
import * as cli from "./cli";
import { gitlab } from "./gitlab";

afterEach(() => mock.restore());

test("GitLab filters nested projects and returns normalized list details", async () => {
  const run = spyOn(cli, "run").mockResolvedValue({
    stdout: JSON.stringify([{ iid: 7, state: "merged", author: { username: "alice", name: "Alice" },
      labels: [{ name: "needs review", color: "#abcdef" }], user_notes_count: 3 }]),
    stderr: "",
  });
  const result = await gitlab("gitlab.example").listPulls("group/subgroup/repo", {
    state: "merged", search: "fix checkout", label: "needs review", author: "alice", sort: "oldest", page: 2,
  });
  const url = new URL(run.mock.calls[0]![0][4]!, "https://gitlab.example/");
  expect(url.pathname).toBe("/projects/group%2Fsubgroup%2Frepo/merge_requests");
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    state: "merged", search: "fix checkout", labels: "needs review", author_username: "alice", sort: "asc", page: "2",
  });
  expect(result.items[0]).toMatchObject({ number: 7, state: "merged", comments: 3, labels: [{ name: "needs review", color: "#abcdef" }] });
  expect(result.nextPage).toBeUndefined();
});

test("GitLab fetches every page of a large MR's diffs", async () => {
  const diff = (i: number) => ({ old_path: `f${i}`, new_path: `f${i}`, diff: "@@ -1 +1 @@\n-a][b\n+a][c\n" });
  const pages = [Array.from({ length: 100 }, (_, i) => diff(i)), Array.from({ length: 100 }, (_, i) => diff(i + 100)), [diff(200)]];
  const run = spyOn(cli, "run").mockImplementation(async cmd => {
    const page = Number(new URL(cmd[4]!, "https://gitlab.example/").searchParams.get("page"));
    return { stdout: JSON.stringify(pages[page - 1]), stderr: "" };
  });
  const files = await gitlab("gitlab.example").getFiles("group/repo", 1);
  expect(files.map(f => f.newPath)).toEqual(Array.from({ length: 201 }, (_, i) => `f${i}`));
  expect(run.mock.calls.map(([cmd]) => cmd.includes("--paginate"))).toEqual([false, false, false]);
});

test("GitLab loads a file at a commit", async () => {
  const run = spyOn(cli, "run").mockResolvedValue({ stdout: JSON.stringify({ content: btoa("a\nb\n") }), stderr: "" });
  expect(await gitlab("gitlab.example").getFile("group/repo", "src/a b.ts", "abc123")).toBe("a\nb\n");
  expect(run.mock.calls.map(([cmd]) => cmd[4])).toEqual([
    "projects/group%2Frepo/repository/files/src%2Fa%20b.ts?ref=abc123",
  ]);
});

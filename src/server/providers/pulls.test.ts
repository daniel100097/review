import { afterEach, expect, mock, spyOn, test } from "bun:test";
import * as cli from "./cli";
import { forgejo } from "./forgejo";
import { gitlab } from "./gitlab";
import { pullPageSize } from "./types";

afterEach(() => mock.restore());

test.each(["closed", "merged"] as const)("Forgejo skips pages without %s PRs and preserves the next page", async state => {
  const pull = (number: number, matches: boolean) => ({
    number,
    state: "closed",
    merged: matches === (state === "merged"),
    user: { login: "alice" },
    head: { ref: "feature", sha: "abc" },
    base: { ref: "main" },
  });
  const pages = [
    Array.from({ length: pullPageSize }, (_, i) => pull(i + 1, false)),
    Array.from({ length: pullPageSize }, (_, i) => pull(i + 31, i === 0)),
    Array.from({ length: pullPageSize }, (_, i) => pull(i + 61, false)),
    [],
  ];
  const requested: number[] = [];
  spyOn(cli, "run").mockImplementation(async cmd => {
    const url = new URL(cmd[4]!, "https://forge.example");
    const page = Number(url.searchParams.get("page"));
    requested.push(page);
    return { stdout: JSON.stringify(pages[page - 1]), stderr: "" };
  });
  const provider = forgejo("forge.example");
  const first = await provider.listPulls("owner/repo", { state, sort: "updated", page: 1 });
  expect(first.items.map(p => [p.number, p.state])).toEqual([[31, state]]);
  expect(first.nextPage).toBe(3);
  const last = await provider.listPulls("owner/repo", { state, sort: "updated", page: first.nextPage! });
  expect(last).toEqual({ items: [], nextPage: undefined });
  expect(requested).toEqual([1, 2, 3, 4]);
});

test("Forgejo searches labeled PRs without requiring branch data", async () => {
  const run = spyOn(cli, "run").mockResolvedValue({
    stdout: JSON.stringify([{ number: 7, state: "closed", pull_request: { merged: true }, user: { login: "alice" },
      labels: [{ name: "needs review", color: "abcdef" }], comments: 3 }]),
    stderr: "",
  });
  const result = await forgejo("forge.example").listPulls("owner/repo", {
    state: "merged", search: "fix checkout", label: "needs review", author: "alice", sort: "oldest", page: 1,
  });
  const url = new URL(run.mock.calls[0]![0][4]!, "https://forge.example");
  expect(url.pathname).toBe("/repos/owner/repo/issues");
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    type: "pulls", q: "fix checkout", labels: "needs review", created_by: "alice", state: "closed", sort: "oldest",
  });
  expect(result.items[0]).toMatchObject({ number: 7, state: "merged", comments: 3, labels: [{ name: "needs review", color: "#abcdef" }] });
  expect(result.items[0]?.sourceBranch).toBeUndefined();
  expect(result.nextPage).toBeUndefined();
});

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

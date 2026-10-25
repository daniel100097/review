import { $ } from "bun";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { splitGitDiff } from "../providers/split-diff";
import type { Commit } from "../providers/types";
import { attributeLines, contributorsOf } from "./attribution";

const commit = (authorEmail: string, authorName: string, extra: Partial<Commit> = {}): Commit => ({
  sha: Math.random().toString(16).slice(2),
  authorName,
  authorEmail,
  parents: 1,
  ...extra,
});

test("groups contributors by email and leaves out people who only merged", () => {
  const alice = { username: "alice", name: "Alice E." };
  expect(
    contributorsOf([
      commit("a@example.com", "Alice Example"),
      commit("A@example.com", "Alice", { user: alice }),
      commit("b@example.com", "Bob"),
      commit("m@example.com", "Merger", { parents: 2 }),
    ]),
  ).toEqual([
    { key: "alice", name: "Alice E.", avatarUrl: undefined, commits: 2 },
    { key: "b@example.com", name: "Bob", avatarUrl: undefined, commits: 1 },
  ]);
});

test("attributes added and deleted lines to the commits' authors, also through merges", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "attribution-"));
  try {
    const write = (content: string) => Bun.write(path.join(dir, "a.txt"), content);
    const commitAs = (who: string) => $`git -C ${dir} -c user.name=${who} -c user.email=${who}@example.com commit -qam ${who}`.quiet();
    await $`git init -q -b main ${dir}`.quiet();
    const lines = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
    await write(lines.join("\n") + "\n");
    await $`git -C ${dir} add a.txt`.quiet();
    await commitAs("base");
    const base = (await $`git -C ${dir} rev-parse HEAD`.text()).trim();

    // Alice changes line 2 on a branch that's merged in later; Bob deletes line 8 and appends a line.
    await $`git -C ${dir} checkout -qb alice`.quiet();
    await write(lines.with(1, "TWO").join("\n") + "\n");
    await commitAs("alice");
    await $`git -C ${dir} checkout -q main`.quiet();
    await write([...lines.toSpliced(7, 1), "eleven"].join("\n") + "\n");
    await commitAs("bob");
    await $`git -C ${dir} -c user.name=merger -c user.email=merger@example.com merge -q --no-edit alice`.quiet();
    const head = (await $`git -C ${dir} rev-parse HEAD`.text()).trim();

    const files = splitGitDiff(await $`git -C ${dir} diff ${base} ${head}`.text());
    const result = await attributeLines(dir, base, head, files, email => email.split("@")[0]!);
    const who = (pairs: [number, number][]) => Object.fromEntries(pairs.map(([line, i]) => [line, result.authors[i]!.key]));
    expect(who(result.files["a.txt"]!.added)).toEqual({ 2: "alice", 10: "bob" });
    expect(who(result.files["a.txt"]!.deleted)).toEqual({ 2: "alice", 8: "bob" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

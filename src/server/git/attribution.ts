import { parseHunks } from "@/lib/diff";
import type { Commit, FileDiff } from "../providers/types";
import { git } from "./checkout";

export interface Contributor {
  /** Forge username, or the email for authors the forge doesn't know. */
  key: string;
  name: string;
  avatarUrl?: string;
  /** Commits other than merges. */
  commits: number;
}

/** People who committed to a pull request, grouped by email: the same person often commits under several names. */
export function contributorsOf(commits: Commit[]): Contributor[] {
  const byEmail = new Map<string, Commit[]>();
  for (const c of commits) {
    const email = c.authorEmail.toLowerCase();
    byEmail.set(email, [...(byEmail.get(email) ?? []), c]);
  }
  return [...byEmail]
    .map(([email, own]) => {
      const user = own.find(c => c.user)?.user;
      const names = own.map(c => c.authorName);
      const commonName = names.toSorted((a, b) => names.filter(n => n === b).length - names.filter(n => n === a).length)[0]!;
      return {
        key: user?.username ?? email,
        name: user?.name ?? commonName,
        avatarUrl: user?.avatarUrl,
        commits: own.filter(c => c.parents < 2).length,
      };
    })
    .filter(c => c.commits > 0)
    .toSorted((a, b) => b.commits - a.commits);
}

/** `[line, author index]` pairs; line numbers are new-side for added lines and old-side for deleted ones. */
export interface FileAttribution {
  added: [number, number][];
  deleted: [number, number][];
}

export interface Attribution {
  authors: { key: string; name: string }[];
  /** By `newPath`. */
  files: Record<string, FileAttribution>;
}

/** More ranges than this and blame runs on the whole file instead (one `-L` per range). */
const maxRanges = 200;

function toRanges(lines: number[]) {
  const ranges: [number, number][] = [];
  for (const line of lines.toSorted((a, b) => a - b)) {
    const last = ranges.at(-1);
    if (last && line <= last[1] + 1) last[1] = line;
    else ranges.push([line, line]);
  }
  return ranges;
}

/**
 * The commit each of `lines` comes from: the one that last changed it at `head`, or with `reverse`, the last
 * commit in the range that still had it (lines of `path` at `base`).
 */
async function blame(bare: string, range: string, path: string, lines: number[], reverse: boolean) {
  const ranges = toRanges(lines);
  const args = ranges.length <= maxRanges ? ranges.flatMap(([from, to]) => ["-L", `${from},${to}`]) : [];
  const out = await git(["-C", bare, "blame", "--porcelain", ...(reverse ? ["--reverse"] : []), ...args, range, "--", path]);
  const commits = new Map<number, string>();
  for (const line of out.split("\n")) {
    // Each line's header: "<sha> <line in that commit> <line here>[ <lines in group>]"; content lines start with a tab.
    const header = line.match(/^([0-9a-f]{40}) \d+ (\d+)/);
    if (header) commits.set(Number(header[2]), header[1]!);
  }
  return commits;
}

/** Results by repo and commit range; the same range always gives the same answer. */
const cache = new Map<string, Promise<Attribution>>();

/**
 * Who added and deleted each changed line of `files` (the diff from `base` to `head`), from git blame in the bare
 * clone. A deleted line counts for the commit after the last one that still had it.
 */
export function attributeLines(bare: string, base: string, head: string, files: FileDiff[], keyOf: (email: string) => string) {
  const cacheKey = `${bare}|${base}|${head}`;
  let result = cache.get(cacheKey);
  if (!result) {
    result = attribute(bare, base, head, files, keyOf);
    result.catch(() => cache.delete(cacheKey));
    cache.set(cacheKey, result);
    if (cache.size > 20) cache.delete(cache.keys().next().value!);
  }
  return result;
}

async function attribute(bare: string, base: string, head: string, files: FileDiff[], keyOf: (email: string) => string) {
  const range = `${base}..${head}`;
  const log = await git(["-C", bare, "log", "--format=%H%x00%ae%x00%an", range]);
  const commitAuthor = new Map(
    log
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(line => {
        const [sha, email, name] = line.split("\0") as [string, string, string];
        return [sha, { key: keyOf(email.toLowerCase()), name }] as const;
      }),
  );

  const authors: Attribution["authors"] = [];
  const authorIndex = (sha: string | undefined) => {
    const author = sha && commitAuthor.get(sha);
    if (!author) return undefined;
    let index = authors.findIndex(a => a.key === author.key);
    if (index === -1) index = authors.push(author) - 1;
    return index;
  };

  // The commit that deleted a line is a child of the last commit that had it, on the way to head. Merges only carry
  // other commits' deletions over, so they don't count.
  const successors = new Map<string, Promise<string | undefined>>();
  const successor = (sha: string) => {
    if (!successors.has(sha)) {
      const children = git(["-C", bare, "rev-list", "--ancestry-path", "--parents", `${sha}..${head}`]).then(out => {
        const commits = out.trim().split("\n").map(line => line.split(" "));
        return commits.find(([, ...parents]) => parents.length === 1 && parents[0] === sha)?.[0];
      });
      successors.set(sha, children);
    }
    return successors.get(sha)!;
  };

  /**
   * For deletions blame can't place (they came in through a merge): the authors of non-merge commits that removed a
   * line with this content from the file.
   */
  const removedBy = async (file: FileDiff) => {
    const paths = file.oldPath === file.newPath ? [file.oldPath] : [file.oldPath, file.newPath];
    const out = await git(["-C", bare, "log", "--no-merges", "--format=%x00%H", "-p", "--unified=0", range, "--", ...paths]);
    const byContent = new Map<string, Set<number>>();
    let index: number | undefined;
    for (const line of out.split("\n")) {
      if (line.startsWith("\0")) index = authorIndex(line.slice(1));
      else if (index !== undefined && line.startsWith("-") && !/^--- (a\/|\/dev\/null)/.test(line)) {
        const content = line.slice(1);
        byContent.set(content, (byContent.get(content) ?? new Set()).add(index));
      }
    }
    return byContent;
  };

  const result: Attribution["files"] = {};
  const attributeFile = async (file: FileDiff) => {
    const lines = parseHunks(file.patch);
    const added = lines.flatMap(l => (l.kind === "add" ? [l.newLine!] : []));
    const deleted = lines.flatMap(l => (l.kind === "del" ? [l.oldLine!] : []));
    const [addedBy, lastHad] = await Promise.all([
      added.length ? blame(bare, range, file.newPath, added, false) : new Map<number, string>(),
      deleted.length ? blame(bare, range, file.oldPath, deleted, true) : new Map<number, string>(),
    ]);
    const deletedBy = new Map(await Promise.all([...lastHad].map(async ([line, sha]) => [line, await successor(sha)] as const)));
    const pairs = (lineNumbers: number[], shas: Map<number, string | undefined>) =>
      lineNumbers.flatMap(line => {
        const index = authorIndex(shas.get(line));
        return index === undefined ? [] : [[line, index] as [number, number]];
      });
    const deletedPairs = pairs(deleted, deletedBy);
    if (deletedPairs.length < deleted.length) {
      // Only when exactly one author removed that content; a lone `}` stays unattributed.
      const byContent = await removedBy(file);
      const placed = new Set(deletedPairs.map(([line]) => line));
      for (const l of lines) {
        if (l.kind !== "del" || placed.has(l.oldLine!)) continue;
        const authors = byContent.get(l.content);
        if (authors?.size === 1) deletedPairs.push([l.oldLine!, [...authors][0]!]);
      }
    }
    result[file.newPath] = { added: pairs(added, addedBy), deleted: deletedPairs };
  };

  // A few files at a time: each is one or two git processes.
  const queue = files.filter(f => f.patch);
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let file = queue.shift(); file; file = queue.shift()) await attributeFile(file);
    }),
  );
  return { authors, files: result };
}

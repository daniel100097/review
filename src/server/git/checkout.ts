import { mkdir, readdir, rm, stat, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Provider, PullRequest } from "../providers/types";

export const cacheDir = path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "codereview-ui");

/** Checkouts not used for this long are removed when another checkout of the repo is made. */
const maxIdleDays = 14;

/** One git operation per repo at a time; kept on globalThis so `bun --hot` doesn't forget running ones. */
const locks = ((globalThis as any).__codereviewCheckoutLocks ??= new Map()) as Map<string, Promise<unknown>>;

export async function git(args: string[], timeout = 60_000) {
  const proc = Bun.spawn(["git", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    timeout,
    // Fail instead of waiting for a password or host key confirmation nobody can answer.
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes" },
  });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`git ${args[0] === "-C" ? args[2] : args[0]}: ${stderr.trim() || `exited with code ${code}`}`);
  return stdout;
}

const hasCommit = (bare: string, sha: string) =>
  git(["-C", bare, "cat-file", "-e", `${sha}^{commit}`]).then(
    () => true,
    () => false,
  );

type PullCommits = Pick<PullRequest, "number" | "headSha" | "baseSha" | "targetBranch">;

/** Runs `work` after earlier git work on the same bare repo. */
function locked<T>(bare: string, work: () => Promise<T>) {
  const run = (locks.get(bare) ?? Promise.resolve()).catch(() => {}).then(work);
  locks.set(bare, run);
  return run.finally(() => {
    if (locks.get(bare) === run) locks.delete(bare);
  });
}

const barePath = (sourceId: number, repo: string) => path.join(cacheDir, "repos", String(sourceId), `${repo}.git`);

/** Makes sure the bare clone has the pull request's base and head commits; clones the repo the first time. */
async function fetchCommits(bare: string, provider: Provider, repo: string, pull: PullCommits) {
  if (!(await stat(bare).catch(() => null))) {
    await mkdir(path.dirname(bare), { recursive: true });
    await git(["clone", "--bare", "--no-tags", await provider.cloneUrl(repo), bare], 15 * 60_000);
  }
  if (!(await hasCommit(bare, pull.headSha)) || !(await hasCommit(bare, pull.baseSha))) {
    // The base is (usually) on the target branch; pull request heads may live in a fork, but their ref is here.
    const target = `+refs/heads/${pull.targetBranch}:refs/heads/${pull.targetBranch}`;
    await git(["-C", bare, "fetch", "--no-tags", "origin", target, `+${provider.headRef(pull.number)}:refs/codereview/pull/${pull.number}`], 5 * 60_000);
    for (const sha of [pull.headSha, pull.baseSha]) {
      if (!(await hasCommit(bare, sha))) throw new Error(`Commit ${sha} isn't in ${repo} after fetching; was the pull request updated?`);
    }
  }
}

/** The bare clone (shared by all pull requests of the repo), with the pull request's commits in it. */
export function pullRepo(sourceId: number, provider: Provider, repo: string, pull: PullCommits) {
  const bare = barePath(sourceId, repo);
  return locked(bare, async () => {
    await fetchCommits(bare, provider, repo, pull);
    return bare;
  });
}

/**
 * A read-only-by-convention checkout of the pull request's head commit, with its base commit available too.
 * Repos are cloned once (bare) with the user's SSH credentials; each head commit gets its own worktree.
 */
export function checkout(sourceId: number, provider: Provider, repo: string, pull: PullCommits) {
  const bare = barePath(sourceId, repo);
  const worktrees = path.join(cacheDir, "worktrees", String(sourceId), repo);
  const worktree = path.join(worktrees, pull.headSha);
  return locked(bare, async () => {
    await fetchCommits(bare, provider, repo, pull);
    if (!(await stat(worktree).catch(() => null))) {
      await git(["-C", bare, "worktree", "add", "--detach", worktree, pull.headSha], 5 * 60_000);
      await pruneIdle(bare, worktrees);
    }
    const now = new Date();
    await utimes(worktree, now, now);
    return worktree;
  });
}

async function pruneIdle(bare: string, worktrees: string) {
  const cutoff = Date.now() - maxIdleDays * 24 * 60 * 60 * 1000;
  for (const name of await readdir(worktrees)) {
    const dir = path.join(worktrees, name);
    if ((await stat(dir)).mtimeMs < cutoff) await rm(dir, { recursive: true, force: true });
  }
  await git(["-C", bare, "worktree", "prune"]);
}

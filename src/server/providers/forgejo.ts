import { run } from "./cli";
import { splitGitDiff } from "./split-diff";
import { pullPageSize, type Comment, type Label, type Provider, type PullRequest, type PullSummary, type Repo, type User } from "./types";

const user = (u: any): User => ({ username: u.login, name: u.full_name || u.login, avatarUrl: u.avatar_url });

const labels = (list: any[] | null): Label[] => (list ?? []).map(l => ({ name: l.name, color: `#${l.color}` }));

const pull = (pr: any): PullRequest => ({
  number: pr.number,
  title: pr.title,
  body: pr.body ?? "",
  state: pr.merged ? "merged" : pr.state === "open" ? "open" : "closed",
  draft: pr.draft ?? false,
  author: user(pr.user),
  labels: labels(pr.labels),
  comments: pr.comments ?? 0,
  sourceBranch: pr.head.ref,
  targetBranch: pr.base.ref,
  headSha: pr.head.sha,
  baseSha: pr.merge_base,
  url: pr.html_url,
  createdAt: pr.created_at,
  updatedAt: pr.updated_at,
});

/** A pull request from the issue search, which doesn't include branches. */
const searchHit = (issue: any): PullSummary => ({
  number: issue.number,
  title: issue.title,
  state: issue.pull_request?.merged ? "merged" : issue.state === "open" ? "open" : "closed",
  draft: issue.pull_request?.draft ?? false,
  author: user(issue.user),
  labels: labels(issue.labels),
  comments: issue.comments ?? 0,
  url: issue.html_url,
  createdAt: issue.created_at,
  updatedAt: issue.updated_at,
});

/** Forgejo (and Gitea) via `fj api`. */
export function forgejo(host: string): Provider {
  const raw = async (path: string, opts: { method?: string; body?: unknown; paginate?: boolean } = {}) => {
    const cmd = ["fj", "--host", host, "api", path];
    if (opts.method) cmd.push("--method", opts.method);
    if (opts.paginate) cmd.push("--paginate");
    if (opts.body !== undefined) cmd.push("--input", "-");
    const { stdout } = await run(cmd, opts.body === undefined ? undefined : JSON.stringify(opts.body));
    return stdout;
  };
  const api = async (...args: Parameters<typeof raw>) => {
    const out = await raw(...args);
    return out.trim() ? JSON.parse(out) : null;
  };
  const pr = (repo: string, number: number) => `/repos/${repo}/pulls/${number}`;

  return {
    whoami: async () => user(await api("/user")),

    async listRepos(search) {
      const q = new URLSearchParams({ limit: "50", sort: "updated", order: "desc" });
      if (search) q.set("q", search);
      const { data }: { data: any[] } = await api(`/repos/search?${q}`);
      return data.map(
        (r): Repo => ({ path: r.full_name, description: r.description ?? "", url: r.html_url, updatedAt: r.updated_at }),
      );
    },

    async listPulls(repo, { state, search, author, label, sort, page }) {
      // The API only knows open/closed/all; merged PRs are closed ones with `merged` set.
      const q = new URLSearchParams({ state: state === "merged" ? "closed" : state, limit: String(pullPageSize) });
      const searching = Boolean(search || label);
      if (searching) {
        // Only the issue search matches text and label names (the pulls endpoint wants label IDs).
        q.set("type", "pulls");
        q.set("sort", { updated: "recentupdate", newest: "latest", oldest: "oldest" }[sort]);
        if (search) q.set("q", search);
        if (label) q.set("labels", label);
        if (author) q.set("created_by", author);
      } else {
        // Without `sort` the API lists newest first.
        if (sort !== "newest") q.set("sort", sort === "updated" ? "recentupdate" : "oldest");
        if (author) q.set("poster", author);
      }
      let found: any[];
      let items: PullSummary[];
      do {
        q.set("page", String(page++));
        found = await api(`/repos/${repo}/${searching ? "issues" : "pulls"}?${q}`);
        items = found.map(searching ? searchHit : pull).filter(p => state === "all" || p.state === state);
        // Don't report an empty result while later pages may contain the requested state.
      } while (items.length === 0 && found.length === pullPageSize);
      return { items, nextPage: found.length === pullPageSize ? page : undefined };
    },

    listLabels: async repo => labels(await api(`/repos/${repo}/labels?limit=100`, { paginate: true })),

    getPull: async (repo, number) => pull(await api(pr(repo, number))),

    cloneUrl: async repo => (await api(`/repos/${repo}`)).ssh_url,

    headRef: number => `refs/pull/${number}/head`,

    getFiles: async (repo, number) => splitGitDiff(await raw(`${pr(repo, number)}.diff`)),

    async getCommits(repo, number) {
      const commits: any[] = await api(`${pr(repo, number)}/commits?limit=50&files=false&stat=false&verification=false`, {
        paginate: true,
      });
      return commits.map(c => ({
        sha: c.sha,
        authorName: c.commit.author.name,
        authorEmail: c.commit.author.email,
        user: c.author ? user(c.author) : undefined,
        parents: c.parents?.length ?? 1,
      }));
    },

    async getComments(repo, number) {
      const [issueComments, reviews]: [any[], any[]] = await Promise.all([
        api(`/repos/${repo}/issues/${number}/comments`),
        api(`${pr(repo, number)}/reviews`, { paginate: true }),
      ]);
      const reviewComments: any[][] = await Promise.all(
        reviews.filter(r => r.comments_count > 0).map(r => api(`${pr(repo, number)}/reviews/${r.id}/comments`)),
      );

      const general = [...issueComments, ...reviews.filter(r => r.body)].map(
        (c): Comment => ({
          id: String(c.id),
          author: user(c.user),
          body: c.body,
          createdAt: c.created_at ?? c.submitted_at,
        }),
      );
      const inline = reviewComments.flat().map(
        (c): Comment => ({
          id: String(c.id),
          author: user(c.user),
          body: c.body,
          createdAt: c.created_at,
          // `position` is the new-side line, `original_position` the old-side line; 0 means unset.
          position: {
            path: c.path,
            oldPath: c.path,
            newLine: c.position || undefined,
            oldLine: c.position ? undefined : c.original_position || undefined,
          },
        }),
      );
      return [...general, ...inline].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async addComment(repo, number, body, position) {
      if (!position) {
        await api(`/repos/${repo}/issues/${number}/comments`, { method: "POST", body: { body } });
        return;
      }
      await api(`${pr(repo, number)}/reviews`, {
        method: "POST",
        body: {
          event: "COMMENT",
          body: "",
          comments: [
            { path: position.path, body, new_position: position.newLine ?? 0, old_position: position.newLine ? 0 : (position.oldLine ?? 0) },
          ],
        },
      });
    },
  };
}

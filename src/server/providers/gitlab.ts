import { cliError, run } from "./cli";
import {
  pullPageSize,
  type Comment,
  type FileDiff,
  type Label,
  type LinePosition,
  type Provider,
  type PullRequest,
  type PullState,
  type Repo,
  type User,
} from "./types";

const user = (u: any): User => ({ username: u.username, name: u.name, avatarUrl: u.avatar_url });

// Lists return label details (`with_labels_details`); the single-MR endpoint returns names only.
const labels = (list: any[] | null): Label[] =>
  (list ?? []).map(l => (typeof l === "string" ? { name: l, color: "" } : { name: l.name, color: l.color }));

const pull = (mr: any): PullRequest => ({
  number: mr.iid,
  title: mr.title,
  body: mr.description ?? "",
  state: mr.state === "merged" ? "merged" : mr.state === "opened" ? "open" : "closed",
  draft: mr.draft ?? mr.work_in_progress ?? false,
  author: user(mr.author),
  labels: labels(mr.labels),
  comments: mr.user_notes_count ?? 0,
  sourceBranch: mr.source_branch,
  targetBranch: mr.target_branch,
  headSha: mr.sha,
  baseSha: mr.diff_refs?.base_sha,
  url: mr.web_url,
  createdAt: mr.created_at,
  updatedAt: mr.updated_at,
});

/** GitLab via `glab api`. */
export function gitlab(host: string): Provider {
  const api = async (path: string, opts: { method?: string; body?: unknown } = {}) => {
    const cmd = ["glab", "api", "--hostname", host, path];
    if (opts.method) cmd.push("--method", opts.method);
    if (opts.body !== undefined) cmd.push("--header", "Content-Type: application/json", "--input", "-");
    const { stdout, stderr } = await run(cmd, opts.body === undefined ? undefined : JSON.stringify(opts.body));
    // Older glab versions exit 0 on HTTP errors and only report them on stderr.
    if (/\(HTTP [45]\d\d\)/.test(stderr)) throw cliError(cmd, stderr);
    return stdout.trim() ? JSON.parse(stdout) : null;
  };
  // `glab api --paginate` prints each page as its own JSON array (`[...][...]`), which doesn't parse, so page here.
  const all = async (path: string) => {
    const items: any[] = [];
    for (let page = 1; ; page++) {
      const batch: any[] = await api(`${path}?per_page=100&page=${page}`);
      items.push(...batch);
      if (batch.length < 100) return items;
    }
  };
  const mr = (repo: string, number: number) => `projects/${encodeURIComponent(repo)}/merge_requests/${number}`;

  return {
    whoami: async () => user(await api("user")),

    async listRepos(search) {
      const q = new URLSearchParams({ membership: "true", order_by: "last_activity_at", per_page: "50" });
      if (search) q.set("search", search);
      const projects: any[] = await api(`projects?${q}`);
      return projects.map(
        (p): Repo => ({
          path: p.path_with_namespace,
          description: p.description ?? "",
          url: p.web_url,
          updatedAt: p.last_activity_at,
        }),
      );
    },

    async listPulls(repo, { state, search, author, label, sort, page }) {
      const glState: Record<PullState | "all", string> = { open: "opened", closed: "closed", merged: "merged", all: "all" };
      const q = new URLSearchParams({
        state: glState[state],
        order_by: sort === "updated" ? "updated_at" : "created_at",
        sort: sort === "oldest" ? "asc" : "desc",
        page: String(page),
        per_page: String(pullPageSize),
        with_labels_details: "true",
      });
      if (search) q.set("search", search);
      if (author) q.set("author_username", author);
      if (label) q.set("labels", label);
      const mrs: any[] = await api(`projects/${encodeURIComponent(repo)}/merge_requests?${q}`);
      return { items: mrs.map(pull), nextPage: mrs.length === pullPageSize ? page + 1 : undefined };
    },

    async listLabels(repo) {
      const list: any[] = await all(`projects/${encodeURIComponent(repo)}/labels`);
      return labels(list);
    },

    getPull: async (repo, number) => pull(await api(mr(repo, number))),

    cloneUrl: async repo => (await api(`projects/${encodeURIComponent(repo)}`)).ssh_url_to_repo,

    headRef: number => `refs/merge-requests/${number}/head`,

    async getFiles(repo, number) {
      const diffs: any[] = await all(`${mr(repo, number)}/diffs`);
      return diffs.map(
        (d): FileDiff => ({
          oldPath: d.old_path,
          newPath: d.new_path,
          status: d.new_file ? "added" : d.deleted_file ? "deleted" : d.renamed_file ? "renamed" : "modified",
          patch: (d.diff ?? "").replace(/\n$/, ""),
        }),
      );
    },

    async getFile(repo, path, ref) {
      const file = await api(`projects/${encodeURIComponent(repo)}/repository/files/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`);
      return Buffer.from(file.content, "base64").toString();
    },

    async getCommits(repo, number) {
      // GitLab doesn't link commits to accounts here; the email identifies the author.
      const commits: any[] = await all(`${mr(repo, number)}/commits`);
      return commits.map(c => ({
        sha: c.id,
        authorName: c.author_name,
        authorEmail: c.author_email,
        parents: c.parent_ids?.length ?? 1,
      }));
    },

    async getComments(repo, number) {
      const discussions: any[] = await all(`${mr(repo, number)}/discussions`);
      return discussions
        .flatMap(d => d.notes)
        .filter(n => !n.system)
        .map(
          (n): Comment => ({
            id: String(n.id),
            author: user(n.author),
            body: n.body,
            createdAt: n.created_at,
            position: n.position && {
              path: n.position.new_path,
              oldPath: n.position.old_path,
              oldLine: n.position.old_line ?? undefined,
              newLine: n.position.new_line ?? undefined,
            },
          }),
        );
    },

    async addComment(repo, number, body, position?: LinePosition) {
      if (!position) {
        await api(`${mr(repo, number)}/notes`, { method: "POST", body: { body } });
        return;
      }
      const { diff_refs: refs } = await api(mr(repo, number));
      await api(`${mr(repo, number)}/discussions`, {
        method: "POST",
        body: {
          body,
          position: {
            position_type: "text",
            base_sha: refs.base_sha,
            start_sha: refs.start_sha,
            head_sha: refs.head_sha,
            old_path: position.oldPath,
            new_path: position.path,
            old_line: position.oldLine,
            new_line: position.newLine,
          },
        },
      });
    },
  };
}

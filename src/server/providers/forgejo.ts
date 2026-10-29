import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

/** fj stores logins in its platform data directory (forgejo-cli/src/keys.rs). */
async function readLogins() {
  const home = os.homedir();
  const directories = process.platform === "darwin"
    ? ["forgejo-cli.forgejo-cli", "Cyborus.forgejo-cli"].map(name => path.join(home, "Library/Application Support", name))
    : process.platform === "win32"
      ? ["forgejo-cli", "Cyborus"].map(name => path.join(process.env.APPDATA || path.join(home, "AppData/Roaming"), name, "forgejo-cli/data"))
      : [path.join(process.env.XDG_DATA_HOME && path.isAbsolute(process.env.XDG_DATA_HOME) ? process.env.XDG_DATA_HOME : path.join(home, ".local/share"), "forgejo-cli")];
  for (const directory of directories) {
    let text: string;
    try {
      text = await readFile(path.join(directory, "keys.json"), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new Error("Cannot read fj logins. Check access to forgejo-cli/keys.json.");
    }
    // JSON parse errors can quote token contents; never expose the parser's error to the browser.
    try {
      const data = JSON.parse(text);
      if (!data || typeof data.hosts !== "object" || !data.hosts || Array.isArray(data.hosts)) throw new Error();
      return data as { hosts: Record<string, { type: string; token: string }>; aliases?: Record<string, string> };
    } catch {
      throw new Error("Cannot parse fj logins. Check forgejo-cli/keys.json or log in again with fj auth login.");
    }
  }
  throw new Error("No fj logins found. Run fj auth login first.");
}

async function loginFor(host: string) {
  let url: URL;
  try {
    url = new URL(host.includes("://") ? host : `https://${host}`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
  } catch {
    throw new Error("Use a Forgejo hostname or an HTTP(S) installation URL.");
  }
  let logins = await readLogins();
  const keyOf = (url: URL) => `${url.host}${url.pathname.replace(/\/$/, "")}`;
  const alias = logins.aliases?.[keyOf(url)];
  if (typeof alias === "string") url = new URL(`${url.protocol}//${alias}${url.pathname}`);
  const key = keyOf(url);
  let login = Object.hasOwn(logins.hosts, key) ? logins.hosts[key] : undefined;
  if (login?.type === "OAuth") {
    // Let fj refresh its OAuth token and persist it using its own client ID and expiry format.
    await run(["fj", "--host", url.href, "whoami"]);
    logins = await readLogins();
    login = Object.hasOwn(logins.hosts, key) ? logins.hosts[key] : undefined;
  }
  if (!login || !["Application", "OAuth"].includes(login.type) || typeof login.token !== "string" || !login.token.trim()) {
    throw new Error(`No usable fj login for ${key}. Run fj --host ${url.href} auth login.`);
  }
  return { base: url.href.replace(/\/$/, ""), authorization: `${login.type === "OAuth" ? "Bearer" : "token"} ${login.token}` };
}

/** Forgejo (and Gitea) HTTP API, authenticated with the user's existing fj login. */
export function forgejo(host: string): Provider {
  let login: ReturnType<typeof loginFor> | undefined;
  type Options = { method?: string; body?: unknown; paginate?: boolean };
  const raw = async (endpoint: string, opts: Options = {}) => {
    const { base, authorization } = await (login ??= loginFor(host));
    const response = await fetch(`${base}/api/v1${endpoint}`, {
      method: opts.method ?? "GET",
      headers: { Authorization: authorization, Accept: "application/json", ...(opts.body !== undefined && { "Content-Type": "application/json" }) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(30_000),
      // Never forward credentials to a redirect target.
      redirect: "manual",
    });
    if (!response.ok) {
      await response.body?.cancel();
      const hint = response.status === 401 ? " Log in again with fj auth login."
        : response.status === 403 ? " Check your account and token permissions." : "";
      throw new Error(`Forgejo API ${opts.method ?? "GET"} ${endpoint} failed (HTTP ${response.status}).${hint}`);
    }
    return response.text();
  };
  const api = async (endpoint: string, opts: Options = {}) => {
    const read = async (endpoint: string) => {
      const out = await raw(endpoint, opts);
      return out.trim() ? JSON.parse(out) : null;
    };
    if (!opts.paginate) return read(endpoint);
    const url = new URL(endpoint, "https://forgejo.invalid");
    url.searchParams.set("limit", "100");
    const items: any[] = [];
    for (let page = 1; ; page++) {
      url.searchParams.set("page", String(page));
      const batch = await read(`${url.pathname}${url.search}`);
      if (!Array.isArray(batch)) throw new Error("Forgejo API returned an invalid list.");
      if (!batch.length) return items;
      items.push(...batch);
      // Continue until empty: an instance may cap the requested page size below 100.
    }
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

    async getFile(repo, path, ref) {
      const file = await api(`/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`);
      // The API leaves out the content of files over its blob size limit.
      if (typeof file.content !== "string") throw new Error(`${path} is too large to load`);
      return Buffer.from(file.content, "base64").toString();
    },

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
        // This endpoint returns every review comment and has no pagination parameters.
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

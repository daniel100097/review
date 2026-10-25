export const providerKinds = ["gitlab", "forgejo"] as const;
export type ProviderKind = (typeof providerKinds)[number];

export type PullState = "open" | "closed" | "merged";

export interface User {
  username: string;
  name: string;
  avatarUrl?: string;
}

export interface Repo {
  /** Full path, e.g. `owner/name` or `group/subgroup/project`. */
  path: string;
  description: string;
  url: string;
  updatedAt: string;
}

export interface Label {
  name: string;
  /** CSS color, e.g. `#d73a4a`. */
  color: string;
}

/** A pull request as listed. Branches are missing where the forge's search doesn't return them. */
export interface PullSummary {
  number: number;
  title: string;
  state: PullState;
  draft: boolean;
  author: User;
  labels: Label[];
  comments: number;
  sourceBranch?: string;
  targetBranch?: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface PullRequest extends PullSummary {
  body: string;
  sourceBranch: string;
  targetBranch: string;
  headSha: string;
  /** The commit the diff is taken against (usually the merge base), so `git diff baseSha headSha` is the diff. */
  baseSha: string;
}

export const pullSorts = ["updated", "newest", "oldest"] as const;

export interface PullQuery {
  state: PullState | "all";
  /** Free text, matched against titles and descriptions. */
  search?: string;
  /** Author username. */
  author?: string;
  /** Label name. */
  label?: string;
  sort: (typeof pullSorts)[number];
  /** 1-based. */
  page: number;
}

export const pullPageSize = 30;

export interface FileDiff {
  oldPath: string;
  newPath: string;
  status: "added" | "deleted" | "renamed" | "modified";
  /** Unified diff hunks, starting at the first `@@` line. Empty for binary files. */
  patch: string;
}

/** A line in the diff. Context lines have both numbers, added lines only `newLine`, deleted lines only `oldLine`. */
export interface LinePosition {
  path: string;
  oldPath: string;
  oldLine?: number;
  newLine?: number;
}

export interface Commit {
  sha: string;
  /** Git author; the same person can commit under several names, but usually one email. */
  authorName: string;
  authorEmail: string;
  /** The forge account the author email belongs to, if the forge knows it. */
  user?: User;
  /** Merge commits have more than one parent. */
  parents: number;
}

export interface Comment {
  id: string;
  author: User;
  body: string;
  createdAt: string;
  /** Set for inline comments. */
  position?: LinePosition;
}

/** Where review data comes from. Implementations wrap a forge CLI, which handles auth. */
export interface Provider {
  whoami(): Promise<User>;
  listRepos(search?: string): Promise<Repo[]>;
  /** One page of pull requests; `nextPage` accounts for skipped pages without matching states. */
  listPulls(repo: string, query: PullQuery): Promise<{ items: PullSummary[]; nextPage?: number }>;
  listLabels(repo: string): Promise<Label[]>;
  getPull(repo: string, number: number): Promise<PullRequest>;
  /** URL to `git clone` the repo with the user's own git credentials (SSH). */
  cloneUrl(repo: string): Promise<string>;
  /** The ref the forge keeps at a pull request's head commit, e.g. `refs/pull/1/head`. */
  headRef(number: number): string;
  getFiles(repo: string, number: number): Promise<FileDiff[]>;
  getCommits(repo: string, number: number): Promise<Commit[]>;
  getComments(repo: string, number: number): Promise<Comment[]>;
  addComment(repo: string, number: number, body: string, position?: LinePosition): Promise<void>;
}

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as cli from "./cli";
import { forgejo } from "./forgejo";
import { pullPageSize } from "./types";

// XDG fixtures are Linux-specific; do not fall back to the developer's real login directory.
describe.skipIf(process.platform !== "linux")("Forgejo HTTP transport", () => {
  let directory: string;
  let keys: string;
  let previousDataHome: string | undefined;
  let http: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
  let run: ReturnType<typeof spyOn<typeof cli, "run">>;
  let server: Bun.Server<undefined> | undefined;
  const nativeFetch = globalThis.fetch;

  function respond(handler: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>) {
    http.mockImplementation(handler as typeof fetch);
  }

  async function logins(
    hosts: Record<string, { type: string; token: string }> = { "forge.example": { type: "Application", token: "test-token" } },
    aliases: Record<string, string> = {},
  ) {
    await writeFile(keys, JSON.stringify({ hosts, aliases }));
  }

  beforeEach(async () => {
    previousDataHome = process.env.XDG_DATA_HOME;
    directory = await mkdtemp(path.join(os.tmpdir(), "forgejo-http-test-"));
    process.env.XDG_DATA_HOME = directory;
    await mkdir(path.join(directory, "forgejo-cli"));
    keys = path.join(directory, "forgejo-cli", "keys.json");
    await logins();
    http = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected HTTP request"));
    run = spyOn(cli, "run").mockRejectedValue(new Error("Unexpected forge CLI invocation"));
  });

  afterEach(async () => {
    http?.mockRestore();
    run?.mockRestore();
    await server?.stop(true);
    server = undefined;
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    await rm(directory, { recursive: true, force: true });
  });

  test("reads fj application credentials and authenticates HTTP without invoking fj", async () => {
    http.mockResolvedValue(Response.json({ login: "alice", full_name: "Alice", avatar_url: "https://forge.example/alice.png" }));
    expect(await forgejo("forge.example").whoami()).toEqual({
      username: "alice", name: "Alice", avatarUrl: "https://forge.example/alice.png",
    });
    expect(http).toHaveBeenCalledTimes(1);
    const [url, init] = http.mock.calls[0]!;
    expect(url).toBe("https://forge.example/api/v1/user");
    expect(init).toMatchObject({ method: "GET", redirect: "manual" });
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("token test-token");
    expect(headers.get("Accept")).toBe("application/json");
    expect(run).not.toHaveBeenCalled();
  });

  test.each(["closed", "merged"] as const)("skips pages without %s PRs and preserves the next page", async state => {
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
    respond(async input => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/api/v1/repos/owner/repo/pulls");
      const page = Number(url.searchParams.get("page"));
      requested.push(page);
      return Response.json(pages[page - 1]);
    });
    const provider = forgejo("forge.example");
    const first = await provider.listPulls("owner/repo", { state, sort: "updated", page: 1 });
    expect(first.items.map(p => [p.number, p.state])).toEqual([[31, state]]);
    expect(first.nextPage).toBe(3);
    const last = await provider.listPulls("owner/repo", { state, sort: "updated", page: first.nextPage! });
    expect(last).toEqual({ items: [], nextPage: undefined });
    expect(requested).toEqual([1, 2, 3, 4]);
    expect(run).not.toHaveBeenCalled();
  });

  test("searches labeled PRs without requiring branch data", async () => {
    http.mockResolvedValue(Response.json([{ number: 7, state: "closed", pull_request: { merged: true }, user: { login: "alice" },
      labels: [{ name: "needs review", color: "abcdef" }], comments: 3 }]));
    const result = await forgejo("forge.example").listPulls("owner/repo", {
      state: "merged", search: "fix checkout", label: "needs review", author: "alice", sort: "oldest", page: 1,
    });
    const url = new URL(String(http.mock.calls[0]![0]));
    expect(url.pathname).toBe("/api/v1/repos/owner/repo/issues");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      type: "pulls", q: "fix checkout", labels: "needs review", created_by: "alice", state: "closed", sort: "oldest",
    });
    expect(result.items[0]).toMatchObject({ number: 7, state: "merged", comments: 3, labels: [{ name: "needs review", color: "#abcdef" }] });
    expect(result.items[0]?.sourceBranch).toBeUndefined();
    expect(result.nextPage).toBeUndefined();
  });

  test("loads a file at a commit with an encoded path and ref", async () => {
    http.mockResolvedValue(Response.json({ content: btoa("a\nb\n") }));
    expect(await forgejo("forge.example").getFile("owner/repo", "src/a b.ts", "feature/a b")).toBe("a\nb\n");
    expect(http.mock.calls[0]![0]).toBe("https://forge.example/api/v1/repos/owner/repo/contents/src/a%20b.ts?ref=feature%2Fa%20b");
  });

  test("parses the raw .diff response into files", async () => {
    http.mockResolvedValue(new Response(
      "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n" +
      "diff --git a/b.ts b/b.ts\nnew file mode 100644\n--- /dev/null\n+++ b/b.ts\n@@ -0,0 +1 @@\n+added\n",
      { headers: { "Content-Type": "text/plain" } },
    ));
    expect(await forgejo("forge.example").getFiles("owner/repo", 7)).toEqual([
      { oldPath: "a.ts", newPath: "a.ts", status: "modified", patch: "@@ -1 +1 @@\n-old\n+new" },
      { oldPath: "b.ts", newPath: "b.ts", status: "added", patch: "@@ -0,0 +1 @@\n+added" },
    ]);
    expect(http.mock.calls[0]![0]).toBe("https://forge.example/api/v1/repos/owner/repo/pulls/7.diff");
  });

  test("uses the canonical alias, port and path prefix for real HTTP and JSON comment posts", async () => {
    const received: { url: string; method: string; authorization: string | null; contentType: string | null; body: unknown }[] = [];
    server = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      async fetch(request) {
        received.push({
          url: request.url, method: request.method, authorization: request.headers.get("Authorization"),
          contentType: request.headers.get("Content-Type"), body: request.method === "POST" ? await request.json() : undefined,
        });
        return request.method === "POST" ? new Response(null, { status: 204 }) : Response.json({ login: "alice" });
      },
    });
    const canonical = server.url.host;
    await logins({ [`${canonical}/forge`]: { type: "Application", token: "test-token" } }, { "alias.example/forge": canonical });
    respond(async (input, init) => {
      expect(new URL(String(input)).origin).toBe(server!.url.origin);
      return nativeFetch(input, init);
    });
    const provider = forgejo("http://alias.example/forge/");
    expect(await provider.whoami()).toMatchObject({ username: "alice" });
    await provider.addComment("owner/repo", 7, "General: café\nsecond line");
    await provider.addComment("owner/repo", 7, "new line", { path: "src/a b.ts", oldPath: "src/a b.ts", oldLine: 4, newLine: 5 });
    await provider.addComment("owner/repo", 7, "deleted line", { path: "src/a b.ts", oldPath: "src/a b.ts", oldLine: 8 });
    expect(received.map(({ url, method, body }) => ({ url, method, body }))).toEqual([
      { url: `${server.url.origin}/forge/api/v1/user`, method: "GET", body: undefined },
      { url: `${server.url.origin}/forge/api/v1/repos/owner/repo/issues/7/comments`, method: "POST", body: { body: "General: café\nsecond line" } },
      { url: `${server.url.origin}/forge/api/v1/repos/owner/repo/pulls/7/reviews`, method: "POST", body: {
        event: "COMMENT", body: "", comments: [{ path: "src/a b.ts", body: "new line", new_position: 5, old_position: 0 }],
      } },
      { url: `${server.url.origin}/forge/api/v1/repos/owner/repo/pulls/7/reviews`, method: "POST", body: {
        event: "COMMENT", body: "", comments: [{ path: "src/a b.ts", body: "deleted line", new_position: 0, old_position: 8 }],
      } },
    ]);
    expect(received.map(r => r.authorization)).toEqual(Array(4).fill("token test-token"));
    expect(received.slice(1).map(r => r.contentType)).toEqual(Array(3).fill("application/json"));
    expect(run).not.toHaveBeenCalled();
  });

  test("paginates labels and commits through capped pages until the first empty page", async () => {
    const requested: Record<string, number[]> = { labels: [], commits: [] };
    respond(async input => {
      const url = new URL(String(input));
      const kind = url.pathname.endsWith("/labels") ? "labels" : "commits";
      const page = Number(url.searchParams.get("page"));
      requested[kind]!.push(page);
      expect(url.searchParams.get("limit")).toBe("100");
      if (kind === "commits") expect(Object.fromEntries(url.searchParams)).toMatchObject({ files: "false", stat: "false", verification: "false" });
      if (page > 3) throw new Error("Fetched after the empty page");
      return Response.json(page === 3 ? [] : kind === "labels" ? [{ name: `label-${page}`, color: "abcdef" }] : [{
        sha: `sha-${page}`, commit: { author: { name: "Alice", email: "alice@example.test" } },
        author: { login: "alice" }, parents: [{ sha: "base" }],
      }]);
    });
    const provider = forgejo("forge.example");
    expect(await provider.listLabels("owner/repo")).toEqual([
      { name: "label-1", color: "#abcdef" }, { name: "label-2", color: "#abcdef" },
    ]);
    expect((await provider.getCommits("owner/repo", 7)).map(c => c.sha)).toEqual(["sha-1", "sha-2"]);
    expect(requested).toEqual({ labels: [1, 2, 3], commits: [1, 2, 3] });
  });

  test("paginates reviews but fetches issue comments and each review's comments only once", async () => {
    const requested: string[] = [];
    const user = { login: "alice" };
    respond(async input => {
      const url = new URL(String(input));
      requested.push(url.pathname + url.search);
      if (url.pathname.endsWith("/issues/7/comments")) return Response.json([
        { id: 1, user, body: "general", created_at: "2026-01-01" },
      ]);
      if (url.pathname.endsWith("/reviews")) {
        const page = Number(url.searchParams.get("page"));
        expect(url.searchParams.get("limit")).toBe("100");
        if (page > 3) throw new Error("Fetched after the empty page");
        return Response.json(page === 3 ? [] : [{
          id: page + 10, user, body: page === 1 ? "review" : "", comments_count: 1, submitted_at: "2026-01-04",
        }]);
      }
      if (url.pathname.endsWith("/reviews/11/comments")) return Response.json([
        { id: 2, user, body: "new line", created_at: "2026-01-02", path: "a.ts", position: 5, original_position: 4 },
      ]);
      if (url.pathname.endsWith("/reviews/12/comments")) return Response.json([
        { id: 3, user, body: "old line", created_at: "2026-01-03", path: "a.ts", position: 0, original_position: 8 },
      ]);
      throw new Error(`Unexpected endpoint: ${url.pathname}`);
    });
    const comments = await forgejo("forge.example").getComments("owner/repo", 7);
    expect(comments.map(c => [c.id, c.body])).toEqual([["1", "general"], ["2", "new line"], ["3", "old line"], ["11", "review"]]);
    expect(comments[1]?.position).toEqual({ path: "a.ts", oldPath: "a.ts", newLine: 5, oldLine: undefined });
    expect(comments[2]?.position).toEqual({ path: "a.ts", oldPath: "a.ts", newLine: undefined, oldLine: 8 });
    expect(requested.filter(url => url.includes("/reviews?"))).toEqual([1, 2, 3].map(page => `/api/v1/repos/owner/repo/pulls/7/reviews?limit=100&page=${page}`));
    expect(requested.filter(url => url.includes("/comments"))).toEqual([
      "/api/v1/repos/owner/repo/issues/7/comments",
      "/api/v1/repos/owner/repo/pulls/7/reviews/11/comments",
      "/api/v1/repos/owner/repo/pulls/7/reviews/12/comments",
    ]);
  });

  test("refreshes OAuth through supported fj whoami and reads the new token", async () => {
    await logins({ "forge.example": { type: "OAuth", token: "old-test-token" } });
    run.mockImplementation(async cmd => {
      expect(cmd).toEqual(["fj", "--host", "https://forge.example/", "whoami"]);
      await logins({ "forge.example": { type: "OAuth", token: "refreshed-test-token" } });
      return { stdout: "alice", stderr: "" };
    });
    respond(async () => Response.json({ login: "alice" }));
    const provider = forgejo("forge.example");
    await provider.whoami();
    await provider.whoami();
    expect(run).toHaveBeenCalledTimes(1);
    expect(http).toHaveBeenCalledTimes(2);
    for (const [, init] of http.mock.calls) expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer refreshed-test-token");
  });

  test.each(['{"hosts":{"forge.example":{"token":"malformed-test-secret"}}} trailing', '{"hosts":[]}'])(
    "rejects malformed credential data without exposing its contents (%#)", async data => {
      await writeFile(keys, data);
      await expect(forgejo("forge.example").whoami()).rejects.toEqual(
        new Error("Cannot parse fj logins. Check forgejo-cli/keys.json or log in again with fj auth login."),
      );
      expect(http).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    },
  );

  test.each([401, 403, 500])("reports HTTP %i without exposing a response body or token", async status => {
    http.mockResolvedValue(new Response("private-response-secret token test-token", { status }));
    const hint = status === 401 ? " Log in again with fj auth login." : status === 403 ? " Check your account and token permissions." : "";
    await expect(forgejo("forge.example").whoami()).rejects.toEqual(new Error(`Forgejo API GET /user failed (HTTP ${status}).${hint}`));
  });
});

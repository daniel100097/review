import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const executable = path.resolve(process.argv[2] ?? "dist/codereview-ui");
const scratch = await mkdtemp(path.join(os.tmpdir(), "codereview-smoke-"));
const env = {
  ...process.env,
  PATH: "",
  DATABASE_PATH: undefined,
  CLAUDE_CODE_EXECUTABLE: undefined,
  CODEX_PATH: undefined,
  XDG_DATA_HOME: path.join(scratch, "data"),
  XDG_CACHE_HOME: path.join(scratch, "cache"),
  HOST: "127.0.0.1",
  PORT: "0",
};

try {
  // These must work without loading a database, installed CLIs, or source files.
  for (const args of [["--version"], ["--acp-agent", "claude", "--version"], ["--acp-agent", "codex", "--version"]]) {
    const child = Bun.spawn([executable, ...args], { cwd: scratch, env, stdout: "pipe", stderr: "pipe", timeout: 15_000 });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    assert.equal(code, 0, `${args.join(" ")}: ${stderr}`);
    assert.match(stdout, /\d+\.\d+\.\d+/);
  }

  const server = Bun.spawn([executable], { cwd: scratch, env, stdout: "pipe", stderr: "pipe" });
  const stderr = new Response(server.stderr).text();
  const startupTimeout = setTimeout(() => server.kill(), 15_000);
  try {
    const reader = server.stdout.pipeThrough(new TextDecoderStream()).getReader();
    let output = "";
    let url: string | undefined;
    while (!url) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error(`Server exited before starting: ${await stderr}`);
      output += chunk.value;
      url = output.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
    }
    clearTimeout(startupTimeout);
    const get = async (pathname: string) => {
      const response = await fetch(new URL(pathname, url), { signal: AbortSignal.timeout(10_000) });
      assert.equal(response.status, 200, pathname);
      return response;
    };
    const html = await (await get("/")).text();
    assert.match(html, /<title>Code Review<\/title>/);
    const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(match => match[1]!);
    assert(assets.some(asset => asset.endsWith(".js")), "Frontend JavaScript is bundled");
    assert(assets.some(asset => asset.endsWith(".css")), "Frontend CSS is bundled");
    for (const asset of assets) {
      const body = await (await get(asset)).text();
      assert(body.length > 0, asset);
      if (asset.endsWith(".css")) assert(!/@(?:apply|tailwind|theme)\b/.test(body), "Tailwind is compiled");
    }
    const sources = await (await get("/trpc/sources.list")).json();
    assert.deepEqual(sources.result.data, [], "The binary ships with no configured sources");
    const database = new Database(path.join(env.XDG_DATA_HOME, "codereview-ui", "codereview.sqlite"), { readonly: true });
    try {
      const tables = database.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'").all();
      for (const name of ["sources", "viewed_files", "hidden_folders", "question_threads", "question_messages", "walkthroughs"]) {
        assert(tables.some(table => table.name === name), `Migration created ${name}`);
      }
    } finally {
      database.close();
    }
  } finally {
    clearTimeout(startupTimeout);
    server.kill();
    await server.exited;
  }
  console.log("Standalone smoke check passed.");
} finally {
  await rm(scratch, { recursive: true, force: true });
}

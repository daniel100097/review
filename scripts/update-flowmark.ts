import { mkdtemp, mkdir, copyFile, chmod, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import path from "node:path";

const revision = "ea687064a93ccf70d2d3234a63877032889dcdf8";
const scratch = await mkdtemp(path.join(tmpdir(), "codereview-flowmark-"));
const target = path.join(process.env.XDG_CACHE_HOME ?? path.join(homedir(), ".cache"), "codereview-ui", "flowmark-target");
const output = path.resolve(import.meta.dir, "../src/vendor/flowmark");
async function run(args: string[], cwd = scratch) {
  const child = Bun.spawn(args, { cwd, env: { ...process.env, CARGO_TARGET_DIR: target }, stdout: "inherit", stderr: "inherit" });
  if (await child.exited) throw new Error(`${args[0]} failed`);
}
try {
  await run(["git", "clone", "https://github.com/daniel100097/flowmark.git", "."]);
  await run(["git", "checkout", "--detach", revision]);
  await run(["rustup", "target", "add", "wasm32-unknown-unknown"]);
  await run(["cargo", "build", "-p", "flowmark_wasm", "--target", "wasm32-unknown-unknown", "--profile", "wasm", "--locked"]);
  await mkdir(output, { recursive: true });
  for (const [source, name] of [
    ["viewer/viewer.js", "viewer.js.txt"], ["viewer/viewer.css", "viewer.css.txt"],
    ["SPEC.md", "spec.txt"], ["prelude.d.ts", "prelude.txt"],
    ["examples/register-user.review.ts", "example.txt"],
    ["skills/flowmark-review/SKILL.md", "SKILL.md.txt"],
    ["skills/flowmark-review/reference/levels.md", "levels.txt"],
    ["skills/flowmark-review/examples/t3code-update-server-settings.review.ts", "rpc-example.txt"],
  ]) await copyFile(path.join(scratch, source!), path.join(output, name!));
  await copyFile(path.join(target, "wasm32-unknown-unknown/wasm/flowmark_wasm.wasm"), path.join(output, "flowmark.wasm"));
  await chmod(path.join(output, "flowmark.wasm"), 0o644);
  const compiler = path.dirname(Bun.resolveSync("typescript-flowmark/package.json", path.resolve(import.meta.dir, "..")));
  const libs: Record<string, string> = {};
  async function readLib(name: string) {
    if (libs[name]) return;
    const text = await Bun.file(path.join(compiler, "lib", name)).text();
    libs[name] = text;
    for (const ref of text.matchAll(/<reference lib="([^"]+)"/g)) await readLib(`lib.${ref[1]}.d.ts`);
  }
  await readLib("lib.es2022.d.ts");
  await Bun.write(path.join(output, "typescript-libs.json"), JSON.stringify(libs));
  console.log(`Flowmark assets updated to ${revision}`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}

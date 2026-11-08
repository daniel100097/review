import { afterEach, expect, mock, spyOn, test } from "bun:test";
import example from "../../vendor/flowmark/example.txt";
import type { PullRequest } from "../providers/types";
import * as acp from "./acp";
import { handleMcp } from "./mcp";
import { flowmarkPrompt, writeFlowmark } from "./flowmark";

afterEach(() => mock.restore());
const pull = {
  number: 7, title: "Change retries", body: "Untrusted PR body", baseSha: "a".repeat(40), headSha: "b".repeat(40),
} as PullRequest;
const files = [{ oldPath: "src/mail.ts", newPath: "src/mail.ts", status: "modified" as const, patch: "@@ -1 +1 @@\n-retries: 2\n+retries: 5" }];
const options = () => ({
  agent: "codex" as const, model: "test", mode: "changes" as const, request: "Explain queued mail", pull, files,
  signal: new AbortController().signal, onActivity: () => {}, readSource: async () => "const retries = 5;",
});
async function call(url: string, name: string, args: unknown) {
  if (name === "submit_flowmark") args = {
    report: { capability: "Queued mail", omitted: [], specGaps: [], unverifiedRefs: [], retainedWarnings: ["W060: passing raw input is an intentional risk in this example."] },
    ...(args as object),
  };
  return handleMcp(new Request(url, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }), new URL(url).pathname.split("/").at(-1)!);
}

test("requires real base/head reads and valid checker output before accepting a Changes review", async () => {
  let url = "";
  const reads: unknown[] = [];
  spyOn(acp, "runAgent").mockImplementation(async run => {
    expect(run.tools).toEqual([]);
    expect(run.allowedTools).toEqual(["read_flowmark_source", "preview_flowmark", "submit_flowmark"]);
    expect(run.allowReadOnlyCommands).toBeFalsy();
    url = (run.mcpServers![0] as { url: string }).url;
    const submit = async (args: unknown) => (await (await call(url, "submit_flowmark", args)).json()).result;
    await run.prompts(async prompt => {
      expect(prompt).toContain("Explain queued mail");
      expect(prompt).toContain(pull.baseSha);
      expect(prompt).toContain("Untrusted PR body");
      expect(prompt).toContain("fixed vocabulary");
      expect((await submit({ base: "", head: example })).isError).toBe(true);
      expect((await submit({ base: example, head: example })).isError).toBe(true);
      const badPath = await (await call(url, "read_flowmark_source", { side: "head", path: "../secret" })).json();
      expect(badPath.result.isError).toBe(true);
      for (const side of ["base", "head"] as const) {
        const read = await (await call(url, "read_flowmark_source", { side, path: "src/mail.ts" })).json();
        expect(read.result.isError).not.toBe(true);
        expect(read.result.content[0].text).toContain(side === "base" ? pull.baseSha : pull.headSha);
      }
      const invalid = await submit({ base: "not a valid Flowmark review", head: example });
      expect(invalid.isError).toBe(true);
      expect(invalid.content[0].text).toContain("before:");
      const preview = await (await call(url, "preview_flowmark", { base: example, head: example.replace("retries: 2", "retries: 5") })).json();
      expect(preview.result.isError).toBe(false);
      const views = JSON.parse(preview.result.content[0].text).views;
      expect(views.head.card).toContain("Register user");
      expect(views.head.flow).toContain("registerUser");
      expect((await submit({ base: example, head: example.replace("retries: 2", "retries: 5") })).isError).not.toBe(true);
      return "end_turn";
    }, { resumed: false });
  });
  const result = await writeFlowmark({ ...options(), readSource: async (side, path) => { reads.push([side, path]); return "real source"; } });
  expect(reads).toEqual([["base", "src/mail.ts"], ["head", "src/mail.ts"]]);
  expect(result.base).toBe(example);
  expect(result.head).toContain("retries: 5");
  expect(result.result.changes).toMatchObject({ lines_added: 1, lines_removed: 1 });
  expect((await call(url, "submit_flowmark", { base: example, head: example })).status).toBe(404);
});

test("walkthrough submits one current document and keeps warnings as review findings", async () => {
  spyOn(acp, "runAgent").mockImplementation(async run => {
    const url = (run.mcpServers![0] as { url: string }).url;
    await call(url, "read_flowmark_source", { side: "head", path: "src/mail.ts" });
    await run.prompts(async prompt => {
      expect(prompt).toContain("Leave base empty");
      const result = await (await call(url, "submit_flowmark", { base: "", head: example })).json();
      expect(result.result.isError).not.toBe(true);
      return "end_turn";
    }, { resumed: false });
  });
  const result = await writeFlowmark({ ...options(), mode: "walkthrough" });
  expect(result.base).toBe("");
  expect(result.result.sides).toBeUndefined();
  expect(result.result.diagnostics.some(d => d.code === "W060")).toBe(true);
});

test.each(["missing", "failure", "cancelled"] as const)("cleans up tools after %s", async outcome => {
  let url = "";
  let prompts = 0;
  const abort = new AbortController();
  spyOn(acp, "runAgent").mockImplementation(async run => {
    url = (run.mcpServers![0] as { url: string }).url;
    if (outcome === "failure") throw new Error("Agent unavailable");
    await run.prompts(async () => { prompts++; if (outcome === "cancelled") { abort.abort(); return "cancelled"; } return "end_turn"; }, { resumed: false });
  });
  await expect(writeFlowmark({ ...options(), signal: abort.signal })).rejects.toThrow();
  expect(prompts).toBe(outcome === "missing" ? 2 : outcome === "failure" ? 0 : 1);
  expect((await call(url, "submit_flowmark", { base: example, head: example })).status).toBe(404);
});

test("bounds giant diffs and explicitly tells the agent to read full files", () => {
  const text = flowmarkPrompt(options(), [{ ...files[0]!, patch: "x".repeat(300_000) }]);
  expect(text.length).toBeLessThan(310_000);
  expect(text).toContain("diff truncated; use read_flowmark_source");
});

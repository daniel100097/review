import { afterEach, expect, mock, spyOn, test } from "bun:test";
import type { FilterContext } from "@/lib/filter-rules";
import * as acp from "./acp";
import { generateFilterRules } from "./filter-rules";
import { handleMcp } from "./mcp";

afterEach(() => mock.restore());

const opts = { agent: "codex" as const, model: "test-model", request: "Hide Markdown files" };
const rules = { version: 1 as const, rules: [{ name: "Markdown", paths: ["**/*.md"] }] };
const context: FilterContext = {
  title: "hosting-manager #2099",
  body: "Adapt the hosting response wrapper.",
  files: [{
    newPath: "src/hosting.ts",
    patchHash: "hosting-patch",
    patch: "@@ -10,5 +10,5 @@\n-const value = previous;\n-return value;\n+const value = current;\n+return value;\n keep();\n+added();\n keep();\n-deleted();",
  }],
};
const selection = { path: "src/hosting.ts", patchHash: "hosting-patch", oldLine: 10, newLine: 10 };

function callTool(url: string, name: string, input: unknown) {
  return handleMcp(
    new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: input } }),
    }),
    new URL(url).pathname.split("/").at(-1)!,
  );
}

const submit = (url: string, input: unknown) => callTool(url, "submit_filter_rules", input);

test("validates submissions over MCP, retries once, and disposes the run", async () => {
  let url = "";
  const prompts: string[] = [];
  spyOn(acp, "runAgent").mockImplementation(async run => {
    expect(run.config).toEqual({ model: opts.model });
    expect(run.tools).toEqual([]);
    expect(run.allowedTools).toEqual(["submit_filter_rules", "read_filter_diff"]);
    expect(run.allowReadOnlyCommands).toBeFalsy();
    url = (run.mcpServers![0] as { url: string }).url;
    await run.prompts(async text => {
      prompts.push(text);
      if (prompts.length === 1) {
        for (const invalid of [
          { ...rules, code: "return true" },
          { version: 1, rules: [{ name: "Markdown", paths: ["**/*.md"], regex: ".*" }] },
          { ...rules, version: 2 },
          { version: 1, rules: [{ name: "Mixed selectors", paths: ["**/*.ts"], changes: [selection] }] },
          { version: 1, rules: [{ name: "Too many selections", changes: Array(2001).fill(selection) }] },
        ]) {
          const response = await (await submit(url, invalid)).json();
          expect(response.result.isError).toBe(true);
        }
      } else {
        const response = await (await submit(url, rules)).json();
        expect(response.result.isError).not.toBe(true);
      }
      return "end_turn";
    }, { resumed: false });
  });

  expect(await generateFilterRules(opts)).toEqual(rules);
  expect(prompts).toHaveLength(2);
  expect(prompts[0]).toContain(opts.request);
  expect(prompts[0]).toContain("instead of writing final JSON");
  expect((await submit(url, rules)).status).toBe(404);
});

test("supplies PR context, reads only supplied diffs, and validates every exact selection before accepting", async () => {
  let url = "";
  const request = "I dont want random changes that are not real, only show real changes and not add object just for wrapping";
  const exactRules = {
    version: 1 as const,
    summary: "Selected only inspected changes.",
    rules: [{
      name: "Selected blocks",
      reason: "These blocks were inspected in the supplied diff.",
      changes: [selection, { ...selection, oldLine: null, newLine: 13 }, { ...selection, oldLine: 14, newLine: null }],
    }],
  };
  spyOn(acp, "runAgent").mockImplementation(async run => {
    url = (run.mcpServers![0] as { url: string }).url;
    expect(run.tools).toEqual([]);
    expect(run.allowReadOnlyCommands).toBeFalsy();
    let turns = 0;
    await run.prompts(async prompt => {
      turns++;
      expect(prompt).toContain(request);
      expect(prompt).toContain(context.title);
      expect(prompt).toContain(context.body);
      expect(prompt).toContain(selection.path);
      expect(prompt).toContain(selection.patchHash);
      expect(prompt).toContain("const value = previous;");
      expect(prompt).toContain("use exact changes selections only");
      expect(prompt).toContain("values and behavior are preserved");
      expect(prompt).toContain("Keep changes affecting methods, authentication/authorization, validation, caching, or contracts visible");

      const read = await (await callTool(url, "read_filter_diff", { path: selection.path })).json();
      expect(read.result.isError).not.toBe(true);
      expect(read.result.content[0].text).toContain(selection.patchHash);
      expect(read.result.content[0].text).toContain("const value = previous;");
      expect(read.result.content[0].text).toContain("const value = current;");
      const missing = await (await callTool(url, "read_filter_diff", { path: "../../etc/passwd" })).json();
      expect(missing.result.isError).toBe(true);

      for (const invalid of [
        { ...selection, path: "src/unknown.ts" },
        { ...selection, patchHash: "stale-patch" },
        { ...selection, oldLine: 12, newLine: 12 }, // Context line, not a change.
        { ...selection, oldLine: 11, newLine: 11 }, // Inside a block, not its first lines.
        { ...selection, oldLine: null },
        { ...selection, oldLine: 13, newLine: 13 }, // Additions have no old coordinate.
      ]) {
        const response = await (await submit(url, { version: 1, rules: [{ name: "Invalid", changes: [selection, invalid] }] })).json();
        expect(response.result.isError).toBe(true);
        expect(response.result.content[0].text).toContain("Invalid change selection");
        expect(response.result.content[0].text).toContain("read_filter_diff");
      }
      const saved = await (await submit(url, exactRules)).json();
      expect(saved.result.isError).not.toBe(true);
      await submit(url, rules); // A second submission must not overwrite the accepted result.
      return "end_turn";
    }, { resumed: false });
    expect(turns).toBe(1);
  });

  expect(await generateFilterRules({ ...opts, request, context })).toEqual(exactRules);
  expect((await callTool(url, "read_filter_diff", { path: selection.path })).status).toBe(404);
  expect((await submit(url, exactRules)).status).toBe(404);
});

test("rejects exact selections without PR context and accepts an empty result with a normal summary", async () => {
  let url = "";
  let turns = 0;
  spyOn(acp, "runAgent").mockImplementation(async run => {
    url = (run.mcpServers![0] as { url: string }).url;
    await run.prompts(async () => {
      turns++;
      const invalid = await (await submit(url, { version: 1, rules: [{ name: "Unknown", changes: [selection] }] })).json();
      expect(invalid.result.isError).toBe(true);
      const saved = await (await submit(url, { version: 1, rules: [] })).json();
      expect(saved.result.isError).not.toBe(true);
      return "end_turn";
    }, { resumed: false });
  });

  expect(await generateFilterRules(opts)).toEqual({ version: 1, rules: [], summary: "No confidently irrelevant changes found" });
  expect(turns).toBe(1);
  expect((await submit(url, rules)).status).toBe(404);
});

test("the diff reader omits oversized blocks and still exposes later complete blocks", async () => {
  const file = {
    ...context.files[0]!,
    patch: `@@ -1,3 +1,3 @@\n-${"x".repeat(240_000)}\n+largeReplacement();\n keep();\n-before();\n+after();`,
  };
  spyOn(acp, "runAgent").mockImplementation(async run => {
    const url = (run.mcpServers![0] as { url: string }).url;
    await run.prompts(async () => {
      const response = await (await callTool(url, "read_filter_diff", { path: file.newPath })).json();
      const text = response.result.content[0].text;
      expect(response.result.isError).not.toBe(true);
      expect(text.length).toBeLessThanOrEqual(240_000);
      expect(text).not.toContain("largeReplacement");
      expect(text).toContain("-before();\n+after();");
      expect(text).toContain("Omitted blocks: 1");
      const omitted = await (await submit(url, {
        version: 1, rules: [{ name: "Unread block", changes: [{ path: file.newPath, patchHash: file.patchHash, oldLine: 1, newLine: 1 }] }],
      })).json();
      expect(omitted.result.isError).toBe(true);
      expect(omitted.result.content[0].text).toContain("omitted blocks must remain visible");
      await submit(url, { version: 1, rules: [], summary: "The oversized block remains visible." });
      return "end_turn";
    }, { resumed: false });
  });

  expect(await generateFilterRules({ ...opts, context: { ...context, files: [file] } })).toEqual({
    version: 1, rules: [], summary: "The oversized block remains visible.",
  });
});

test.each(["missing", "error", "cancelled", "cancelled after submission"] as const)("cleans up after %s results", async outcome => {
  let url = "";
  let turns = 0;
  const controller = new AbortController();
  spyOn(acp, "runAgent").mockImplementation(async run => {
    url = (run.mcpServers![0] as { url: string }).url;
    expect(run.signal).toBe(controller.signal);
    if (outcome === "error") throw new Error("Agent failed");
    await run.prompts(async () => {
      turns++;
      if (outcome === "cancelled after submission") await submit(url, rules);
      if (outcome.startsWith("cancelled")) {
        controller.abort();
        return "cancelled";
      }
      return "end_turn";
    }, { resumed: false });
  });

  const errors = {
    missing: "finished without submitting filter rules",
    error: "Agent failed",
    cancelled: "Cancelled",
    "cancelled after submission": "Cancelled",
  };
  await expect(generateFilterRules({ ...opts, signal: controller.signal })).rejects.toThrow(errors[outcome]);
  expect(turns).toBe(outcome === "missing" ? 2 : outcome === "error" ? 0 : 1);
  expect((await submit(url, rules)).status).toBe(404);
});

test("does not start an agent when already cancelled", async () => {
  const run = spyOn(acp, "runAgent");
  await expect(generateFilterRules({ ...opts, signal: AbortSignal.abort() })).rejects.toThrow("Cancelled");
  expect(run).not.toHaveBeenCalled();
});

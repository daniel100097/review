import { afterEach, expect, mock, spyOn, test } from "bun:test";

// Use a separate module instance so tests need no installed/login-ready CLI.
const executable = process.env.CODEX_PATH;
process.env.CODEX_PATH = process.execPath;
const modulePath = "./acp.ts?cancellation-tests";
const { runAgent }: typeof import("./acp") = await import(modulePath);
if (executable === undefined) delete process.env.CODEX_PATH;
else process.env.CODEX_PATH = executable;

const spawn = Bun.spawn;
const children: Bun.PipedSubprocess[] = [];
afterEach(async () => {
  mock.restore();
  for (const child of children.splice(0)) {
    child.kill("SIGKILL");
    await child.exited;
  }
});

function adapter(stallAt: string, ignoreTermination = false) {
  const reached = Promise.withResolvers<void>();
  const child = spawn([process.execPath, "-e", `
    const { createInterface } = require("node:readline");
    if (${ignoreTermination}) process.on("SIGTERM", () => {});
    const configOptions = [{
      id: "model", name: "Model", type: "select", currentValue: "test",
      options: [{ value: "test", name: "Test" }],
    }];
    createInterface({ input: process.stdin }).on("line", line => {
      const { id, method } = JSON.parse(line);
      if (method === ${JSON.stringify(stallAt)}) {
        process.send(method);
        return;
      }
      if (id === undefined) return; // Ignore session/cancel, like an unresponsive agent.
      const result = method === "initialize" ? { protocolVersion: 1, agentCapabilities: {} }
        : method === "session/prompt" ? { stopReason: "end_turn" }
        : { sessionId: "test-session", configOptions };
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
    });
  `], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    ipc: () => reached.resolve(),
  });
  children.push(child);
  spyOn(Bun, "spawn").mockReturnValue(child);
  return { child, reached: reached.promise };
}

const options = { agent: "codex" as const, cwd: import.meta.dir, config: { model: "test" } };

test("an already aborted run resolves without spawning or sending prompts", async () => {
  const spawn = spyOn(Bun, "spawn");
  const prompts = mock(async () => {});
  await expect(runAgent({ ...options, signal: AbortSignal.abort(), prompts })).resolves.toBeUndefined();
  expect(spawn).not.toHaveBeenCalled();
  expect(prompts).not.toHaveBeenCalled();
});

test.each(["initialize", "session/new", "session/resume", "session/set_config_option", "session/prompt"])(
  "cancels a stalled %s request and waits for subprocess exit",
  async method => {
    const { child, reached } = adapter(method);
    const abort = new AbortController();
    const prompts = mock(async (send: (text: string) => Promise<unknown>) => { await send("hello"); });
    const result = runAgent({
      ...options,
      resume: method === "session/resume" ? "test-session" : undefined,
      signal: abort.signal,
      prompts,
    });
    await reached;
    abort.abort();
    await expect(result).resolves.toBeUndefined();
    expect(child.signalCode).toBe("SIGTERM");
    expect(prompts).toHaveBeenCalledTimes(method === "session/prompt" ? 1 : 0);
  },
  2_000,
);

test("force kills a prompt that ignores both cancellation and SIGTERM", async () => {
  const { child, reached } = adapter("session/prompt", true);
  const abort = new AbortController();
  const result = runAgent({ ...options, signal: abort.signal, prompts: async send => { await send("hello"); } });
  await reached;
  abort.abort();
  await expect(result).resolves.toBeUndefined();
  expect(child.signalCode).toBe("SIGKILL");
}, 8_000);

test("a failed cancellation notification does not reject the run", async () => {
  const { child, reached } = adapter("session/prompt");
  const abort = new AbortController();
  const result = runAgent({ ...options, signal: abort.signal, prompts: async send => { await send("hello"); } });
  await reached;
  spyOn(child.stdin, "write").mockImplementation(() => { throw new Error("closed stdin"); });
  abort.abort();
  await expect(result).resolves.toBeUndefined();
  expect(child.signalCode).toBe("SIGTERM");
}, 2_000);

test("a completed run still returns its prompt result and removes the abort listener", async () => {
  const { child } = adapter("never");
  const abort = new AbortController();
  const remove = spyOn(abort.signal, "removeEventListener");
  await runAgent({
    ...options,
    signal: abort.signal,
    prompts: async send => { expect(await send("hello")).toBe("end_turn"); },
  });
  expect(child.signalCode).toBe("SIGTERM");
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
});

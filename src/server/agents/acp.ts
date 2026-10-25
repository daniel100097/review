import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type McpServer,
  type NewSessionRequest,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionUpdate,
  type StopReason,
} from "@agentclientprotocol/sdk";
import { mkdir } from "node:fs/promises";
import { delimiter } from "node:path";
import type { AgentKind } from "@/lib/agents";
import { mcpServerName } from "./mcp";
import { isReadOnlyCommand } from "./read-only-command";

export { agentKinds, type AgentKind } from "@/lib/agents";

export interface AgentRun {
  agent: AgentKind;
  /** Values for the session's config options, e.g. `{ model: "sonnet", effort: "high" }`. Unknown values throw. */
  config?: Record<string, string>;
  cwd: string;
  /** Continues an earlier session (same `cwd`) if the agent still has it; otherwise a new one starts. */
  resume?: string;
  onSession?: (sessionId: string) => void;
  /**
   * Sends the prompts. Gets each prompt's stop reason, so a run can follow up (e.g. when the agent didn't
   * submit), and whether `resume` worked, so it knows if the agent remembers earlier turns.
   */
  prompts: (send: (text: string) => Promise<StopReason>, session: { resumed: boolean }) => Promise<void>;
  /** Claude's built-in tools, e.g. `["Read", "Grep", "Glob"]`; none by default. Codex always has its read-only shell. */
  tools?: string[];
  mcpServers?: McpServer[];
  /** Tools on our MCP server (see `serveRunTools`) the agent may call. Anything else that asks for permission is denied. */
  allowedTools?: string[];
  /** Approve shell commands that only read (see `isReadOnlyCommand`). */
  allowReadOnlyCommands?: boolean;
  signal?: AbortSignal;
  onUpdate?: (update: SessionUpdate) => void;
}

/** The user's installed CLI, not a copy a dependency put in `node_modules/.bin` (which `bun run` puts first on PATH). */
const installed = (name: string) =>
  Bun.which(name, { PATH: (process.env.PATH ?? "").split(delimiter).filter(dir => !dir.includes("node_modules")).join(delimiter) }) ?? undefined;

/**
 * Agents run through their ACP adapters as plain subprocesses, using the installed `claude` and `codex` CLIs
 * and their logins. They get no edit tools: Codex runs in its read-only mode and Claude without built-in tools.
 */
const adapters: Record<AgentKind, { entry: string; env: Record<string, string | undefined>; meta?: (run: AgentRun) => Record<string, unknown> }> = {
  claude: {
    entry: "@agentclientprotocol/claude-agent-acp/dist/index.js",
    env: { CLAUDE_CODE_EXECUTABLE: process.env.CLAUDE_CODE_EXECUTABLE ?? installed("claude") },
    meta: run => ({
      claudeCode: {
        options: {
          tools: run.tools ?? [],
          // Ignore user/project settings, hooks and MCP servers; only ours are available.
          settingSources: [],
          strictMcpConfig: true,
          allowedTools: (run.allowedTools ?? []).map(tool => `mcp__${mcpServerName}__${tool}`),
          promptSuggestions: false,
        },
      },
    }),
  },
  codex: {
    entry: "@agentclientprotocol/codex-acp/dist/index.js",
    env: { CODEX_PATH: process.env.CODEX_PATH ?? installed("codex"), INITIAL_AGENT_MODE: "read-only" },
  },
};

/** Runs one agent session to completion. Throws on protocol errors; a cancelled run resolves normally. */
export async function runAgent(run: AgentRun) {
  const adapter = adapters[run.agent];
  const executable = run.agent === "claude" ? adapter.env.CLAUDE_CODE_EXECUTABLE : adapter.env.CODEX_PATH;
  if (!executable) throw new Error(`Install ${run.agent} and log in before using its AI features.`);
  await mkdir(run.cwd, { recursive: true });
  const command = Bun.isStandaloneExecutable
    ? [process.execPath, "--acp-agent", run.agent]
    : [process.execPath, Bun.resolveSync(adapter.entry, import.meta.dir)];
  const proc = Bun.spawn(command, {
    cwd: run.cwd,
    env: { ...process.env, ...adapter.env },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = new Response(proc.stderr).text();
  const stdin = new WritableStream<Uint8Array>({
    write: chunk => {
      proc.stdin.write(chunk);
      proc.stdin.flush();
    },
    close: () => {
      proc.stdin.end();
    },
  });

  // Permission requests may only carry the tool call's ID; its title arrived in an earlier update.
  const titles = new Map<string, string>();
  const app = client({ name: "codereview-ui" })
    .onRequest(methods.client.session.requestPermission, ({ params }) =>
      decide(params, params.toolCall.title ?? titles.get(params.toolCall.toolCallId) ?? "", run),
    )
    .onNotification(methods.client.session.update, ({ params: { update } }) => {
      if ((update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") && update.title) {
        titles.set(update.toolCallId, update.title);
      }
      run.onUpdate?.(update);
    });

  try {
    await app.connectWith(ndJsonStream(stdin, proc.stdout), async agent => {
      await agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        // No client-side file access or terminals: the agent only reads what its own tools allow.
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: "codereview-ui", version: "0.1.0" },
      });
      const setup: NewSessionRequest = { cwd: run.cwd, mcpServers: run.mcpServers ?? [], _meta: adapter.meta?.(run) ?? null };
      const resumedSession = run.resume
        ? await agent.request(methods.agent.session.resume, { ...setup, sessionId: run.resume }).then(
            response => ({ ...response, sessionId: run.resume! }),
            error => void console.warn(`agent: couldn't resume ${run.agent} session ${run.resume}: ${error?.message ?? error}`),
          )
        : undefined;
      const resumed = Boolean(resumedSession);
      const session = resumedSession ?? (await agent.request(methods.agent.session.new, setup));
      const { sessionId } = session;
      run.onSession?.(sessionId);
      for (const [configId, value] of Object.entries(run.config ?? {})) {
        assertOption(session.configOptions ?? [], configId, value);
        await agent.request(methods.agent.session.setConfigOption, { sessionId, configId, value });
      }

      const cancel = () => agent.notify(methods.agent.session.cancel, { sessionId });
      run.signal?.addEventListener("abort", cancel, { once: true });
      try {
        await run.prompts(
          async text => {
            if (run.signal?.aborted) return "cancelled";
            const response = await agent.request(methods.agent.session.prompt, {
              sessionId,
              prompt: [{ type: "text", text }],
            });
            return response.stopReason;
          },
          { resumed },
        );
      } finally {
        run.signal?.removeEventListener("abort", cancel);
      }
    });
  } catch (error) {
    // ACP errors put the reason in `data.details`, e.g. "Internal error" with "Codex did not return any models".
    const details = (error as { data?: { details?: unknown } }).data?.details;
    const message = [error instanceof Error ? error.message : String(error), typeof details === "string" && details]
      .filter(Boolean)
      .join(": ");
    const log = (await Promise.race([stderr, Bun.sleep(500).then(() => "")])).trim();
    throw new Error(`${run.agent}: ${message}${log ? `\n${log.slice(-2000)}` : ""}`, { cause: error });
  } finally {
    proc.kill();
    await Promise.race([proc.exited, Bun.sleep(5_000).then(() => proc.kill("SIGKILL"))]);
  }
}

/**
 * Allows our MCP tools, named `mcp__codereview__tool` by Claude and `mcp.codereview.tool` by Codex, and read-only
 * commands if the run allows them.
 */
function decide({ toolCall, options }: RequestPermissionRequest, title: string, run: AgentRun): RequestPermissionResponse {
  const command = (toolCall.rawInput as { command?: unknown } | undefined)?.command;
  const allowed =
    (run.allowedTools ?? []).some(tool => [`mcp__${mcpServerName}__${tool}`, `mcp.${mcpServerName}.${tool}`].includes(title)) ||
    (Boolean(run.allowReadOnlyCommands) && toolCall.kind === "execute" && typeof command === "string" && isReadOnlyCommand(command));
  if (!allowed) console.warn(`agent: denied ${title || "untitled tool call"}: ${JSON.stringify(toolCall).slice(0, 500)}`);
  const option = options.find(o => o.kind === (allowed ? "allow_once" : "reject_once"));
  return { outcome: option ? { outcome: "selected", optionId: option.optionId } : { outcome: "cancelled" } };
}

function assertOption(options: SessionConfigOption[], configId: string, value: string) {
  const option = options.find(o => o.id === configId);
  if (!option) throw new Error(`Unknown config option "${configId}"`);
  if (option.type !== "select") return;
  const values = option.options.flatMap(o => ("options" in o ? o.options : [o])).map(o => o.value);
  if (!values.includes(value)) throw new Error(`Invalid ${configId} "${value}"; expected one of ${values.join(", ")}`);
}

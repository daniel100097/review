import type { McpServer as AcpMcpServer } from "@agentclientprotocol/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

export const mcpServerName = "codereview";

/** Tools offered to one agent run, served at `/mcp/<token>`. Kept on globalThis so runs survive `bun --hot`. */
const state = ((globalThis as any).__codereviewMcp ??= {
  baseUrl: "http://127.0.0.1:3000",
  runs: new Map<string, (server: McpServer) => void>(),
}) as { baseUrl: string; runs: Map<string, (server: McpServer) => void> };

/** Where local agents reach this server; wildcard bindings use their loopback address. */
export function setMcpBaseUrl(url: URL) {
  const callback = new URL(url);
  if (callback.hostname === "0.0.0.0") callback.hostname = "127.0.0.1";
  if (callback.hostname === "[::]") callback.hostname = "[::1]";
  state.baseUrl = callback.origin;
}

/** Serves the tools `register` adds until `dispose` is called. The random URL is the run's only credential. */
export function serveRunTools(register: (server: McpServer) => void) {
  const token = crypto.randomUUID();
  state.runs.set(token, register);
  const server: AcpMcpServer = { type: "http", name: mcpServerName, url: `${state.baseUrl}/mcp/${token}`, headers: [] };
  return { server, dispose: () => state.runs.delete(token) };
}

/** Stateless Streamable HTTP: each request gets a fresh MCP server; tools keep their state in the run. */
export async function handleMcp(req: Request, token: string) {
  const register = state.runs.get(token);
  if (!register) return new Response("Unknown or finished run", { status: 404 });
  // Without sessions there is nothing to push, so don't hold a GET stream open.
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  const server = new McpServer({ name: mcpServerName, version: "0.1.0" });
  register(server);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}

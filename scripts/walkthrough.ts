// Generates a walkthrough for a pull request from the command line, without the UI.
// bun scripts/walkthrough.ts <sourceId> <owner/repo> <number> <claude|codex> [configId=value ...]
import { eq } from "drizzle-orm";
import { agentKinds, type AgentKind } from "../src/server/agents/acp";
import { handleMcp, setMcpBaseUrl } from "../src/server/agents/mcp";
import { generateWalkthrough } from "../src/server/agents/walkthrough";
import { db } from "../src/server/db";
import { sources } from "../src/server/db/schema";
import { createProvider } from "../src/server/providers";

const [sourceId, repo, number, agent, ...configArgs] = process.argv.slice(2);
if (!sourceId || !repo || !number || !agentKinds.includes(agent as AgentKind)) {
  console.error("usage: bun scripts/walkthrough.ts <sourceId> <owner/repo> <number> <claude|codex> [configId=value ...]");
  process.exit(1);
}
const config = Object.fromEntries(configArgs.map(arg => arg.split("=", 2) as [string, string]));

const source = db.select().from(sources).where(eq(sources.id, Number(sourceId))).get();
if (!source) throw new Error(`Unknown source ${sourceId}`);
const provider = createProvider(source.kind, source.host);

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  routes: { "/mcp/:token": req => handleMcp(req, req.params.token) },
});
setMcpBaseUrl(server.url);

const abort = new AbortController();
process.on("SIGINT", () => abort.abort());

const [pull, files] = await Promise.all([provider.getPull(repo, Number(number)), provider.getFiles(repo, Number(number))]);
console.error(`#${pull.number} ${pull.title}: ${files.length} files, ${files.reduce((n, f) => n + f.patch.length, 0)} patch bytes`);

const started = performance.now();
const seconds = () => ((performance.now() - started) / 1000).toFixed(1);
try {
  const walkthrough = await generateWalkthrough({
    agent: agent as AgentKind,
    config,
    pull,
    files,
    signal: abort.signal,
    onUpdate: update => {
      if (update.sessionUpdate === "tool_call") console.error(`[${seconds()}s] tool: ${update.title} (${update.status})`);
      if (update.sessionUpdate === "tool_call_update" && update.status === "failed") console.error(`[${seconds()}s] tool failed: ${JSON.stringify(update.content ?? update.rawOutput).slice(0, 500)}`);
      if (update.sessionUpdate === "usage_update") console.error(`[${seconds()}s] usage: ${JSON.stringify(update).slice(0, 300)}`);
      if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") process.stderr.write(update.content.text);
    },
  });
  console.log(JSON.stringify(walkthrough, null, 2));
  console.error(`done in ${seconds()}s`);
} finally {
  server.stop(true);
}

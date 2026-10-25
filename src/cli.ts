import { version } from "../package.json";

// The executable also hosts the bundled ACP adapters in separate processes.
if (process.argv[2] === "--acp-agent") {
  const agent = process.argv[3];
  process.argv.splice(2, 2);
  if (agent === "claude") await import("@agentclientprotocol/claude-agent-acp/dist/index.js");
  else if (agent === "codex") await import("@agentclientprotocol/codex-acp/dist/index.js");
  else throw new Error(`Unknown agent: ${agent}`);
} else if (process.argv.includes("--version")) {
  console.log(version);
} else if (process.argv.includes("--help")) {
  console.log(`codereview-ui ${version}

Run codereview-ui, then open http://localhost:3000.

Environment variables:
  PORT            HTTP port (default: 3000)
  HOST            Bind address (default: 127.0.0.1)
  DATABASE_PATH   SQLite file (default: ~/.local/share/codereview-ui/codereview.sqlite)
  XDG_DATA_HOME   Base directory for the default database
  XDG_CACHE_HOME  Base directory for cached repositories

Requires authenticated fj or glab for your forge, git for repository context,
and an installed, authenticated claude or codex CLI for AI features.`);
} else {
  await import("./index");
}

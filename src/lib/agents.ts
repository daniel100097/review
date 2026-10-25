/** Agents that can answer questions and write walkthroughs, run through ACP (see `server/agents/acp.ts`). */
export const agentKinds = ["claude", "codex"] as const;
export type AgentKind = (typeof agentKinds)[number];

/** Models offered in the UI. `model` is the value of the agent's `model` session config option. */
export const agentModels = [
  { agent: "claude", model: "haiku", label: "Claude Haiku 5.5" },
  { agent: "claude", model: "sonnet", label: "Claude Sonnet 5.5" },
  { agent: "claude", model: "opus", label: "Claude Opus 5.5" },
  { agent: "codex", model: "gpt-6-luna", label: "GPT-6-Luna" },
  { agent: "codex", model: "gpt-6.1-sol", label: "GPT-6.1-Sol" },
  { agent: "codex", model: "gpt-6-astra", label: "GPT-6-Astra" },
] as const satisfies { agent: AgentKind; model: string; label: string }[];

export type AgentModel = (typeof agentModels)[number];

export const modelLabel = (agent: string, model: string) =>
  agentModels.find(m => m.agent === agent && m.model === model)?.label ?? `${agent} ${model}`;

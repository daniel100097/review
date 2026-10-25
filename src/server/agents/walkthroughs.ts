import type { AgentKind } from "@/lib/agents";
import { and, desc, eq, notInArray } from "drizzle-orm";
import { db } from "../db";
import { sources, walkthroughs } from "../db/schema";
import { createProvider } from "../providers";
import { generateWalkthrough } from "./walkthrough";

/** Walkthroughs being generated, by ID: what the agent is doing, and how to stop it. Kept across `bun --hot`. */
const jobs = ((globalThis as any).__codereviewWalkthroughs ??= new Map()) as Map<
  number,
  { activity: string; abort: AbortController }
>;

// Walkthroughs that were being generated when the server stopped will never finish.
db.update(walkthroughs)
  .set({ status: "failed", error: "Interrupted by a server restart." })
  .where(and(eq(walkthroughs.status, "running"), notInArray(walkthroughs.id, [...jobs.keys()])))
  .run();

/** The pull request's most recent walkthrough, for any head commit. */
export function latestWalkthrough(sourceId: number, repo: string, number: number) {
  const row = db
    .select()
    .from(walkthroughs)
    .where(and(eq(walkthroughs.sourceId, sourceId), eq(walkthroughs.repo, repo), eq(walkthroughs.number, number)))
    .orderBy(desc(walkthroughs.id))
    .get();
  return row ? { ...row, activity: jobs.get(row.id)?.activity } : null;
}

export async function startWalkthrough(input: { sourceId: number; repo: string; number: number; agent: AgentKind; model: string }) {
  const { sourceId, repo, number } = input;
  if (latestWalkthrough(sourceId, repo, number)?.status === "running") throw new Error("A walkthrough is already being written.");
  const source = db.select().from(sources).where(eq(sources.id, sourceId)).get();
  if (!source) throw new Error(`Unknown source ${sourceId}`);
  const provider = createProvider(source.kind, source.host);
  const [pull, files] = await Promise.all([provider.getPull(repo, number), provider.getFiles(repo, number)]);

  const row = db
    .insert(walkthroughs)
    .values({ sourceId, repo, number, headSha: pull.headSha, agent: input.agent, model: input.model, status: "running" })
    .returning()
    .get();
  const job = { activity: "Starting", abort: new AbortController() };
  jobs.set(row.id, job);
  const finish = (values: Partial<typeof walkthroughs.$inferInsert>) => {
    db.update(walkthroughs).set(values).where(eq(walkthroughs.id, row.id)).run();
    jobs.delete(row.id);
  };
  void generateWalkthrough({
    agent: input.agent,
    config: { model: input.model },
    pull,
    files,
    signal: job.abort.signal,
    onUpdate: update => {
      if (update.sessionUpdate === "agent_thought_chunk" || update.sessionUpdate === "agent_message_chunk") job.activity = "Reading the diff";
      if (update.sessionUpdate === "tool_call") job.activity = "Checking the groups";
    },
  }).then(
    result => finish({ status: "done", result }),
    error => finish(job.abort.signal.aborted ? { status: "cancelled" } : { status: "failed", error: String(error?.message ?? error) }),
  );
  return row.id;
}

export function cancelWalkthrough(id: number) {
  jobs.get(id)?.abort.abort();
}

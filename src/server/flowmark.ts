import { TRPCError } from "@trpc/server";
import { and, desc, eq, notInArray } from "drizzle-orm";
import { z } from "zod";
import { agentKinds } from "@/lib/agents";
import { flowmarkModes } from "@/lib/flowmark";
import { db } from "./db";
import { flowmarkReviews } from "./db/schema";
import { router, sourceProcedure } from "./trpc";
import { generateFlowmark } from "./agents/flowmark";

const scope = z.object({ repo: z.string().min(1), number: z.number().int().positive() });
const sha = z.string().regex(/^[a-f0-9]{40,64}$/i);
const jobs = ((globalThis as any).__codereviewFlowmarkJobs ??= new Map()) as Map<number, { activity: string; abort: AbortController }>;

db.update(flowmarkReviews).set({ status: "failed", error: "Interrupted by a server restart." })
  .where(and(eq(flowmarkReviews.status, "running"), notInArray(flowmarkReviews.id, [...jobs.keys()]))).run();

function latest(sourceId: number, repo: string, number: number) {
  return db.select().from(flowmarkReviews)
    .where(and(eq(flowmarkReviews.sourceId, sourceId), eq(flowmarkReviews.repo, repo), eq(flowmarkReviews.number, number)))
    .orderBy(desc(flowmarkReviews.id)).get();
}

export const flowmarkRouter = router({
  latest: sourceProcedure.input(scope).query(({ input: { sourceId, repo, number } }) => {
    const row = latest(sourceId, repo, number);
    return row ? { ...row, activity: jobs.get(row.id)?.activity } : null;
  }),

  start: sourceProcedure.input(scope.extend({
    baseSha: sha, headSha: sha,
    mode: z.enum(flowmarkModes), request: z.string().trim().max(4000).default(""),
    agent: z.enum(agentKinds), model: z.string().min(1).max(200),
  })).mutation(async ({ ctx, input }) => {
    const pull = await ctx.provider.getPull(input.repo, input.number);
    if (pull.headSha !== input.headSha || pull.baseSha !== input.baseSha) {
      throw new TRPCError({ code: "CONFLICT", message: "This PR changed. Refresh it before generating a Flowmark review." });
    }
    // Check after the awaited forge request, then reserve synchronously to prevent duplicate jobs.
    if (latest(input.sourceId, input.repo, input.number)?.status === "running") {
      throw new TRPCError({ code: "CONFLICT", message: "A Flowmark review is already being generated." });
    }
    const row = db.insert(flowmarkReviews).values({ ...input, status: "running" }).returning().get();
    const job = { activity: "Loading the PR snapshot", abort: new AbortController() };
    jobs.set(row.id, job);
    const timeout = AbortSignal.timeout(600_000);
    const signal = AbortSignal.any([job.abort.signal, timeout]);
    const finish = (values: Partial<typeof flowmarkReviews.$inferInsert>) => {
      db.update(flowmarkReviews).set(values).where(eq(flowmarkReviews.id, row.id)).run();
      jobs.delete(row.id);
    };
    void generateFlowmark({
      ...input, pull, provider: ctx.provider, signal,
      onActivity: activity => { job.activity = activity; },
    }).then(
      review => finish({ status: "done", baseSource: review.base, headSource: review.head, result: review.result }),
      error => finish(job.abort.signal.aborted
        ? { status: "cancelled" }
        : { status: "failed", error: timeout.aborted ? "Flowmark generation timed out. Try a narrower focus." : String(error?.message ?? error) }),
    );
    return row.id;
  }),

  cancel: sourceProcedure.input(scope.extend({ id: z.number().int().positive() })).mutation(({ input }) => {
    const row = latest(input.sourceId, input.repo, input.number);
    if (row?.id === input.id) jobs.get(row.id)?.abort.abort();
  }),
});

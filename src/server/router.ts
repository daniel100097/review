import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { agentKinds } from "@/lib/agents";
import { z } from "zod";
import { db } from "./db";
import { hiddenFolders, sources, viewedFiles } from "./db/schema";
import { askQuestion, cancelAnswer, deleteThread, followUp, listThreads } from "./agents/questions";
import { cancelWalkthrough, latestWalkthrough, startWalkthrough } from "./agents/walkthroughs";
import { generateFilterRules } from "./agents/filter-rules";
import { attributeLines, contributorsOf } from "./git/attribution";
import { pullRepo } from "./git/checkout";
import { createProvider, providerKinds, pullSorts, type PullSummary } from "./providers";
import { publicProcedure, router, sourceProcedure } from "./trpc";

const pullInput = z.object({ repo: z.string().min(1), number: z.number().int().positive() });

const linePosition = z.object({
  path: z.string(),
  oldPath: z.string(),
  oldLine: z.number().int().positive().optional(),
  newLine: z.number().int().positive().optional(),
});

export const appRouter = router({
  filters: router({
    generate: sourceProcedure
      .input(pullInput.extend({ request: z.string().trim().min(1).max(4000), agent: z.enum(agentKinds), model: z.string().min(1).max(200) }))
      .mutation(async ({ ctx, input, signal }) => {
        const timeout = AbortSignal.timeout(300_000);
        try {
          const [pull, files] = await Promise.all([
            ctx.provider.getPull(input.repo, input.number),
            ctx.provider.getFiles(input.repo, input.number),
          ]);
          return await generateFilterRules({
            ...input,
            context: { title: pull.title, body: pull.body, files: files.map(file => ({ ...file, patchHash: Bun.hash(file.patch).toString(36) })) },
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
          });
        } catch (e) {
          throw new TRPCError({ code: "BAD_REQUEST", message: timeout.aborted ? "Filter generation timed out. Try again or copy the prompt into your chat." : (e as Error).message });
        }
      }),
  }),

  sources: router({
    list: publicProcedure.query(() => db.select().from(sources).orderBy(sources.host).all()),

    add: publicProcedure
      .input(z.object({ kind: z.enum(providerKinds), host: z.string().trim().min(1) }))
      .mutation(async ({ input }) => {
        // Doubles as a check that the CLI is installed and logged in to this host.
        const me = await createProvider(input.kind, input.host)
          .whoami()
          .catch((e: Error) => {
            throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
          });
        return db
          .insert(sources)
          .values({ ...input, username: me.username })
          .onConflictDoUpdate({ target: [sources.kind, sources.host], set: { username: me.username } })
          .returning()
          .get();
      }),

    remove: publicProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => {
      db.delete(sources).where(eq(sources.id, input.id)).run();
    }),
  }),

  repos: router({
    list: sourceProcedure
      .input(z.object({ search: z.string().optional() }))
      .query(({ ctx, input }) => ctx.provider.listRepos(input.search || undefined)),

    labels: sourceProcedure
      .input(z.object({ repo: z.string().min(1) }))
      .query(({ ctx, input }) => ctx.provider.listLabels(input.repo)),

    /** A file's text at a commit, for expanding unchanged lines around the diff. */
    file: sourceProcedure
      .input(z.object({ repo: z.string().min(1), path: z.string().min(1), ref: z.string().min(1) }))
      .query(({ ctx, input }) => ctx.provider.getFile(input.repo, input.path, input.ref)),

    hiddenFolders: sourceProcedure.input(z.object({ repo: z.string().min(1) })).query(({ input }) =>
      db
        .select({ path: hiddenFolders.path })
        .from(hiddenFolders)
        .where(and(eq(hiddenFolders.sourceId, input.sourceId), eq(hiddenFolders.repo, input.repo)))
        .orderBy(hiddenFolders.path)
        .all()
        .map(row => row.path),
    ),

    setFolderHidden: sourceProcedure
      .input(z.object({ repo: z.string().min(1), path: z.string().min(1), hidden: z.boolean() }))
      .mutation(({ input: { sourceId, repo, path, hidden } }) => {
        if (hidden) db.insert(hiddenFolders).values({ sourceId, repo, path }).onConflictDoNothing().run();
        else
          db.delete(hiddenFolders)
            .where(and(eq(hiddenFolders.sourceId, sourceId), eq(hiddenFolders.repo, repo), eq(hiddenFolders.path, path)))
            .run();
      }),
  }),

  pulls: router({
    list: sourceProcedure
      .input(
        z.object({
          repo: z.string().min(1),
          state: z.enum(["open", "closed", "merged", "all"]),
          search: z.string().trim().optional(),
          author: z.string().trim().optional(),
          label: z.string().optional(),
          sort: z.enum(pullSorts).default("updated"),
          /** Page number, managed by `useInfiniteQuery`. */
          cursor: z.number().int().positive().nullish(),
        }),
      )
      .query(async ({ ctx, input: { repo, cursor, search, author, label, ...query } }) => {
        const page = cursor ?? 1;
        const filters = { search: search || undefined, author: author || undefined, label: label || undefined };
        const [result, jumped] = await Promise.all([
          ctx.provider.listPulls(repo, { ...query, ...filters, page }),
          // Searching for `#123` or `123` also finds that pull request directly.
          page === 1 && /^#?\d+$/.test(search ?? "")
            ? ctx.provider.getPull(repo, Number(search!.replace("#", ""))).catch(() => undefined)
            : undefined,
        ]);
        const items: PullSummary[] = jumped
          ? [jumped, ...result.items.filter(p => p.number !== jumped.number)]
          : result.items;
        return { items, nextCursor: result.nextPage };
      }),

    get: sourceProcedure.input(pullInput).query(({ ctx, input }) => ctx.provider.getPull(input.repo, input.number)),

    files: sourceProcedure.input(pullInput).query(async ({ ctx, input }) => {
      const files = await ctx.provider.getFiles(input.repo, input.number);
      const viewed = db
        .select()
        .from(viewedFiles)
        .where(
          and(
            eq(viewedFiles.sourceId, input.sourceId),
            eq(viewedFiles.repo, input.repo),
            eq(viewedFiles.number, input.number),
          ),
        )
        .all();
      const viewedHash = new Map(viewed.map(v => [v.path, v.patchHash]));
      return files.map(f => {
        const patchHash = Bun.hash(f.patch).toString(36);
        return { ...f, patchHash, viewed: viewedHash.get(f.newPath) === patchHash };
      });
    }),

    setViewed: sourceProcedure
      .input(pullInput.extend({ path: z.string(), patchHash: z.string(), viewed: z.boolean() }))
      .mutation(({ input: { sourceId, repo, number, path, patchHash, viewed } }) => {
        if (viewed) {
          db.insert(viewedFiles)
            .values({ sourceId, repo, number, path, patchHash })
            .onConflictDoUpdate({
              target: [viewedFiles.sourceId, viewedFiles.repo, viewedFiles.number, viewedFiles.path],
              set: { patchHash },
            })
            .run();
        } else {
          db.delete(viewedFiles)
            .where(
              and(
                eq(viewedFiles.sourceId, sourceId),
                eq(viewedFiles.repo, repo),
                eq(viewedFiles.number, number),
                eq(viewedFiles.path, path),
              ),
            )
            .run();
        }
      }),

    /** People who committed to the pull request, for filtering the diff by who changed what. */
    contributors: sourceProcedure
      .input(pullInput)
      .query(async ({ ctx, input }) => contributorsOf(await ctx.provider.getCommits(input.repo, input.number))),

    /** Who added and deleted each changed line, from git blame in a local clone (cloned the first time). */
    attribution: sourceProcedure.input(pullInput).query(async ({ ctx, input: { sourceId, repo, number } }) => {
      const [pull, files, commits] = await Promise.all([
        ctx.provider.getPull(repo, number),
        ctx.provider.getFiles(repo, number),
        ctx.provider.getCommits(repo, number),
      ]);
      const bare = await pullRepo(sourceId, ctx.provider, repo, pull);
      // Key authors like `contributorsOf` does: by forge account where the forge knows the email.
      const usernames = new Map(commits.flatMap(c => (c.user ? [[c.authorEmail.toLowerCase(), c.user.username] as const] : [])));
      return attributeLines(bare, pull.baseSha, pull.headSha, files, email => usernames.get(email) ?? email);
    }),

    comments: sourceProcedure
      .input(pullInput)
      .query(({ ctx, input }) => ctx.provider.getComments(input.repo, input.number)),

    addComment: sourceProcedure
      .input(pullInput.extend({ body: z.string().trim().min(1), position: linePosition.optional() }))
      .mutation(({ ctx, input }) => ctx.provider.addComment(input.repo, input.number, input.body, input.position)),
  }),

  /** An agent's grouping of a pull request's files, with summaries and review order. */
  walkthroughs: router({
    latest: sourceProcedure
      .input(pullInput)
      .query(({ input }) => latestWalkthrough(input.sourceId, input.repo, input.number)),

    start: sourceProcedure
      .input(pullInput.extend({ agent: z.enum(agentKinds), model: z.string().min(1) }))
      .mutation(({ input }) => startWalkthrough(input)),

    cancel: publicProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => cancelWalkthrough(input.id)),
  }),

  /** Local conversations with an agent about lines of a pull request. */
  questions: router({
    list: sourceProcedure
      .input(pullInput)
      .query(({ input }) => listThreads(input.sourceId, input.repo, input.number)),

    ask: sourceProcedure
      .input(
        pullInput.extend({
          position: linePosition,
          excerpt: z.string().min(1),
          question: z.string().trim().min(1),
          agent: z.enum(agentKinds),
          model: z.string().min(1),
        }),
      )
      .mutation(({ input }) => askQuestion(input)),

    followUp: publicProcedure
      .input(z.object({ threadId: z.number(), question: z.string().trim().min(1) }))
      .mutation(({ input }) => followUp(input.threadId, input.question)),

    cancel: publicProcedure
      .input(z.object({ messageId: z.number() }))
      .mutation(({ input }) => cancelAnswer(input.messageId)),

    delete: publicProcedure
      .input(z.object({ threadId: z.number() }))
      .mutation(({ input }) => deleteThread(input.threadId)),
  }),
});

export type AppRouter = typeof appRouter;

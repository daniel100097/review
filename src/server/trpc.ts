import { initTRPC, TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { sources } from "./db/schema";
import { createProvider } from "./providers";

const t = initTRPC.create();

export const router = t.router;
export const publicProcedure = t.procedure;

/** Resolves `sourceId` to its source row and a provider for it. */
export const sourceProcedure = t.procedure.input(z.object({ sourceId: z.number() })).use(async ({ input, next }) => {
  const source = db.select().from(sources).where(eq(sources.id, input.sourceId)).get();
  if (!source) throw new TRPCError({ code: "NOT_FOUND", message: `Unknown source ${input.sourceId}` });
  return next({ ctx: { source, provider: createProvider(source.kind, source.host) } });
});

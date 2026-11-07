import { SQLiteError } from "bun:sqlite";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { filterProfileSettingsSchema } from "@/lib/filter-profiles";
import { db } from "./db";
import { filterProfiles } from "./db/schema";
import { router, sourceProcedure } from "./trpc";

const scopeInput = z.object({ repo: z.string().min(1).max(1000) });
const idInput = z.number().int().positive();
const fields = { id: filterProfiles.id, name: filterProfiles.name, settings: filterProfiles.settings };

export const filterProfilesRouter = router({
  list: sourceProcedure.input(scopeInput).query(({ input: { sourceId, repo } }) =>
    db.select(fields).from(filterProfiles)
      .where(and(eq(filterProfiles.sourceId, sourceId), eq(filterProfiles.repo, repo)))
      .orderBy(filterProfiles.name)
      .all(),
  ),

  save: sourceProcedure
    .input(scopeInput.extend({
      id: idInput.optional(),
      name: z.string().trim().min(1).max(80),
      settings: filterProfileSettingsSchema,
    }))
    .mutation(({ input: { sourceId, repo, id, name, settings } }) => {
      try {
        const saved = id === undefined
          ? db.insert(filterProfiles).values({ sourceId, repo, name, settings }).returning(fields).get()
          : db.update(filterProfiles).set({ name, settings })
            .where(and(eq(filterProfiles.sourceId, sourceId), eq(filterProfiles.repo, repo), eq(filterProfiles.id, id)))
            .returning(fields).get();
        if (!saved) throw new TRPCError({ code: "NOT_FOUND", message: "Filter profile not found" });
        return saved;
      } catch (error) {
        if (error instanceof SQLiteError && error.code === "SQLITE_CONSTRAINT_UNIQUE") {
          throw new TRPCError({ code: "CONFLICT", message: "A filter profile with this name already exists" });
        }
        throw error;
      }
    }),

  remove: sourceProcedure.input(scopeInput.extend({ id: idInput })).mutation(({ input: { sourceId, repo, id } }) => {
    db.delete(filterProfiles)
      .where(and(eq(filterProfiles.sourceId, sourceId), eq(filterProfiles.repo, repo), eq(filterProfiles.id, id)))
      .run();
  }),
});

import { z } from "zod";
import { filterRulesSchema } from "./filter-rules";

export const filterProfileSettingsSchema = z.object({
  hideTests: z.boolean(),
  hideCommentChanges: z.boolean(),
  hideReviewComments: z.boolean(),
  hiddenFolders: z.array(z.string().min(1).max(4096)).max(500),
  rulesEnabled: z.boolean(),
  request: z.string().max(4000),
  by: z.string().optional(),
  rules: filterRulesSchema.optional(),
}).strict();

export type FilterProfileSettings = z.infer<typeof filterProfileSettingsSchema>;

import { z } from "zod";

export const flowmarkModes = ["changes", "walkthrough"] as const;
export const flowmarkSourceLimit = 80_000;
export const flowmarkSourcesSchema = z.object({
  base: z.string().max(flowmarkSourceLimit).default(""),
  head: z.string().min(1).max(flowmarkSourceLimit),
}).strict();
export type FlowmarkSources = z.infer<typeof flowmarkSourcesSchema>;

export const flowmarkReportSchema = z.object({
  capability: z.string().min(1).max(300),
  omitted: z.array(z.string().max(1000)).max(30),
  specGaps: z.array(z.string().max(1000)).max(30),
  unverifiedRefs: z.array(z.string().max(1000)).max(50),
  retainedWarnings: z.array(z.string().max(1000)).max(30),
}).strict();

/** The upstream model is opaque to React; the pinned upstream viewer consumes it. */
export type FlowmarkModel = {
  model_version: number;
  title: string | null;
  diagnostics: { severity: "error" | "warning"; code: string; message: string; line: number }[];
  typechecked?: boolean;
  writerReport?: z.infer<typeof flowmarkReportSchema>;
  previews?: { base?: { card: string; flow: string }; head: { card: string; flow: string } };
  file?: string;
  base_file?: string | null;
  card?: unknown;
  rows?: unknown[];
  blocks?: unknown[];
  risks?: unknown[];
  changes?: unknown;
  sides?: { base: FlowmarkModel; head: FlowmarkModel };
};

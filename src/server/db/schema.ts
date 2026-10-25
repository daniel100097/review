import { integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { agentKinds } from "@/lib/agents";
import type { Walkthrough } from "../agents/walkthrough";
import { providerKinds } from "../providers/types";

/** A forge host the user reviews code on, e.g. GitLab at gitlab.com. */
export const sources = sqliteTable(
  "sources",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: providerKinds }).notNull(),
    host: text("host").notNull(),
    username: text("username").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  t => [unique().on(t.kind, t.host)],
);

/** Files marked as viewed. Stays viewed only while the file's patch hash is unchanged. */
export const viewedFiles = sqliteTable(
  "viewed_files",
  {
    sourceId: integer("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    repo: text("repo").notNull(),
    number: integer("number").notNull(),
    path: text("path").notNull(),
    patchHash: text("patch_hash").notNull(),
  },
  t => [primaryKey({ columns: [t.sourceId, t.repo, t.number, t.path] })],
);

/** Folders hidden from review in a repo, e.g. vendored or generated code. */
export const hiddenFolders = sqliteTable(
  "hidden_folders",
  {
    sourceId: integer("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    repo: text("repo").notNull(),
    path: text("path").notNull(),
  },
  t => [primaryKey({ columns: [t.sourceId, t.repo, t.path] })],
);

/** A local conversation with an agent about lines of a pull request's diff, at the head commit it was asked on. */
export const questionThreads = sqliteTable("question_threads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceId: integer("source_id")
    .notNull()
    .references(() => sources.id, { onDelete: "cascade" }),
  repo: text("repo").notNull(),
  number: integer("number").notNull(),
  // The thread sits below the last selected line; `excerpt` holds all selected lines as diff text.
  path: text("path").notNull(),
  oldPath: text("old_path").notNull(),
  oldLine: integer("old_line"),
  newLine: integer("new_line"),
  excerpt: text("excerpt").notNull(),
  headSha: text("head_sha").notNull(),
  baseSha: text("base_sha").notNull(),
  agent: text("agent", { enum: agentKinds }).notNull(),
  model: text("model").notNull(),
  /** The agent's session, resumed for follow-ups. */
  sessionId: text("session_id"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const questionMessages = sqliteTable("question_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  threadId: integer("thread_id")
    .notNull()
    .references(() => questionThreads.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "agent"] }).notNull(),
  body: text("body").notNull().default(""),
  /** What the agent wrote before its last tool call, e.g. "Let me check the callers". */
  notes: text("notes").notNull().default(""),
  status: text("status", { enum: ["running", "done", "failed", "cancelled"] }).notNull().default("done"),
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** An agent's grouping of a pull request's files (see `agents/walkthrough.ts`), at the head commit it was made for. */
export const walkthroughs = sqliteTable("walkthroughs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceId: integer("source_id")
    .notNull()
    .references(() => sources.id, { onDelete: "cascade" }),
  repo: text("repo").notNull(),
  number: integer("number").notNull(),
  headSha: text("head_sha").notNull(),
  agent: text("agent", { enum: agentKinds }).notNull(),
  model: text("model").notNull(),
  status: text("status", { enum: ["running", "done", "failed", "cancelled"] }).notNull(),
  /** `Walkthrough` as JSON once done. */
  result: text("result", { mode: "json" }).$type<Walkthrough>(),
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

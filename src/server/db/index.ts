import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as schema from "./schema";

const databasePath = process.env.DATABASE_PATH ?? (Bun.isStandaloneExecutable
  ? path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), "codereview-ui", "codereview.sqlite")
  : "codereview.sqlite");
mkdirSync(path.dirname(databasePath), { recursive: true });
const sqlite = new Database(databasePath, { create: true });
sqlite.run("PRAGMA journal_mode = WAL");
sqlite.run("PRAGMA foreign_keys = ON");

export const db = drizzle({ client: sqlite, schema });

migrate(db, { migrationsFolder: path.join(import.meta.dir, Bun.isStandaloneExecutable ? "drizzle" : "../../../drizzle") });

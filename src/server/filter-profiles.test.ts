import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { filterProfileSettingsSchema, type FilterProfileSettings } from "@/lib/filter-profiles";

const settings: FilterProfileSettings = {
  hideTests: true,
  hideCommentChanges: false,
  hideReviewComments: true,
  hiddenFolders: ["vendor", "generated/assets"],
  rulesEnabled: false,
  request: "Hide generated files",
};

const directories: string[] = [];
const spawn = Bun.spawn;
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function databasePath() {
  const directory = mkdtempSync(join(tmpdir(), "filter-profiles-"));
  directories.push(directory);
  return join(directory, "test.sqlite");
}

// Import the real app and run its migrations outside the test runner's shared env/module cache.
async function run(body: string, path = databasePath()) {
  const child = spawn([process.execPath, "--eval", `
    import assert from "node:assert/strict";
    import { eq } from "drizzle-orm";
    import { db } from "./src/server/db";
    import { filterProfiles, sources } from "./src/server/db/schema";
    import { appRouter } from "./src/server/router";
    import { filterProfilesRouter } from "./src/server/filter-profiles";
    const api = appRouter.createCaller({}).filterProfiles;
    const scope = { sourceId: 1, repo: "owner/repo" };
    const settings = ${JSON.stringify(settings)};
    db.insert(sources).values([
      { id: 1, kind: "gitlab", host: "first.example", username: "reviewer" },
      { id: 2, kind: "forgejo", host: "second.example", username: "reviewer" },
    ]).onConflictDoNothing().run();
    Bun.spawn = () => { throw new Error("Unexpected forge CLI call"); };
    globalThis.fetch = () => { throw new Error("Unexpected forge request"); };
    ${body}
  `], {
    cwd: join(import.meta.dir, "../.."),
    env: { ...process.env, DATABASE_PATH: path },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 5000,
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect({ exitCode, stdout, stderr }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
}

test("exports strict settings with optional contributor and validated rules", () => {
  expect(filterProfileSettingsSchema.parse(settings)).toEqual(settings);
  expect(filterProfileSettingsSchema.parse({
    ...settings, by: "alice", rules: { version: 1, rules: [] },
  }).by).toBe("alice");
  expect(filterProfileSettingsSchema.safeParse({ ...settings, extra: true }).success).toBe(false);
  expect(filterProfileSettingsSchema.safeParse({
    ...settings, request: "x".repeat(4000), hiddenFolders: ["x".repeat(4096)],
  }).success).toBe(true);
  expect(filterProfileSettingsSchema.safeParse({ ...settings, hiddenFolders: Array(500).fill("folder") }).success).toBe(true);
});

test("persists complete settings across processes and lists trimmed names in order", async () => {
  const path = databasePath();
  await run(`
    assert.deepEqual(await api.list(scope), []);
    const full = {
      ...settings, by: "alice", rulesEnabled: true,
      rules: { version: 1, summary: "Generated files", rules: [
        { name: "Generated", paths: ["**/generated/**"] },
        { name: "Exact", changes: [{ path: "src/a.ts", patchHash: "patch", oldLine: 1, newLine: 1 }] },
      ] },
    };
    const zulu = await api.save({ ...scope, name: "  Zulu  ", settings: full });
    const alpha = await api.save({ ...scope, name: "Alpha", settings });
    assert.deepEqual(zulu, { id: 1, name: "Zulu", settings: full });
    assert.deepEqual(await api.list(scope), [alpha, zulu]);
    assert.deepEqual(await filterProfilesRouter.createCaller({}).list(scope), [alpha, zulu]);
  `, path);
  await run(`
    const saved = await api.list(scope);
    assert.deepEqual(saved.map(row => [row.id, row.name]), [[2, "Alpha"], [1, "Zulu"]]);
    assert.deepEqual(saved[0].settings, settings);
    assert.equal(saved[1].settings.by, "alice");
    assert.equal(saved[1].settings.rulesEnabled, true);
    assert.deepEqual(saved[1].settings.rules.rules[1].changes, [
      { path: "src/a.ts", patchHash: "patch", oldLine: 1, newLine: 1 },
    ]);
  `, path);
});

test("isolates names, lists, and updates across repositories and sources", async () => {
  await run(`
    const scopes = [scope, { ...scope, repo: "owner/other" }, { ...scope, sourceId: 2 }];
    const saved = [];
    for (const [index, current] of scopes.entries()) {
      saved.push(await api.save({ ...current, name: "Daily", settings: { ...settings, by: String(index) } }));
    }
    for (const [index, current] of scopes.entries()) {
      assert.deepEqual(await api.list(current), [saved[index]]);
    }
    for (const current of scopes.slice(1)) {
      await assert.rejects(api.save({ ...current, id: saved[0].id, name: "Daily", settings }), { code: "NOT_FOUND" });
    }
    for (const [index, current] of scopes.entries()) {
      assert.deepEqual(await api.list(current), [saved[index]]);
    }
    assert.deepEqual(await api.list({ ...scope, repo: "empty/repo" }), []);
  `);
});

test("rejects duplicate creates and renames, updates in place, and reports missing IDs", async () => {
  await run(`
    const first = await api.save({ ...scope, name: "Daily", settings });
    const second = await api.save({ ...scope, name: "Other", settings });
    await assert.rejects(api.save({ ...scope, name: " Daily ", settings }), { code: "CONFLICT" });
    await assert.rejects(api.save({ ...scope, id: first.id, name: second.name, settings: { ...settings, by: "changed" } }), { code: "CONFLICT" });
    assert.deepEqual(await api.list(scope), [first, second]);
    const updated = await api.save({ ...scope, id: first.id, name: "Daily", settings: { ...settings, hideTests: false } });
    assert.deepEqual(updated, { ...first, settings: { ...settings, hideTests: false } });
    const renamed = await api.save({ ...scope, id: first.id, name: "Renamed", settings });
    assert.deepEqual(renamed, { ...first, name: "Renamed" });
    await assert.rejects(api.save({ ...scope, id: 999, name: "Other", settings }), { code: "NOT_FOUND" });
    assert.deepEqual(await api.list(scope), [second, renamed]);
    assert.throws(() => db.insert(filterProfiles).values({ ...scope, name: "Other", settings }).run(), { code: "SQLITE_CONSTRAINT_UNIQUE" });
  `);
});

test("validates required fields, bounds, IDs, and nested rules before saving", async () => {
  await run(`
    const valid = { ...scope, name: "Daily", settings };
    for (const key of Object.keys(settings)) {
      const missing = { ...settings };
      delete missing[key];
      await assert.rejects(api.save({ ...valid, settings: missing }), { code: "BAD_REQUEST" });
    }
    for (const invalid of [
      { hideTests: "true" }, { hideCommentChanges: 1 }, { hideReviewComments: null },
      { rulesEnabled: "false" }, { hiddenFolders: [""] }, { hiddenFolders: [123] },
      { hiddenFolders: ["x".repeat(4097)] }, { hiddenFolders: Array(501).fill("folder") },
      { request: "x".repeat(4001) }, { by: 123 }, { extra: true },
      { rules: { version: 2, rules: [] } },
      { rules: { version: 1, rules: [{ name: "Missing selectors" }] } },
      { rules: { version: 1, rules: [], extra: true } },
    ]) {
      await assert.rejects(api.save({ ...valid, settings: { ...settings, ...invalid } }), { code: "BAD_REQUEST" });
    }
    for (const invalid of [
      { name: "  " }, { name: "x".repeat(81) }, { repo: "" }, { repo: "x".repeat(1001) },
      { id: 0 }, { id: -1 }, { id: 1.5 },
    ]) {
      await assert.rejects(api.save({ ...valid, ...invalid }), { code: "BAD_REQUEST" });
    }
    await assert.rejects(api.list({ ...scope, repo: "" }), { code: "BAD_REQUEST" });
    await assert.rejects(api.remove({ ...scope, id: 0 }), { code: "BAD_REQUEST" });
    assert.deepEqual(await api.list(scope), []);
    await api.save({ ...valid, name: "x".repeat(80), settings: { ...settings, hiddenFolders: [], request: "" } });
  `);
});

test("validates sources through sourceProcedure without contacting a forge", async () => {
  await run(`
    const missing = { ...scope, sourceId: 999 };
    await assert.rejects(api.list(missing), { code: "NOT_FOUND" });
    await assert.rejects(api.save({ ...missing, name: "Daily", settings }), { code: "NOT_FOUND" });
    await assert.rejects(api.remove({ ...missing, id: 1 }), { code: "NOT_FOUND" });
    await assert.rejects(api.list({ ...scope, sourceId: "1" }), { code: "BAD_REQUEST" });
    assert.deepEqual(db.select().from(filterProfiles).all(), []);
  `);
});

test("removes only the scoped profile and cascades source deletion", async () => {
  await run(`
    const otherRepo = { ...scope, repo: "owner/other" };
    const otherSource = { ...scope, sourceId: 2 };
    const first = await api.save({ ...scope, name: "Daily", settings });
    const second = await api.save({ ...otherRepo, name: "Daily", settings });
    const third = await api.save({ ...otherSource, name: "Daily", settings });
    await api.remove({ ...otherRepo, id: first.id });
    await api.remove({ ...otherSource, id: first.id });
    assert.deepEqual(await api.list(scope), [first]);
    assert.deepEqual(await api.list(otherRepo), [second]);
    assert.deepEqual(await api.list(otherSource), [third]);
    await api.remove({ ...scope, id: first.id });
    await api.remove({ ...scope, id: first.id });
    assert.deepEqual(await api.list(scope), []);
    assert.deepEqual(await api.list(otherRepo), [second]);
    db.delete(sources).where(eq(sources.id, scope.sourceId)).run();
    assert.deepEqual(db.select().from(filterProfiles).all(), [{ ...third, ...otherSource }]);
  `);
});

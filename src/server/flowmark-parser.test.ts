import { expect, test } from "bun:test";
import example from "../vendor/flowmark/example.txt";
import { parseFlowmark } from "./flowmark-parser";

test("runs the real Flowmark parser and preserves risks, levels, and checker findings", async () => {
  const model = await parseFlowmark({ base: "", head: example });
  expect(model.model_version).toBe(1);
  expect(model.title).toBe("Register user");
  expect(model.typechecked).toBe(true);
  expect(model.diagnostics).toContainEqual(expect.objectContaining({ code: "W060", severity: "warning" }));
  expect(model.risks).toHaveLength(5);
  expect((model.rows as { level: number }[]).some(row => row.level === 3)).toBe(true);
  expect(model.sides).toBeUndefined();
});

test("checks prelude types on both sides and catches errors that pass syntax checking", async () => {
  const model = await parseFlowmark({ base: example.replace("retries: 2", 'retries: "many"'), head: example });
  expect(model.typechecked).toBe(false);
  expect(model.sides?.base.diagnostics.some(d => d.code.startsWith("TS") && d.severity === "error")).toBe(true);
  expect(model.sides?.head.typechecked).toBe(true);
});

test("builds Changes / Before / After using actual before and after documents", async () => {
  const head = example.replace('retries: 2', 'retries: 5');
  const model = await parseFlowmark({ base: example, head });
  const sides = model.sides as { base: { rows: unknown[] }; head: { rows: unknown[] } };
  expect(sides.base.rows.length).toBeGreaterThan(50);
  expect(JSON.stringify(sides.base)).toContain('2');
  expect(JSON.stringify(sides.head)).toContain('5');
  expect(model.changes).toMatchObject({ lines_added: 1, lines_removed: 1 });
});

test("malformed reviews report diagnostics without evaluating review code", async () => {
  const model = await parseFlowmark({ base: "", head: '// flowmark 0.1\nglobalThis.__flowmarkExecuted = true;\nconst broken = {' });
  expect(model.diagnostics.some(d => d.severity === "error")).toBe(true);
  expect((globalThis as any).__flowmarkExecuted).toBeUndefined();
  await expect(parseFlowmark({ base: "", head: "x".repeat(80001) })).rejects.toThrow();
  await expect(parseFlowmark({ base: "", head: example }, AbortSignal.abort())).rejects.toThrow("Cancelled");
});

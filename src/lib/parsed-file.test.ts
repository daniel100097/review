import { expect, test } from "bun:test";
import { compileFilterRules, type FilterRules } from "./filter-rules";
import { changeView, expanded, parse, type File } from "./parsed-file";

const file = (patch: string): File => ({
  oldPath: "src/main.ts", newPath: "src/main.ts", status: "modified", patch, patchHash: patch, viewed: false,
});
const rules = (patterns: string[]) => compileFilterRules({ version: 1, rules: [{ name: "Debug", lines: patterns }] } satisfies FilterRules);

test("combines custom and comment filters without losing original positions", () => {
  const parsed = parse(file([
    "@@ -1,5 +1,6 @@", " const start = 1;", "+// explains the code", " const middle = 2;",
    '-console.debug("old");', '+console.debug("new");', " const end = 3;", "-run(1);", "+run(2);",
  ].join("\n")));
  const filters = rules(["console.debug(*);"]);
  const view = changeView(parsed, true, filters);
  expect(view.hiddenCount).toBe(3);
  expect(view.allHidden).toBe(false);
  expect(view.view).toEqual([0, 1, { first: 2, hidden: 1 }, 3, { first: 4, hidden: 2 }, 6, 7, 8]);
  expect(parsed.lines[8]).toMatchObject({ kind: "add", newLine: 6, content: "run(2);" });
  // Pausing either filter recomputes the view without mutating the original patch.
  expect(changeView(parsed, false, filters).hiddenCount).toBe(2);
  expect(changeView(parsed, true).hiddenCount).toBe(1);
  expect(changeView(parsed, false).view).toEqual(parsed.lines.map((_, i) => i));
});

test("drops a file only when combined filters hide every textual change", () => {
  const parsed = parse(file('@@ -1,2 +1,4 @@\n+// comment\n keep();\n+console.debug("x");\n done();'));
  const filters = rules(["console.debug(*);"]);
  expect(changeView(parsed, false, filters).allHidden).toBe(false);
  expect(changeView(parsed, true).allHidden).toBe(false);
  expect(changeView(parsed, true, filters).allHidden).toBe(true);
  expect(changeView(parse(file("")), true, filters).allHidden).toBe(false);
});

test("expanded context keeps filtering and anchors to the same changed lines", () => {
  const parsed = parse(file('@@ -3,3 +3,3 @@\n-console.debug("old");\n+console.debug("new");\n keep();\n-old();\n+newCall();'));
  const filters = rules(["console.debug(*);"]);
  const after = expanded(parsed, { revealed: [[1, 2]], content: ["first();", "second();", 'console.debug("new");', "keep();", "newCall();"] });
  const view = changeView(after, false, filters);
  expect(view.hiddenCount).toBe(2);
  expect(view.view.filter(item => typeof item === "number").map(i => after.lines[i]!.content)).toContain("newCall();");
  expect(after.lines.find(line => line.content === "newCall();")?.newLine).toBe(5);
  const unfiltered = changeView(after, false);
  expect(unfiltered.view).toHaveLength(after.lines.length);
});

test("filters preserve gap controls and explicitly expanded context around hidden hunks", () => {
  const parsed = parse(file('@@ -3 +3 @@\n-console.debug("old");\n+console.debug("new");\n@@ -8 +8 @@\n-old();\n+newCall();'));
  const filters = rules(["console.debug(*);"]);
  const initial = expanded(parsed, undefined);
  for (const gap of initial.gaps!.keys()) expect(changeView(initial, false, filters).view).toContain(gap);
  const after = expanded(parsed, { revealed: [[2, 2], [9, 10]], content: Array.from({ length: 20 }, (_, i) => `line ${i + 1}`) });
  const view = changeView(after, false, filters);
  const shown = view.view.filter(item => typeof item === "number").map(i => after.lines[i]!);
  expect(shown.map(l => l.content)).toContain("line 2");
  expect(shown.map(l => l.content)).toContain("line 9");
  expect(shown.map(l => l.content)).not.toContain('console.debug("new");');
  for (const gap of after.gaps!.keys()) expect(view.view).toContain(gap);
});

test.each(["renamed", "added", "deleted"] as const)("exact text selections keep %s file metadata visible", status => {
  const patch = status === "added" ? "@@ -0,0 +1 @@\n+after();"
    : status === "deleted" ? "@@ -1 +0,0 @@\n-before();" : "@@ -1 +1 @@\n-before();\n+after();";
  const f = { ...file(patch), status };
  if (status === "renamed") f.oldPath = "src/previous.ts";
  const parsed = parse(f);
  const filters = compileFilterRules({ version: 1, rules: [{
    name: "Selected replacement",
    changes: [{ path: f.newPath, patchHash: f.patchHash, oldLine: status === "added" ? null : 1, newLine: status === "deleted" ? null : 1 }],
  }] });
  expect(filters.hidesFile(f)).toBe(false);
  expect(changeView(parsed, false, filters)).toMatchObject({ hiddenCount: status === "renamed" ? 2 : 1, allHidden: false });
});

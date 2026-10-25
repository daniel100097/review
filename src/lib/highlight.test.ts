import { expect, test } from "bun:test";
import { parseHunks } from "./diff";
import { highlightDiff, languageFor } from "./highlight";

test("detects languages from paths", () => {
  expect(languageFor("src/app.tsx")).toBe("tsx");
  expect(languageFor("lib/mod.mts")).toBe("ts");
  expect(languageFor("styles/site.scss")).toBe("css");
  expect(languageFor("docker/Dockerfile")).toBe("dockerfile");
  expect(languageFor(".env.example")).toBe("env");
  expect(languageFor("pnpm-lock.yaml")).toBe("yaml");
  expect(languageFor("LICENSE")).toBe("plaintext");
});

test("highlights each side of a hunk with context", () => {
  const lines = parseHunks(
    ["@@ -1,3 +1,3 @@", " const a = `one", "-two`;", "+three`;", " // done"].join("\n"),
  );
  const tokens = highlightDiff("x.ts", lines);
  const text = (i: number) => tokens[i]?.map(t => `${t.className ?? "-"}:${t.value}`);

  expect(tokens[0]).toBeUndefined(); // hunk header
  expect(text(1)).toEqual(["keyword:const", "-: a = ", "string:`one"]);
  // Both continuation lines are inside the template string started on the context line.
  expect(text(2)).toEqual(["string:two`", "-:;"]);
  expect(text(3)).toEqual(["string:three`", "-:;"]);
  expect(text(4)).toEqual(["comment:// done"]);
});

test("leaves plaintext unhighlighted", () => {
  expect(highlightDiff("NOTES", parseHunks("@@ -1 +1 @@\n-a\n+b"))).toEqual([undefined, undefined, undefined]);
});

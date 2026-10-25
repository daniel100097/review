import { expect, test } from "bun:test";
import { isInHiddenFolder, isTestOrGenerated } from "./hidden-files";

const file = (path: string) => ({ newPath: path, oldPath: path });

test("matches tests, mocks and generated code", () => {
  for (const path of [
    "src/product.service.spec.ts",
    "src/greet.test.tsx",
    "pkg/server_test.go",
    "e2e/login.ts",
    "packages/api/test/setup.ts",
    "src/__tests__/a.ts",
    "src/__mocks__/fs.ts",
    "tests/visual.spec.ts-snapshots/home.png",
    "packages/api/src/init-testing.ts",
    "playwright.config.ts",
    "vitest.config.mts",
    "playwright-ct.config.ts",
    "src/generated/client.ts",
    "api/schema.gen.go",
    "packages/panel/src/lib/openapi/types.ts",
    "docs/openapi.json",
  ])
    expect(isTestOrGenerated(file(path))).toBe(true);
});

test("leaves regular source alone", () => {
  for (const path of ["src/testing-utils-docs.md", "src/contest.ts", "src/latest/index.ts", "src/product.service.ts"])
    expect(isTestOrGenerated(file(path))).toBe(false);
});

test("matches renamed files by their old path too", () => {
  expect(isTestOrGenerated({ newPath: "src/a.ts", oldPath: "src/a.test.ts" })).toBe(true);
});

test("hides files inside hidden folders only", () => {
  const hidden = ["packages/service-go"];
  expect(isInHiddenFolder(file("packages/service-go/main.go"), hidden)).toBe(true);
  expect(isInHiddenFolder(file("packages/service-golang/main.go"), hidden)).toBe(false);
});

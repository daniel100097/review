import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { File } from "./diff-list";
import { buildTree, FileTree } from "./file-tree";

const file = (path: string, changes: Partial<File> = {}): File => ({
  oldPath: path, newPath: path, status: "modified", patch: "", patchHash: "", viewed: false, ...changes,
});
const noop = () => {};

test("counts all filtered descendants and keeps automatic-hidden folders inspectable", () => {
  const html = renderToStaticMarkup(
    <FileTree
      tree={buildTree([
        file("src/main.ts"),
        file("src/hidden.ts", { status: "added", viewed: true }),
        file("src/tests/main.test.ts"),
      ])}
      hiddenFolders={[]}
      visiblePaths={new Set(["src/main.ts"])}
      onSelect={noop}
      onFolderHiddenChange={noop}
    />,
  );
  expect(html).toContain('aria-label="src (2 hidden)"');
  expect(html).toContain('(2 hidden)</span>');
  expect(html).toContain('text-warning');
  const folder = html.match(/<button[^>]*title="src\/tests"[^>]*>/)?.[0];
  expect(folder).toContain('aria-expanded="false"');
  expect(folder).not.toContain(' disabled=""');
  expect(html).not.toContain('main.test.ts');
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*title="Current filters hide src\/tests; reset filters to show it"/);
  expect(html).toMatch(/<button[^>]*title="Hide src"/);
  expect(html).toMatch(/<button[^>]*title="src\/hidden.ts \(hidden by current filters\)"[^>]*disabled=""/);
  expect(html).toContain('lucide-circle-check');
  expect(html.match(/<button[^>]*title="src\/main.ts"[^>]*>/)?.[0]).not.toContain(' disabled=""');
});

test("falls back to manual folders, including merged parents and renamed files", () => {
  const html = renderToStaticMarkup(
    <FileTree
      tree={buildTree([
        file("pkg/src/hidden.ts"),
        file("src/renamed.ts", { oldPath: "pkg/old.ts", status: "renamed" }),
        file("src/main.ts"),
      ])}
      hiddenFolders={["pkg"]}
      onSelect={noop}
      onFolderHiddenChange={noop}
    />,
  );
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*title="pkg\/src"[^>]*aria-expanded="false"/);
  expect(html).toContain('title="Show pkg (other filters still apply)"');
  expect(html).not.toContain('pkg/src/hidden.ts');
  expect(html).toContain('aria-label="src (1 hidden)"');
  expect(html).toMatch(/<button[^>]*title="src\/renamed.ts \(hidden by current filters\)"[^>]*disabled=""/);
});

test("marks the current file and describes status and viewed state for screen readers", () => {
  const html = renderToStaticMarkup(
    <FileTree
      tree={buildTree([file("src/a.ts", { status: "added", viewed: true }), file("src/b.ts")])}
      hiddenFolders={[]}
      current="src/b.ts"
      onSelect={noop}
      onFolderHiddenChange={noop}
    />,
  );
  expect(html).toContain('aria-label="src/a.ts, added, viewed"');
  expect(html).toMatch(/<button[^>]*aria-label="src\/b.ts"[^>]*aria-current="true"/);
  expect(html.match(/aria-current/g)).toHaveLength(1);
});

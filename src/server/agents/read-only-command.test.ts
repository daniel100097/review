import { expect, test } from "bun:test";
import { isReadOnlyCommand, splitCommand } from "./read-only-command";

test("splits on pipes and command lists, respecting quotes", () => {
  expect(splitCommand(`rg -n "a|b" src | head -20 && echo 'x; y'`)).toEqual([
    ["rg", "-n", "a|b", "src"],
    ["head", "-20"],
    ["echo", "x; y"],
  ]);
  expect(splitCommand(`cat a > b`)).toBeUndefined();
  expect(splitCommand(`echo "$(rm -rf x)"`)).toBeUndefined();
  expect(splitCommand(`ls &`)).toBeUndefined();
});

test.each([
  `rg -n "calculateTotal|price" packages/api/src`,
  `sed -n '120,220p' packages/api/src/price.ts`,
  `cd packages/api && rg --files src | grep spec | wc -l`,
  `git log --oneline -5 -- src/a.ts`,
  `git -C /repo --no-pager blame -L 10,20 src/a.ts`,
  `find . -name "*.ts" -not -path "*/node_modules/*"`,
  `rg foo src 2>/dev/null`,
  `"rg -n foo src"`,
  `bash -lc 'rg -n foo src | head'`,
  `ls packages/*/src`,
])("allows %s", command => expect(isReadOnlyCommand(command)).toBe(true));

test.each([
  `python3 -c 'from pathlib import Path; Path("x").write_text("hi")'`,
  `"python3 -c 'print(1)'"`,
  `echo hi > written.txt`,
  `sed -i 's/a/b/' file`,
  `sed -n '1w out' file`,
  `find . -name x -delete`,
  `find . -exec rm {} ;`,
  `rg --pre ./script foo`,
  `git diff --output=x`,
  `git checkout main`,
  `git -c core.pager=sh log`,
  `sort -o out in`,
  `uniq in out`,
  `rm -rf src`,
  `bash -lc 'touch x'`,
  `cat $(echo x)`,
  `xargs rm < files`,
])("denies %s", command => expect(isReadOnlyCommand(command)).toBe(false));

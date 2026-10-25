import type { DiffLine } from "./diff";
import type { HighlightToken } from "./highlight";

type Tokens = (HighlightToken[] | undefined)[];

const isChange = (line: DiffLine) => line.kind === "add" || line.kind === "del";

/**
 * Comments that change what tools do: shebangs, Go build tags and embeds, type-checker and linter
 * suppressions. Changing one isn't a comment-only change, so these count as code.
 */
const directive =
  /^(#!|\/\/\/\s*<reference)|^(\/\/|#|\/\*+|--)\s*(go:|@ts-|(eslint|oxlint|biome|prettier|istanbul|c8|tslint|jshint)\b|noqa|type:\s*ignore|pylint:|mypy:|nolint|rubocop:|phpcs:|@phpstan-|@psalm-|swiftlint:|NOLINT|NOSONAR|webpack\w*:|@vite-ignore|@jsx)/i;

const isComment = (token: HighlightToken) => token.className === "comment" && !directive.test(token.value.trimStart());

/** The line without its comments, ignoring trailing whitespace. */
const codeOf = (line: DiffLine, tokens: HighlightToken[] | undefined) =>
  (tokens ? tokens.filter(t => !isComment(t)).map(t => t.value).join("") : line.content).trimEnd();

const hasComment = (tokens: HighlightToken[] | undefined) => tokens?.some(t => isComment(t) && t.value.trim()) ?? false;

/**
 * Marks lines in runs of changes that only touch comments: with comments removed, the deleted and
 * added code is identical. Comments come from the language's tokenizer, so a file with no known
 * language never matches.
 */
export function commentOnlyLines(lines: DiffLine[], tokens: Tokens): boolean[] {
  const result = lines.map(() => false);
  let start = 0;
  while (start < lines.length) {
    if (!isChange(lines[start]!)) {
      start++;
      continue;
    }
    let end = start;
    while (end < lines.length && isChange(lines[end]!)) end++;

    const group = lines.slice(start, end).map((line, i) => ({ line, tokens: tokens[start + i] }));
    const code = (kind: DiffLine["kind"]) =>
      group
        .filter(g => g.line.kind === kind)
        .map(g => codeOf(g.line, g.tokens))
        .filter(Boolean)
        .join("\n");
    if (group.some(g => hasComment(g.tokens)) && code("del") === code("add")) result.fill(true, start, end);
    start = end;
  }
  return result;
}

/** A line to show (its index), or a marker for hidden comment-only lines. */
export type ViewItem = number | { hidden: number; first: number };

/**
 * Drops comment-only changes from a diff. Hunks left without changes are dropped entirely; inside
 * other hunks a marker replaces each hidden run. `onlyComments` is set when nothing is left.
 */
export function withoutCommentChanges(lines: DiffLine[], tokens: Tokens) {
  const commentOnly = commentOnlyLines(lines, tokens);
  const view: ViewItem[] = [];
  let hunk: number[] = [];

  const flush = () => {
    const keep = hunk.some(i => isChange(lines[i]!) && !commentOnly[i]);
    if (keep) {
      for (const i of hunk) {
        const last = view.at(-1);
        if (!commentOnly[i]) view.push(i);
        else if (typeof last === "object") last.hidden++;
        else view.push({ hidden: 1, first: i });
      }
    }
    hunk = [];
  };
  lines.forEach((line, i) => {
    if (line.kind === "hunk") flush();
    hunk.push(i);
  });
  flush();

  return { view, onlyComments: lines.length > 0 && view.length === 0 };
}

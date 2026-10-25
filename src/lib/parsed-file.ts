import { withoutCommentChanges } from "./comment-changes";
import { parseHunks, type DiffLine } from "./diff";
import { highlightDiff, type HighlightToken } from "./highlight";
import type { RouterOutputs } from "./trpc";

export type File = RouterOutputs["pulls"]["files"][number];

export interface ParsedFile {
  file: File;
  lines: DiffLine[];
  additions: number;
  deletions: number;
}

// Keyed by the query's file objects, so each file is parsed, highlighted and analyzed once.
const parsedCache = new WeakMap<File, ParsedFile>();
const tokensCache = new WeakMap<ParsedFile, (HighlightToken[] | undefined)[]>();
const commentViewCache = new WeakMap<ParsedFile, ReturnType<typeof withoutCommentChanges>>();

export function parse(file: File) {
  let parsed = parsedCache.get(file);
  if (!parsed) {
    const lines = parseHunks(file.patch);
    parsed = {
      file,
      lines,
      additions: lines.filter(l => l.kind === "add").length,
      deletions: lines.filter(l => l.kind === "del").length,
    };
    parsedCache.set(file, parsed);
  }
  return parsed;
}

export function tokensFor(parsed: ParsedFile) {
  let tokens = tokensCache.get(parsed);
  if (!tokens) {
    tokens = highlightDiff(parsed.file.newPath, parsed.lines);
    tokensCache.set(parsed, tokens);
  }
  return tokens;
}

/** The file's diff with comment-only changes left out. */
export function commentView(parsed: ParsedFile) {
  let view = commentViewCache.get(parsed);
  if (!view) {
    view = withoutCommentChanges(parsed.lines, tokensFor(parsed));
    commentViewCache.set(parsed, view);
  }
  return view;
}

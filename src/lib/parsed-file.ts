import { commentOnlyLines, withoutChanges } from "./comment-changes";
import { parseHunks, type DiffLine } from "./diff";
import { expandLines, type Gap, type LineRange } from "./expand";
import { highlightDiff, type HighlightToken } from "./highlight";
import type { CompiledFilterRules } from "./filter-rules";
import type { RouterOutputs } from "./trpc";

export type File = RouterOutputs["pulls"]["files"][number];

export interface ParsedFile {
  file: File;
  lines: DiffLine[];
  additions: number;
  deletions: number;
  /** Unchanged lines hidden at hunk headers, by line index; set where they can be shown. */
  gaps?: Map<number, Gap>;
  /** Unchanged context the reviewer explicitly expanded. */
  revealedLines?: Set<DiffLine>;
}

/** Unchanged lines shown around a file's diff, from the new file (`content`) once it's loaded. */
export interface Expansion {
  revealed: LineRange[];
  content?: string[];
  error?: string;
}

// Keyed by the query's file objects, so each file is parsed, highlighted and analyzed once.
const parsedCache = new WeakMap<File, ParsedFile>();
const tokensCache = new WeakMap<ParsedFile, (HighlightToken[] | undefined)[]>();
const expandedCache = new WeakMap<ParsedFile, { expansion?: Expansion; parsed: ParsedFile }>();
const changeViewCache = new WeakMap<ParsedFile, {
  hideComments: boolean;
  rules?: CompiledFilterRules;
  result: ReturnType<typeof withoutChanges> & { hiddenCount: number };
}>();

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

/** Combines filters before dropping hunks, so the sidebar and diff agree on which changes remain. */
export function changeView(parsed: ParsedFile, hideComments: boolean, rules?: CompiledFilterRules) {
  let cached = changeViewCache.get(parsed);
  if (!cached || cached.hideComments !== hideComments || cached.rules !== rules) {
    const hidden = rules?.hiddenLines(parsed.file, parsed.lines) ?? parsed.lines.map(() => false);
    if (hideComments) {
      commentOnlyLines(parsed.lines, tokensFor(parsed)).forEach((value, i) => { hidden[i] ||= value; });
    }
    const hiddenCount = hidden.filter(Boolean).length;
    // Preserve context expansion (including the trailing gap) when no change is hidden.
    const result = hiddenCount
      ? { ...withoutChanges(parsed.lines, hidden, i => Boolean(parsed.gaps?.has(i) || parsed.revealedLines?.has(parsed.lines[i]!))), hiddenCount }
      : { view: parsed.lines.map((_, i) => i), allHidden: false, hiddenCount };
    // Text selections must not hide file creation, deletion or rename metadata.
    if (parsed.file.status !== "modified") result.allHidden = false;
    cached = { hideComments, rules, result };
    changeViewCache.set(parsed, cached);
  }
  return cached.result;
}

/** The file with the unchanged lines `expansion` reveals, and its gaps. */
export function expanded(parsed: ParsedFile, expansion: Expansion | undefined) {
  // Added and deleted files are shown whole, binary files have no lines.
  if (parsed.file.status === "added" || parsed.file.status === "deleted" || parsed.lines.length === 0) return parsed;
  let cached = expandedCache.get(parsed);
  if (!cached || cached.expansion !== expansion) {
    const { lines, gaps, added } = expandLines(parsed.lines, expansion?.content, expansion?.revealed ?? []);
    cached = { expansion, parsed: { ...parsed, lines, gaps, revealedLines: added } };
    expandedCache.set(parsed, cached);
  }
  return cached.parsed;
}

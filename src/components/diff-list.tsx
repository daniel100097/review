import { CommentItem, type Comment } from "@/components/comment";
import type { ContributorFilter } from "@/components/contributors";
import { Markdown } from "@/components/markdown";
import { LineComposer, QuestionThreadView, type QuestionActions, type QuestionThread } from "@/components/question-thread";
import { riskBadge, type WalkthroughGroup } from "@/components/walkthrough";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import type { DiffLine } from "@/lib/diff";
import type { AgentModel } from "@/lib/agents";
import type { ViewItem } from "@/lib/comment-changes";
import { highlightCss } from "@/lib/highlight";
import { commentView, parse, tokensFor, type File, type ParsedFile } from "@/lib/parsed-file";
import { cn } from "@/lib/utils";
import type { LinePosition } from "@/server/providers/types";
import { defaultRangeExtractor, useWindowVirtualizer, type Range } from "@tanstack/react-virtual";
import { ChevronDown, Plus } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";

export type { File };

/** Diffs longer than this start collapsed, like lockfiles and generated code. */
const largeDiffLines = 500;
/** The app header (h-12) that rows scroll under; file headers stick below it. */
const appHeaderHeight = 48;

type Row = { key: string } & (
  | { kind: "gap" }
  /** Starts a walkthrough group; `group` is undefined for files the walkthrough doesn't mention. */
  | { kind: "group"; index: number; count: number; group?: WalkthroughGroup }
  | { kind: "header"; parsed: ParsedFile; collapsed: boolean; closed: boolean }
  /** `by`: another contributor's change, when showing one contributor's. */
  | { kind: "line"; parsed: ParsedFile; index: number; selected: boolean; by?: string; last: boolean }
  | {
      kind: "thread";
      parsed: ParsedFile;
      index: number;
      comments: Comment[];
      questions: QuestionThread[];
      composing: boolean;
      last: boolean;
    }
  | { kind: "note"; parsed: ParsedFile; large: boolean; last: boolean }
  | { kind: "hiddenComments"; parsed: ParsedFile; count: number; last: boolean }
  | { kind: "outdated"; parsed: ParsedFile; comments: Comment[]; questions: QuestionThread[]; last: boolean }
);

/** Selected lines `from`..`to` (indexes into the file's lines); the form opens below `to`. */
type Composer = { path: string; from: number; to: number };

const estimatedHeight: Record<Row["kind"], number> = {
  gap: 16,
  group: 110,
  header: 40,
  line: 20,
  thread: 140,
  note: 46,
  hiddenComments: 20,
  outdated: 120,
};

const isAt = (line: DiffLine, p: LinePosition) =>
  line.kind !== "hunk" &&
  (p.newLine !== undefined ? line.newLine === p.newLine : line.newLine === undefined && line.oldLine === p.oldLine);

function buildRows(
  parsedFiles: ParsedFile[],
  comments: Comment[],
  questions: QuestionThread[],
  isCollapsed: (parsed: ParsedFile) => boolean,
  composer: Composer | null,
  hideCommentChanges: boolean,
  groups: WalkthroughGroup[] | undefined,
  contributor: ContributorFilter | undefined,
) {
  const rows: Row[] = [];
  const headerIndex = new Map<string, number>();
  const groupIndex: number[] = [];
  const groupOf = new Map(groups?.flatMap((g, i) => g.files.map(path => [path, i] as const)));
  let currentGroup: number | undefined;

  parsedFiles.forEach((parsed, fileIndex) => {
    const { file, lines } = parsed;
    const path = file.newPath;
    const collapsed = isCollapsed(parsed);
    if (fileIndex > 0) rows.push({ kind: "gap", key: `gap:${path}` });
    if (groups) {
      const index = groupOf.get(path) ?? groups.length;
      if (index !== currentGroup) {
        currentGroup = index;
        groupIndex[index] = rows.length;
        rows.push({ kind: "group", key: `group:${index}`, index, count: groups.length, group: groups[index] });
      }
    }
    headerIndex.set(path, rows.length);
    const header: Row & { kind: "header" } = { kind: "header", key: `header:${path}`, parsed, collapsed, closed: true };
    rows.push(header);

    const body: (Row & { last: boolean })[] = [];
    if (collapsed) {
      if (!file.viewed && lines.length > largeDiffLines)
        body.push({ kind: "note", key: `note:${path}`, parsed, large: true, last: false });
    } else if (lines.length === 0) {
      body.push({ kind: "note", key: `note:${path}`, parsed, large: false, last: false });
    } else {
      const authors = contributor?.lines.get(path);
      const authorOf = (i: number) => {
        const line = lines[i]!;
        if (line.kind === "add") return authors?.added.get(line.newLine!);
        if (line.kind === "del") return authors?.deleted.get(line.oldLine!);
      };
      let view = hideCommentChanges ? commentView(parsed).view : lines.map((_, i) => i);
      // Lines nobody could be credited with count as the contributor's, so nothing of theirs gets hidden.
      if (contributor) view = hunksWith(view, lines, i => (authorOf(i)?.key ?? contributor.key) === contributor.key);
      const shown = new Set(view.filter(item => typeof item === "number"));
      const byLine = new Map<number, Comment[]>();
      const outdated: Comment[] = [];
      for (const c of comments) {
        if (c.position!.path !== path && c.position!.oldPath !== file.oldPath) continue;
        const i = lines.findIndex(l => isAt(l, c.position!));
        if (!shown.has(i)) outdated.push(c);
        else byLine.set(i, [...(byLine.get(i) ?? []), c]);
      }
      const questionsByLine = new Map<number, QuestionThread[]>();
      const outdatedQuestions: QuestionThread[] = [];
      for (const q of questions) {
        if (q.path !== path && q.oldPath !== file.oldPath) continue;
        const i = lines.findIndex(l => isAt(l, { ...q, oldLine: q.oldLine ?? undefined, newLine: q.newLine ?? undefined }));
        if (!shown.has(i)) outdatedQuestions.push(q);
        else questionsByLine.set(i, [...(questionsByLine.get(i) ?? []), q]);
      }
      const selecting = composer?.path === path ? composer : undefined;
      view.forEach(index => {
        if (typeof index === "object") {
          const key = `hiddenComments:${path}:${index.first}`;
          body.push({ kind: "hiddenComments", key, parsed, count: index.hidden, last: false });
          return;
        }
        const selected = selecting !== undefined && index >= selecting.from && index <= selecting.to;
        const author = authorOf(index);
        const by = contributor && author && author.key !== contributor.key ? author.name : undefined;
        body.push({ kind: "line", key: `line:${path}:${index}`, parsed, index, selected, by, last: false });
        const composing = selecting?.to === index;
        if (byLine.has(index) || questionsByLine.has(index) || composing) {
          body.push({
            kind: "thread",
            key: `thread:${path}:${index}`,
            parsed,
            index,
            comments: byLine.get(index) ?? [],
            questions: questionsByLine.get(index) ?? [],
            composing,
            last: false,
          });
        }
      });
      if (outdated.length > 0 || outdatedQuestions.length > 0) {
        const key = `outdated:${path}`;
        body.push({ kind: "outdated", key, parsed, comments: outdated, questions: outdatedQuestions, last: false });
      }
    }

    if (body.length > 0) {
      header.closed = false;
      body.at(-1)!.last = true;
    }
    rows.push(...body);
  });

  return { rows, headerIndex, headerIndexes: [...headerIndex.values()], groupIndex };
}

/** Leaves out hunks without a change line that `keep` accepts. */
function hunksWith(view: ViewItem[], lines: DiffLine[], keep: (index: number) => boolean) {
  const hunks: ViewItem[][] = [];
  for (const item of view) {
    if (hunks.length === 0 || (typeof item === "number" && lines[item]!.kind === "hunk")) hunks.push([]);
    hunks.at(-1)!.push(item);
  }
  const isChange = (i: number) => lines[i]!.kind === "add" || lines[i]!.kind === "del";
  return hunks.filter(hunk => hunk.some(item => typeof item === "number" && isChange(item) && keep(item))).flat();
}

export function DiffList({
  files,
  comments,
  questions,
  headSha,
  onViewedChange,
  onComment,
  onAsk,
  questionActions,
  groups,
  jumpTo,
  hideCommentChanges,
  contributor,
}: {
  files: File[];
  /** Inline comments. */
  comments: Comment[];
  /** Local conversations with agents about lines. */
  questions: QuestionThread[];
  /** The pull request's current head, to mark questions asked on earlier pushes. */
  headSha: string;
  onViewedChange: (file: File, viewed: boolean) => void;
  onComment: (body: string, position: LinePosition) => Promise<unknown>;
  /** `excerpt` is the selected lines as text: old and new line numbers, +/-, code. */
  onAsk: (question: string, model: AgentModel, position: LinePosition, excerpt: string) => Promise<unknown>;
  questionActions: QuestionActions;
  /** Scrolls to a file; change `key` to jump again. */
  /** A walkthrough's groups; `files` must come in group order. Adds a header row before each group. */
  groups?: WalkthroughGroup[];
  /** Scrolls to a file or a group (by index); change `key` to jump again. */
  jumpTo?: Jump;
  /** Leaves out changes that only touch comments; see `withoutCommentChanges`. */
  hideCommentChanges: boolean;
  /** Shows one contributor's changes: hunks without any are left out and others' changes dimmed. */
  contributor?: ContributorFilter;
}) {
  const parsedFiles = useMemo(() => files.map(parse), [files]);
  const [collapsedOverrides, setCollapsedOverrides] = useState(() => new Map<string, boolean>());
  const setCollapsed = (path: string, collapsed: boolean) =>
    setCollapsedOverrides(prev => new Map(prev).set(path, collapsed));
  const [composer, setComposer] = useState<Composer | null>(null);

  const { rows, headerIndex, headerIndexes, groupIndex } = useMemo(
    () =>
      buildRows(
        parsedFiles,
        comments,
        questions,
        p => collapsedOverrides.get(p.file.newPath) ?? (p.file.viewed || p.lines.length > largeDiffLines),
        composer,
        hideCommentChanges,
        groups,
        contributor,
      ),
    [parsedFiles, comments, questions, collapsedOverrides, composer, hideCommentChanges, groups, contributor],
  );
  const maxLine = useMemo(() => {
    let max = 1;
    for (const { lines } of parsedFiles) for (const l of lines) max = Math.max(max, l.oldLine ?? 0, l.newLine ?? 0);
    return max;
  }, [parsedFiles]);
  const composerRow = composer ? rows.findIndex(r => r.key === `thread:${composer.path}:${composer.to}`) : -1;

  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  // Content above the list (like the walkthrough panel) can change height, so measure after every render too.
  const measure = () => setScrollMargin(listRef.current!.getBoundingClientRect().top + window.scrollY);
  useLayoutEffect(measure);
  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: useCallback((i: number) => estimatedHeight[rows[i]!.kind], [rows]),
    getItemKey: useCallback((i: number) => rows[i]!.key, [rows]),
    overscan: 30,
    scrollMargin,
    scrollPaddingStart: appHeaderHeight,
    // Measuring inside the ResizeObserver callback re-renders synchronously, which
    // resizes observed rows again and triggers "ResizeObserver loop completed".
    useAnimationFrameWithResizeObserver: true,
    rangeExtractor: useCallback(
      (range: Range) => {
        const indexes = new Set(defaultRangeExtractor(range));
        // Keep the current file's header mounted so it can stick, and an open
        // comment form so its draft survives scrolling away.
        const header = headerIndexes.findLast(i => i <= range.startIndex);
        if (header !== undefined) indexes.add(header);
        if (composerRow !== -1) indexes.add(composerRow);
        return [...indexes].sort((a, b) => a - b);
      },
      [headerIndexes, composerRow],
    ),
  });

  /**
   * Scrolls a row to the top. Rows between here and there may not be measured yet (a long answer is estimated
   * at a few lines), so the first scroll can land off; correct it for a few frames once they render.
   */
  const jumping = useRef<number>(undefined);
  const scrollToRow = (index: number) => {
    jumping.current = index;
    // Newly rendered rows are measured a frame or two later, so wait a little after the last correction.
    const start = performance.now();
    let lastCorrection = start;
    const correct = () => {
      if (jumping.current !== index) return;
      const now = performance.now();
      const [offset] = virtualizer.getOffsetForIndex(index, "start") ?? [];
      if (offset !== undefined && Math.abs(window.scrollY - offset) > 1) {
        window.scrollTo({ top: offset });
        lastCorrection = now;
      } else if (offset === undefined || now - lastCorrection > 200 || now - start > 1500) {
        jumping.current = undefined;
        return;
      }
      requestAnimationFrame(correct);
    };
    correct();
  };

  // Jumps come from the page (file tree, groups) and from shortcuts; the latest wins.
  const [jump, setJump] = useState<Jump>();
  useEffect(() => setJump(jumpTo), [jumpTo]);
  // Runs after every render but acts once per jump, after the list's offset is known and rows are rebuilt.
  const handledJump = useRef<number>(undefined);
  useEffect(() => {
    if (!jump || !scrollMargin || handledJump.current === jump.key) return;
    handledJump.current = jump.key;
    const index = jump.path !== undefined ? headerIndex.get(jump.path) : groupIndex[jump.group!];
    if (index !== undefined) scrollToRow(index);
  });

  /** Where rows start, relative to the top of the window below the app header. */
  const offsetOf = (index: number) =>
    (virtualizer.measurementsCache[index]?.start ?? Infinity) - (virtualizer.scrollOffset ?? 0) - appHeaderHeight;
  /** Index of the file header at the top of the window, i.e. the file being read. */
  const currentHeader = () => headerIndexes.findLast(i => offsetOf(i) <= 1) ?? -1;
  const fileAt = (index: number) => (rows[index] as Row & { kind: "header" }).parsed;
  const nextUnviewed = (after: number, except?: string) =>
    headerIndexes.find(i => i > after && !fileAt(i).file.viewed && fileAt(i).file.newPath !== except) ??
    headerIndexes.find(i => !fileAt(i).file.viewed && fileAt(i).file.newPath !== except);

  // Review shortcuts: j/k files, ]/[ groups, n next unviewed file, v mark viewed and move on.
  const shortcuts = useRef<(e: KeyboardEvent) => void>(undefined);
  shortcuts.current = e => {
    const current = currentHeader();
    const go = (index: number | undefined) => {
      if (index === undefined) return;
      e.preventDefault();
      const row = rows[index]!;
      setJump(row.kind === "group" ? { group: row.index, key: Date.now() } : { path: fileAt(index).file.newPath, key: Date.now() });
    };
    // By position, so they also work right after jumping to a group header (which is above its first file);
    // during a jump, from where it's going, so pressing quickly moves on.
    const groupRows = groupIndex.filter(i => i !== undefined);
    const target = jumping.current;
    const below = (indexes: number[]) => indexes.find(i => (target !== undefined ? i > target : offsetOf(i) > 1));
    const above = (indexes: number[]) => indexes.findLast(i => (target !== undefined ? i < target : offsetOf(i) < -1));
    if (e.key === "j") go(below(headerIndexes));
    else if (e.key === "k") go(above(headerIndexes));
    else if (e.key === "]") go(below(groupRows));
    else if (e.key === "[") go(above(groupRows));
    else if (e.key === "n") go(nextUnviewed(current));
    else if (e.key === "v" && current !== -1) {
      const parsed = fileAt(current);
      view.setViewed(parsed, !parsed.file.viewed);
      if (!parsed.file.viewed) go(nextUnviewed(current, parsed.file.newPath));
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]");
      if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey) shortcuts.current!(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const items = virtualizer.getVirtualItems();
  const stickyLine = (virtualizer.scrollOffset ?? 0) + appHeaderHeight;
  // A file's header sticks while reading it, but not over the next group's band. Jumps can land a pixel off
  // (scroll positions are rounded), so a row that close to the top counts as there.
  const stickyCandidate = items.findLast(item => ["header", "group"].includes(rows[item.index]!.kind) && item.start <= stickyLine + 2);
  const sticky = stickyCandidate && rows[stickyCandidate.index]!.kind === "header" ? stickyCandidate : undefined;

  const view: RowViewProps["actions"] = {
    setCollapsed: (parsed, collapsed) => setCollapsed(parsed.file.newPath, collapsed),
    setViewed: (parsed, viewed) => {
      onViewedChange(parsed.file, viewed);
      setCollapsed(parsed.file.newPath, viewed);
    },
    startComment: (parsed, index, extend) => {
      const path = parsed.file.newPath;
      setComposer(prev =>
        extend && prev?.path === path
          ? { path, from: Math.min(prev.from, index), to: Math.max(prev.to, index) }
          : { path, from: index, to: index },
      );
    },
    cancelComment: () => setComposer(null),
    submitComment: async (parsed, index, body) => {
      await onComment(body, positionOf(parsed, index));
      setComposer(null);
    },
    ask: async (parsed, index, question, model) => {
      const from = composer?.path === parsed.file.newPath ? composer.from : index;
      await onAsk(question, model, positionOf(parsed, index), excerptOf(parsed, from, index));
      setComposer(null);
    },
    selectedLines: () => (composer ? composer.to - composer.from + 1 : 1),
    questionActions,
    headSha,
  };

  return (
    <>
      <style href="tanstack-highlight-theme" precedence="default">
        {highlightCss}
      </style>
      <div
        ref={listRef}
        className="relative"
        style={{ height: virtualizer.getTotalSize(), "--num": `calc(${String(maxLine).length}ch + 1rem)` } as CSSProperties}
      >
        {items.map(item => (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            className={item === sticky ? "sticky top-12 z-10" : "absolute top-0 left-0 w-full"}
            style={item === sticky ? undefined : { transform: `translateY(${item.start - scrollMargin}px)` }}
          >
            <RowView row={rows[item.index]!} actions={view} />
          </div>
        ))}
      </div>
    </>
  );
}

const positionOf = (parsed: ParsedFile, index: number): LinePosition => {
  const line = parsed.lines[index]!;
  return { path: parsed.file.newPath, oldPath: parsed.file.oldPath, oldLine: line.oldLine, newLine: line.newLine };
};

/** Lines as the diff shows them: old and new line numbers, +/-, code. */
function excerptOf(parsed: ParsedFile, from: number, to: number) {
  return parsed.lines
    .slice(from, to + 1)
    .map(l => (l.kind === "hunk" ? l.content : `${String(l.oldLine ?? "").padStart(5)} ${String(l.newLine ?? "").padStart(5)} ${marker[l.kind]} ${l.content}`))
    .join("\n");
}

type Jump = { path?: string; group?: number; key: number };

interface RowViewProps {
  row: Row;
  actions: {
    setCollapsed: (parsed: ParsedFile, collapsed: boolean) => void;
    setViewed: (parsed: ParsedFile, viewed: boolean) => void;
    /** `extend` (shift-click) grows the current selection in the same file to this line. */
    startComment: (parsed: ParsedFile, index: number, extend: boolean) => void;
    cancelComment: () => void;
    submitComment: (parsed: ParsedFile, index: number, body: string) => Promise<void>;
    ask: (parsed: ParsedFile, index: number, question: string, model: AgentModel) => Promise<void>;
    selectedLines: () => number;
    questionActions: QuestionActions;
    headSha: string;
  };
}

const lineTint: Record<DiffLine["kind"], string> = {
  hunk: "bg-blue-500/10 text-muted-foreground",
  add: "bg-green-500/15",
  del: "bg-red-500/15",
  context: "bg-background",
};
const marker: Record<DiffLine["kind"], string> = { hunk: "", add: "+", del: "-", context: " " };

/** Rows of one file share side borders; the last one closes the card. */
const fileBody = (last: boolean) => cn("border-x", last && "rounded-b-lg border-b");

function RowView({ row, actions }: RowViewProps) {
  switch (row.kind) {
    case "gap":
      return <div className="h-4" />;

    case "group":
      return (
        <div className="mt-4 rounded-lg border border-violet-500/30 bg-violet-500/5 px-4 py-3 font-sans">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-xs text-muted-foreground">
              {row.group ? `Group ${row.index + 1} of ${row.count}` : "Not in the walkthrough"}
            </span>
            <span className="font-semibold">{row.group?.title ?? "Other changes"}</span>
            {row.group && (
              <>
                <Badge variant="outline" className={riskBadge[row.group.risk]}>
                  {row.group.risk} risk
                </Badge>
                {row.group.kinds.map(kind => (
                  <Badge key={kind} variant="outline" className="font-normal text-muted-foreground">
                    {kind}
                  </Badge>
                ))}
              </>
            )}
          </div>
          {row.group && <Markdown className="mt-1">{row.group.summary}</Markdown>}
          {row.group?.riskReason && (
            <Markdown className="mt-1 text-xs text-muted-foreground">{row.group.riskReason}</Markdown>
          )}
        </div>
      );

    case "header": {
      const { file, additions, deletions } = row.parsed;
      return (
        <div
          className={cn(
            "flex items-center gap-2 rounded-t-lg border bg-muted px-3 py-2 text-sm",
            row.closed && "rounded-b-lg",
          )}
        >
          <button
            type="button"
            onClick={() => actions.setCollapsed(row.parsed, !row.collapsed)}
            aria-label={row.collapsed ? "Expand" : "Collapse"}
          >
            <ChevronDown className={cn("size-4 transition-transform", row.collapsed && "-rotate-90")} />
          </button>
          <span className="truncate font-mono text-xs">
            {file.status === "renamed" ? `${file.oldPath} → ${file.newPath}` : file.newPath}
          </span>
          {file.status !== "modified" && <Badge variant="outline">{file.status}</Badge>}
          <span className="text-xs text-green-600 dark:text-green-400">+{additions}</span>
          <span className="text-xs text-red-600 dark:text-red-400">−{deletions}</span>
          <label className="ml-auto flex shrink-0 cursor-pointer items-center gap-2 text-xs">
            <Checkbox checked={file.viewed} onCheckedChange={checked => actions.setViewed(row.parsed, checked === true)} />
            Viewed
          </label>
        </div>
      );
    }

    case "line": {
      const line = row.parsed.lines[row.index]!;
      const tokens = line.kind === "hunk" ? undefined : tokensFor(row.parsed)[row.index];
      return (
        <div
          className={cn(
            "group grid grid-cols-[var(--num)_var(--num)_1.25rem_minmax(0,1fr)] font-mono text-xs leading-5",
            lineTint[line.kind],
            row.selected && "shadow-[inset_3px_0_0_var(--color-violet-500)] brightness-95 dark:brightness-125",
            row.by && "opacity-40",
            fileBody(row.last),
          )}
          title={row.by && `Changed by ${row.by}`}
        >
          <span className="px-2 text-right text-muted-foreground select-none">{line.oldLine}</span>
          <span className="px-2 text-right text-muted-foreground select-none">{line.newLine}</span>
          <span className="select-none">
            {line.kind !== "hunk" && (
              <button
                type="button"
                title="Ask or comment about this line (shift-click to select a range)"
                onClick={e => actions.startComment(row.parsed, row.index, e.shiftKey)}
                className="invisible mt-0.5 flex size-4 items-center justify-center rounded bg-primary text-primary-foreground group-hover:visible"
              >
                <Plus className="size-3" />
              </button>
            )}
          </span>
          <span className="-indent-3 pr-4 pl-3 whitespace-pre-wrap [overflow-wrap:anywhere]">
            <span className="inline-block w-3 indent-0 text-muted-foreground select-none">{marker[line.kind]}</span>
            {tokens
              ? tokens.map((t, i) =>
                  t.className ? (
                    <span key={i} className={`th-${t.className}`}>
                      {t.value}
                    </span>
                  ) : (
                    t.value
                  ),
                )
              : line.content}
          </span>
        </div>
      );
    }

    case "thread":
      return (
        <div className={cn("space-y-3 border-y bg-background p-3", fileBody(row.last))}>
          {row.comments.map(c => (
            <CommentItem key={c.id} comment={c} />
          ))}
          {row.questions.map(q => (
            <QuestionThreadView
              key={q.id}
              thread={q}
              stale={q.headSha !== actions.headSha}
              actions={actions.questionActions}
            />
          ))}
          {row.composing && (
            <LineComposer
              lineCount={actions.selectedLines()}
              onCancel={actions.cancelComment}
              onAsk={(question, model) => actions.ask(row.parsed, row.index, question, model)}
              onComment={body => actions.submitComment(row.parsed, row.index, body)}
            />
          )}
        </div>
      );

    case "note":
      return row.large ? (
        <button
          type="button"
          onClick={() => actions.setCollapsed(row.parsed, false)}
          className={cn("w-full p-3 text-sm text-muted-foreground hover:text-foreground", fileBody(row.last))}
        >
          Large diff ({row.parsed.lines.length.toLocaleString()} lines) is hidden. Show it
        </button>
      ) : (
        <p className={cn("p-4 text-sm text-muted-foreground", fileBody(row.last))}>
          No textual changes (binary file or mode change).
        </p>
      );

    case "hiddenComments":
      return (
        <div className={cn("bg-muted/50 px-3 font-mono text-xs leading-5 text-muted-foreground", fileBody(row.last))}>
          ⋯ {row.count} comment-only {row.count === 1 ? "line" : "lines"} hidden
        </div>
      );

    case "outdated":
      return (
        <div className={cn("space-y-3 border-t p-3", fileBody(row.last))}>
          <p className="text-xs text-muted-foreground">Comments on lines not shown in this diff</p>
          {row.comments.map(c => (
            <CommentItem
              key={c.id}
              comment={c}
              context={<span>line {c.position?.newLine ?? c.position?.oldLine}</span>}
            />
          ))}
          {row.questions.map(q => (
            <QuestionThreadView
              key={q.id}
              thread={q}
              stale={q.headSha !== actions.headSha}
              showExcerpt
              actions={actions.questionActions}
            />
          ))}
        </div>
      );
  }
}

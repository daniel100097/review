import { CommentItem, type Comment } from "@/components/comment";
import type { ContributorFilter } from "@/components/contributors";
import { Markdown } from "@/components/markdown";
import { LineComposer, QuestionThreadView, type QuestionActions, type QuestionThread } from "@/components/question-thread";
import { riskBadge, type WalkthroughGroup } from "@/components/walkthrough";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DiffLine } from "@/lib/diff";
import type { AgentModel } from "@/lib/agents";
import type { ViewItem } from "@/lib/comment-changes";
import { expandStep, type Gap, type LineRange } from "@/lib/expand";
import type { CompiledFilterRules } from "@/lib/filter-rules";
import { findText } from "@/lib/find-text";
import { highlightCss } from "@/lib/highlight";
import { changeView, expanded, parse, tokensFor, type Expansion, type File, type ParsedFile } from "@/lib/parsed-file";
import { cn } from "@/lib/utils";
import type { LinePosition } from "@/server/providers/types";
import { defaultRangeExtractor, useWindowVirtualizer, type Range } from "@tanstack/react-virtual";
import { Check, ChevronDown, ChevronRight, ChevronUp, PanelLeft, Plus, Search, UnfoldVertical, X, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

export type { File };

/** Diffs longer than this start collapsed, like lockfiles and generated code. */
const largeDiffLines = 500;
/** The app header (h-12) that rows scroll under; file headers stick below it. */
const appHeaderHeight = 48;
/** What can hold focus in a row: the row's own target (file header, group band) and its controls. */
const focusable = "[tabindex], button, a[href], input, select, textarea";

type Row = { key: string } & (
  | { kind: "gap" }
  /** Starts a walkthrough group; `group` is undefined for files the walkthrough doesn't mention. */
  | { kind: "group"; index: number; count: number; group?: WalkthroughGroup }
  /** `level`: file headings sit below group headings when there's a walkthrough. */
  | { kind: "header"; parsed: ParsedFile; collapsed: boolean; closed: boolean; level: number }
  /** `by`: another contributor's change, when showing one contributor's. `expander`: on hunk headers hiding lines. */
  | {
      kind: "line";
      parsed: ParsedFile;
      index: number;
      selected: boolean;
      by?: string;
      expander?: { gap: Gap; loading: boolean; error?: string };
      last: boolean;
    }
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
  | { kind: "hiddenComments"; parsed: ParsedFile; count: number; custom: boolean; last: boolean }
  | { kind: "outdated"; parsed: ParsedFile; comments: Comment[]; questions: QuestionThread[]; last: boolean }
);

/** Selected lines `from`..`to`; the form opens below `to`. Positions, as expanding a diff shifts indexes. */
type Composer = { path: string; from: LinePosition; to: LinePosition };
type FindMatch = { rowKey: string; path: string; start: number; end: number };
type FindState = { query: string; current?: FindMatch };

const estimatedHeight: Record<Row["kind"], number> = {
  gap: 16,
  group: 160,
  header: 40,
  // Lines are 24px on touch screens and below sm, see `lineHeight`.
  line: 20,
  thread: 140,
  note: 46,
  hiddenComments: 20,
  outdated: 120,
};

const isAt = (line: DiffLine, p: LinePosition) =>
  line.kind !== "hunk" &&
  (p.newLine !== undefined ? line.newLine === p.newLine : line.newLine === undefined && line.oldLine === p.oldLine);

const indexOf = (parsed: ParsedFile, p: LinePosition) => parsed.lines.findIndex(l => isAt(l, p));

/** Identifies a line of a file across expansions, which shift indexes. */
const lineKey = (lines: DiffLine[], index: number) => {
  const line = lines[index]!;
  return line.kind === "hunk" ? `@${index}` : `${line.oldLine ?? ""}:${line.newLine ?? ""}`;
};

function buildRows(
  parsedFiles: ParsedFile[],
  comments: Comment[],
  questions: QuestionThread[],
  isCollapsed: (parsed: ParsedFile) => boolean,
  expansionOf: (parsed: ParsedFile) => Expansion | undefined,
  composer: Composer | null,
  hideCommentChanges: boolean,
  groups: WalkthroughGroup[] | undefined,
  contributor: ContributorFilter | undefined,
  filterRules: CompiledFilterRules | undefined,
) {
  const rows: Row[] = [];
  const headerIndex = new Map<string, number>();
  const groupIndex: number[] = [];
  const groupOf = new Map(groups?.flatMap((g, i) => g.files.map(path => [path, i] as const)));
  let currentGroup: number | undefined;

  parsedFiles.forEach((base, fileIndex) => {
    const collapsed = isCollapsed(base);
    const expansion = expansionOf(base);
    const parsed = collapsed ? base : expanded(base, expansion);
    const { file, lines } = parsed;
    const path = file.newPath;
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
    const header: Row & { kind: "header" } = {
      kind: "header", key: `header:${path}`, parsed, collapsed, closed: true, level: groups ? 3 : 2,
    };
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
      const filtered = changeView(parsed, hideCommentChanges, filterRules);
      let view = filtered.view;
      if (filtered.hiddenCount > 0 && filtered.hiddenCount === parsed.additions + parsed.deletions) {
        body.push({ kind: "hiddenComments", key: `hiddenComments:${path}:all`, parsed, count: filtered.hiddenCount, custom: Boolean(filterRules), last: false });
      }
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
      const selecting =
        composer?.path === path ? { from: indexOf(parsed, composer.from), to: indexOf(parsed, composer.to) } : undefined;
      view.forEach(index => {
        if (typeof index === "object") {
          const key = `hiddenComments:${path}:${index.first}`;
          body.push({ kind: "hiddenComments", key, parsed, count: index.hidden, custom: Boolean(filterRules), last: false });
          return;
        }
        const selected = selecting !== undefined && index >= selecting.from && index <= selecting.to;
        const author = authorOf(index);
        const by = contributor && author && author.key !== contributor.key ? author.name : undefined;
        const gap = parsed.gaps?.get(index);
        const expander = gap && { gap, loading: Boolean(expansion && !expansion.content && !expansion.error), error: expansion?.error };
        body.push({ kind: "line", key: `line:${path}:${lineKey(lines, index)}`, parsed, index, selected, by, expander, last: false });
        const composing = selecting?.to === index;
        if (byLine.has(index) || questionsByLine.has(index) || composing) {
          body.push({
            kind: "thread",
            // The form keeps its key when extending the selection moves it, so the draft and focus survive.
            key: composing ? `thread:${path}:composer` : `thread:${path}:${lineKey(lines, index)}`,
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
  loadFile,
  onComment,
  onAsk,
  questionActions,
  groups,
  jumpTo,
  hideCommentChanges,
  contributor,
  filterRules,
  wrapLines,
  onOpenFind,
  onOpenNavigation,
  onCurrentFileChange,
}: {
  files: File[];
  /** Inline comments. */
  comments: Comment[];
  /** Local conversations with agents about lines. */
  questions: QuestionThread[];
  /** The pull request's current head, to mark questions asked on earlier pushes. */
  headSha: string;
  onViewedChange: (file: File, viewed: boolean) => void;
  /** The text of a file at the pull request's head, for expanding unchanged lines. */
  loadFile: (path: string) => Promise<string>;
  onComment: (body: string, position: LinePosition) => Promise<unknown>;
  /** `excerpt` is the selected lines as text: old and new line numbers, +/-, code. */
  onAsk: (question: string, model: AgentModel, position: LinePosition, excerpt: string) => Promise<unknown>;
  questionActions: QuestionActions;
  /** A walkthrough's groups; `files` must come in group order. Adds a header row before each group. */
  groups?: WalkthroughGroup[];
  /** Scrolls to a file or a group (by index); change `key` to jump again. */
  jumpTo?: Jump;
  /** Leaves out changes that only touch comments; see `withoutCommentChanges`. */
  hideCommentChanges: boolean;
  /** Shows one contributor's changes: hunks without any are left out and others' changes dimmed. */
  contributor?: ContributorFilter;
  filterRules?: CompiledFilterRules;
  wrapLines: boolean;
  onOpenFind?: () => void;
  /** Opens the page's file navigation; adds a Files button to the bottom bar below `lg`. */
  onOpenNavigation?: () => void;
  /** The file whose header is at the top of the window, as it changes. */
  onCurrentFileChange?: (path: string | undefined) => void;
}) {
  const parsedFiles = useMemo(() => files.map(parse), [files]);
  const [collapsedOverrides, setCollapsedOverrides] = useState(() => new Map<string, boolean>());
  const setCollapsed = (path: string, collapsed: boolean) =>
    setCollapsedOverrides(prev => new Map(prev).set(path, collapsed));
  const [composer, setComposer] = useState<Composer | null>(null);
  // By patch, so a push that changes a file's diff starts it unexpanded.
  const [expansions, setExpansions] = useState(() => new Map<string, Expansion>());
  const expansionKey = (file: File) => `${file.newPath}:${file.patchHash}`;
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const findInput = useRef<HTMLInputElement>(null);
  const previousFindFocus = useRef<HTMLElement | null>(null);
  /** Walkthrough groups whose band shows its whole summary. */
  const [openGroups, setOpenGroups] = useState(() => new Set<number>());
  /** A text field in the list has focus (a comment or answer is being written, the keyboard is up on phones). */
  const [typing, setTyping] = useState(false);
  const [lineHeight] = useState(() => matchMedia("(max-width: 639px), (pointer: coarse)").matches ? 24 : 20);

  // Search the complete view, including collapsed files, without mounting its rows.
  const searchableRows = useMemo(() => findOpen ? buildRows(
    parsedFiles, [], [], () => false, p => expansions.get(expansionKey(p.file)), null,
    hideCommentChanges, groups, contributor, filterRules,
  ).rows : [], [findOpen, parsedFiles, expansions, hideCommentChanges, groups, contributor, filterRules]);
  const findMatches = useMemo(() => searchableRows.flatMap(row => {
    if (row.kind !== "line" && row.kind !== "header") return [];
    const text = row.kind === "header"
      ? row.parsed.file.status === "renamed" ? `${row.parsed.file.oldPath} → ${row.parsed.file.newPath}` : row.parsed.file.newPath
      : row.parsed.lines[row.index]!.content;
    return findText(text, findQuery).map(range => ({ ...range, rowKey: row.key, path: row.parsed.file.newPath }));
  }), [searchableRows, findQuery]);
  const selectedFindIndex = findMatches.length ? (findIndex % findMatches.length + findMatches.length) % findMatches.length : 0;
  const currentFind = findMatches[selectedFindIndex];
  const find: FindState | undefined = findOpen ? { query: findQuery, current: currentFind } : undefined;
  const moveFind = (direction: number) => { if (findMatches.length) setFindIndex(index => index + direction); };
  const findCount = findMatches.length ? `${selectedFindIndex + 1}/${findMatches.length}` : "0/0";
  const findStatus = !findQuery ? "" : findMatches.length
    ? `${selectedFindIndex + 1} of ${findMatches.length} matches` : "No matches";
  const openFind = () => {
    if (!findOpen) previousFindFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    onOpenFind?.();
    setFindOpen(true);
    requestAnimationFrame(() => { findInput.current?.focus(); findInput.current?.select(); });
  };

  const { rows, headerIndex, headerIndexes, groupIndex } = useMemo(
    () =>
      buildRows(
        parsedFiles,
        comments,
        questions,
        p => collapsedOverrides.get(p.file.newPath) ?? (p.file.viewed || p.lines.length > largeDiffLines),
        p => expansions.get(expansionKey(p.file)),
        composer,
        hideCommentChanges,
        groups,
        contributor,
        filterRules,
      ),
    [parsedFiles, comments, questions, collapsedOverrides, expansions, composer, hideCommentChanges, groups, contributor, filterRules],
  );
  const maxLine = useMemo(() => {
    let max = 1;
    const see = (l: DiffLine) => (max = Math.max(max, l.oldLine ?? 0, l.newLine ?? 0));
    for (const { lines } of parsedFiles) lines.forEach(see);
    // Expanded lines can go past the diff's.
    for (const row of rows) if (row.kind === "line") see(row.parsed.lines[row.index]!);
    return max;
  }, [parsedFiles, rows]);
  const composerRow = rows.findIndex(r => r.kind === "thread" && r.composing);
  const findRow = useMemo(() => currentFind ? rows.findIndex(row => row.key === currentFind.rowKey) : -1, [rows, currentFind]);

  const listRef = useRef<HTMLDivElement>(null);
  const horizontalRef = useRef<HTMLDivElement>(null);
  const [horizontalWidth, setHorizontalWidth] = useState(0);
  const [scrollMargin, setScrollMargin] = useState(0);
  // Content above the list (like the walkthrough panel) can change height, so measure after every render too.
  const measure = () => {
    if (listRef.current) setScrollMargin(listRef.current.getBoundingClientRect().top + window.scrollY);
  };
  useLayoutEffect(measure);
  useLayoutEffect(() => {
    if (!wrapLines && horizontalRef.current) {
      // Keep the selected column when a wide virtual row scrolls out of view.
      const width = horizontalRef.current.scrollWidth;
      setHorizontalWidth(previous => Math.max(previous, width));
    }
  });
  useEffect(() => {
    window.addEventListener("resize", measure);
    // The web font can rewrap the content above (like the title) after the first render.
    document.fonts?.ready.then(measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: useCallback((i: number) => rows[i]!.kind === "line" ? lineHeight : estimatedHeight[rows[i]!.kind], [rows, lineHeight]),
    // Each wrapping mode needs its own row measurements.
    getItemKey: useCallback((i: number) => rows[i]!.kind === "line" ? `${rows[i]!.key}:${wrapLines}` : rows[i]!.key, [rows, wrapLines]),
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
        if (findRow !== -1) indexes.add(findRow);
        return [...indexes].sort((a, b) => a - b);
      },
      [headerIndexes, composerRow, findRow],
    ),
  });

  /**
   * Scrolls a row to the top. Rows between here and there may not be measured yet (a long answer is estimated
   * at a few lines), so the first scroll can land off; correct it for a few frames once they render.
   * `focus` then focuses the row (a file header or group band) for keyboard and screen reader users.
   */
  const jumping = useRef<number>(undefined);
  const jumpSequence = useRef(0);
  // Stops a jump's corrections on unmount, like when switching tabs. A flag that mounting sets again, as Strict Mode
  // runs cleanups once on mount.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const scrollToRow = (index: number, { finding = false, focus = false } = {}) => {
    const sequence = ++jumpSequence.current;
    jumping.current = index;
    // Newly rendered rows are measured a frame or two later (frames can be slow while they render), and rows
    // under the app header grow without the virtualizer keeping the target in place. So only settle once the
    // target has been reached for a few frames and a little while.
    const start = performance.now();
    let lastCorrection = start;
    let stableFrames = 0;
    const settle = () => {
      jumping.current = undefined;
      // Once it's settled, as the header moves between the sticky slot and the list (remounting) while scrolling.
      if (focus) listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"] > [tabindex="-1"]`)?.focus({ preventScroll: true });
    };
    const correct = () => {
      if (!mounted.current || jumping.current !== index || jumpSequence.current !== sequence) return;
      const now = performance.now();
      if (now - start > 2000) {
        settle();
        return;
      }
      // `getOffsetForIndex` reads the measurements as of the last render; this brings them up to date.
      virtualizer.getTotalSize();
      const [offset] = virtualizer.getOffsetForIndex(index, "start") ?? [];
      const mark = finding && rows[index]?.kind === "line"
        ? listRef.current?.querySelector<HTMLElement>('[data-find-current="true"]') : undefined;
      const target = mark ? window.scrollY + mark.getBoundingClientRect().top - 120
        : offset === undefined ? undefined : offset - (finding ? 72 : 0);
      if (mark && horizontalRef.current) {
        const bounds = mark.getBoundingClientRect();
        const viewport = horizontalRef.current.getBoundingClientRect();
        if (bounds.left < viewport.left || bounds.right > viewport.right) {
          horizontalRef.current.scrollLeft += bounds.width > viewport.width - 16
            ? bounds.left - viewport.left - 8
            : bounds.left - viewport.left - viewport.width / 2 + bounds.width / 2;
        }
      }
      const maximum = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const boundedTarget = target === undefined ? undefined : Math.min(maximum, Math.max(0, target));
      if (boundedTarget !== undefined && Math.abs(window.scrollY - boundedTarget) > 1) {
        window.scrollTo({ top: boundedTarget });
        lastCorrection = now;
        stableFrames = 0;
      } else if (offset === undefined || (++stableFrames >= 4 && now - lastCorrection > 150)) {
        settle();
        return;
      }
      requestAnimationFrame(correct);
    };
    correct();
  };
  const closeFind = () => {
    jumpSequence.current++;
    jumping.current = undefined;
    setFindOpen(false);
    // After rendering, as the bottom bar's Find button shows again then.
    requestAnimationFrame(() => {
      const previous = previousFindFocus.current;
      (previous?.isConnected && previous.getClientRects().length && !previous.closest("[inert]") ? previous : horizontalRef.current)?.focus({ preventScroll: true });
    });
  };

  useEffect(() => {
    jumpSequence.current++;
    jumping.current = undefined;
    if (!currentFind) return;
    if (findRow === -1) {
      setCollapsed(currentFind.path, false);
      return;
    }
    scrollToRow(findRow, { finding: true });
  }, [currentFind, findRow, findIndex]);

  // Jumps come from the page (file tree, groups) and from shortcuts; the latest wins. Those move focus to the
  // target too, but not the bottom bar's Next button, which is pressed repeatedly.
  const [jump, setJump] = useState<Jump & { focus?: boolean }>();
  useEffect(() => setJump(jumpTo && { ...jumpTo, focus: true }), [jumpTo]);
  // Runs after every render but acts once per jump, after the list's offset is known and rows are rebuilt.
  const handledJump = useRef<number>(undefined);
  useEffect(() => {
    if (!jump || !scrollMargin || handledJump.current === jump.key) return;
    handledJump.current = jump.key;
    const index = jump.path !== undefined ? headerIndex.get(jump.path) : groupIndex[jump.group!];
    if (index !== undefined) scrollToRow(index, { focus: jump.focus });
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
  const viewedCount = files.filter(f => f.viewed).length;

  // Tells the page which file is being read, after scrolling (at most once a frame) and after every render, like
  // the first one or a filter change. Above the diff that's the first file; below a group's band, its first file.
  const reportedFile = useRef<string>(undefined);
  const reportCurrentFile = useRef<() => void>(undefined);
  reportCurrentFile.current = () => {
    const band = groupIndex.findLast(i => i !== undefined && offsetOf(i) <= 1) ?? -1;
    const header = currentHeader();
    const index = band > header ? headerIndexes.find(i => i > band) : header === -1 ? headerIndexes[0] : header;
    const path = index === undefined ? undefined : fileAt(index).file.newPath;
    if (path === reportedFile.current) return;
    reportedFile.current = path;
    onCurrentFileChange?.(path);
  };
  useEffect(() => reportCurrentFile.current!());
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        reportCurrentFile.current!();
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);
  /** Like the `n` shortcut, for the bottom bar. */
  const goToNextUnviewed = () => {
    const index = nextUnviewed(currentHeader());
    if (index !== undefined) setJump({ path: fileAt(index).file.newPath, key: Date.now() });
  };

  // Review shortcuts: j/k files, ]/[ groups, n next unviewed file, v mark viewed and move on.
  const shortcuts = useRef<(e: KeyboardEvent) => void>(undefined);
  shortcuts.current = e => {
    const current = currentHeader();
    const go = (index: number | undefined) => {
      if (index === undefined) return;
      e.preventDefault();
      const row = rows[index]!;
      setJump(row.kind === "group"
        ? { group: row.index, key: Date.now(), focus: true }
        : { path: fileAt(index).file.newPath, key: Date.now(), focus: true });
    };
    // By position, so they also work right after jumping to a group header (which is above its first file);
    // during a jump, from where it's going, so pressing quickly moves on. A row a few pixels off the top counts
    // as there, so a jump that lands slightly off doesn't make the next press go to the same row again.
    const groupRows = groupIndex.filter(i => i !== undefined);
    const target = jumping.current;
    const below = (indexes: number[]) => indexes.find(i => (target !== undefined ? i > target : offsetOf(i) > 8));
    const above = (indexes: number[]) => indexes.findLast(i => (target !== undefined ? i < target : offsetOf(i) < -8));
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f" && !e.altKey) {
        e.preventDefault();
        openFind();
        return;
      }
      // Popovers, selects and menus (portaled, so outside any dialog) close themselves; the comment form cancels.
      const ownsEscape = e.target instanceof Element && e.target.closest("textarea, [role=dialog], [role=listbox], [role=menu]");
      if (e.key === "Escape" && findOpen && !ownsEscape && !e.defaultPrevented) {
        e.preventDefault();
        closeFind();
        return;
      }
      const ownsKeyboard = e.target instanceof HTMLElement && e.target.closest(
        "input, textarea, select, [contenteditable], [role=dialog], [role=combobox], [role=listbox], [role=menu]",
      );
      if (!e.defaultPrevented && !ownsKeyboard && !e.ctrlKey && !e.metaKey && !e.altKey) shortcuts.current!(e);
    };
    // The page's toolbar has the Find button on wide screens.
    const onFind = () => openFind();
    window.addEventListener("keydown", onKey);
    window.addEventListener("diff:find", onFind);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("diff:find", onFind);
    };
  }, [findOpen, onOpenFind]);

  // Bring a newly opened (or extended) comment form's buttons into view, above the find bar if it's open.
  const findBar = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!composer || composerRow === -1) return;
    // Once the row is measured, so the list is long enough to scroll that far.
    let frame = requestAnimationFrame(() => frame = requestAnimationFrame(() => {
      const row = listRef.current?.querySelector(`[data-index="${composerRow}"]`)?.getBoundingClientRect();
      const bar = findBar.current?.getBoundingClientRect();
      if (!row) return;
      const bottom = Math.min(window.innerHeight, bar?.height ? bar.top : Infinity) - 8;
      // But not past the top of the form, below the app header and the sticky file header.
      if (row.bottom > bottom) window.scrollBy({ top: Math.min(row.bottom - bottom, row.top - appHeaderHeight - 48) });
    }));
    return () => cancelAnimationFrame(frame);
  }, [composer]);

  const items = virtualizer.getVirtualItems();
  const stickyLine = (virtualizer.scrollOffset ?? 0) + appHeaderHeight;
  // A file's header sticks while reading it, but not over the next group's band. Jumps can land a pixel off
  // (scroll positions are rounded), so a row that close to the top counts as there.
  const stickyCandidate = items.findLast(item => ["header", "group"].includes(rows[item.index]!.kind) && item.start <= stickyLine + 2);
  const sticky = stickyCandidate && rows[stickyCandidate.index]!.kind === "header" ? stickyCandidate : undefined;
  // Rows scrolled out above (kept for overscan) are inert, so Tab from a file header goes on to its lines rather
  // than back up the diff. Except one holding focus, like an open comment form: that would drop focus to the
  // page, and the next keys would go to the review shortcuts instead of the draft.
  const active = document.activeElement;
  const focusedRow = listRef.current?.contains(active) ? active!.closest("[data-index]")?.getAttribute("data-index") : undefined;

  // A file header remounts when it moves between the sticky slot and the list (different parents), which drops
  // focus from it, or a button in it, to the page. So remember what's focused in the list, and give the new copy
  // focus in the render that moved it. Only then: a closed form or expanded lines also remove the focused element
  // but don't move its row, and a row that comes back later mustn't take focus back. Not when focus left on
  // purpose either, like a click on the page: the element is still there afterwards (Chrome blurs a removed
  // element too, so that's checked after the removal).
  const focusMemory = useRef<{ index: string; sticky: boolean; control: number; element: Element }>(null);
  useEffect(() => {
    const remember = (e: FocusEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      const row = target && listRef.current?.contains(target) ? target.closest<HTMLElement>("[data-index]") : null;
      focusMemory.current = row && {
        index: row.dataset.index!,
        sticky: row.parentElement === listRef.current,
        control: [...row.querySelectorAll(focusable)].indexOf(target!),
        element: target!,
      };
    };
    const forget = (e: FocusEvent) => {
      const element = e.target;
      if (e.relatedTarget || !(element instanceof Element)) return;
      queueMicrotask(() => { if (element.isConnected && focusMemory.current?.element === element) focusMemory.current = null; });
    };
    document.addEventListener("focusin", remember);
    document.addEventListener("focusout", forget);
    return () => {
      document.removeEventListener("focusin", remember);
      document.removeEventListener("focusout", forget);
    };
  }, []);
  useLayoutEffect(() => {
    const memory = focusMemory.current;
    if (!memory || memory.element.isConnected) return;
    focusMemory.current = null;
    if (document.activeElement !== document.body) return;
    // The copy keeps its index, so the same control is at the same place. Silently a no-op on an inert row.
    const row = listRef.current?.querySelector(`[data-index="${memory.index}"]`);
    if (!row || (row.parentElement === listRef.current) === memory.sticky) return;
    row.querySelectorAll<HTMLElement>(focusable)[memory.control]?.focus({ preventScroll: true });
  });

  // Closing the focused form (or virtualizing its row away) removes the text field without a blur reaching the
  // list, which would leave the bars below lg hidden. So clear it with the form, and check focus after every render.
  const closeComposer = () => {
    setComposer(null);
    setTyping(false);
  };
  useEffect(() => {
    const field = document.activeElement;
    setTyping(field instanceof HTMLTextAreaElement && Boolean(listRef.current?.contains(field)));
  });

  const view: RowViewProps["actions"] = {
    setCollapsed: (parsed, collapsed) => setCollapsed(parsed.file.newPath, collapsed),
    setViewed: (parsed, viewed) => {
      onViewedChange(parsed.file, viewed);
      setCollapsed(parsed.file.newPath, viewed);
    },
    startComment: (parsed, index, extend) => {
      const path = parsed.file.newPath;
      setComposer(prev => {
        const [from, to] = extend && prev?.path === path ? [indexOf(parsed, prev.from), indexOf(parsed, prev.to)] : [index, index];
        // The earlier selection can be gone, like after a push.
        if (from === -1 || to === -1) return { path, from: positionOf(parsed, index), to: positionOf(parsed, index) };
        return { path, from: positionOf(parsed, Math.min(from, index)), to: positionOf(parsed, Math.max(to, index)) };
      });
    },
    cancelComment: closeComposer,
    submitComment: async (parsed, index, body) => {
      await onComment(body, positionOf(parsed, index));
      closeComposer();
    },
    ask: async (parsed, index, question, model) => {
      const from = composer?.path === parsed.file.newPath ? indexOf(parsed, composer.from) : index;
      await onAsk(question, model, positionOf(parsed, index), excerptOf(parsed, from, index));
      closeComposer();
    },
    selectedLines: parsed => (composer ? indexOf(parsed, composer.to) - indexOf(parsed, composer.from) + 1 : 1),
    expand: (parsed, range) => {
      const key = expansionKey(parsed.file);
      const current = expansions.get(key);
      const update = (change: (expansion: Expansion) => Expansion) =>
        setExpansions(prev => new Map(prev).set(key, change(prev.get(key) ?? { revealed: [] })));
      update(e => ({ ...e, revealed: [...e.revealed, range], error: undefined }));
      // Load the file the first time, or again after it failed.
      if (current && current.error === undefined) return;
      loadFile(parsed.file.newPath).then(
        text => update(e => ({ ...e, content: text.replace(/\n$/, "").split("\n") })),
        (error: Error) => update(e => ({ ...e, error: error.message })),
      );
    },
    groupOpen: index => openGroups.has(index),
    toggleGroup: index => setOpenGroups(prev => {
      const next = new Set(prev);
      if (!next.delete(index)) next.add(index);
      return next;
    }),
    questionActions,
    headSha,
  };

  return (
    <>
      <style href="tanstack-highlight-theme" precedence="default">
        {highlightCss}
      </style>
      {/* Docked where nothing sticks: bottom right on wide screens, in place of the bottom bar below lg. */}
      {findOpen && (
        <form ref={findBar} role="search" aria-label="Find in diff"
          className={cn(
            "fixed inset-x-0 bottom-0 z-20 flex items-center gap-0.5 border-t bg-background/95 pt-1.5 pr-[max(0.5rem,env(safe-area-inset-right))] pb-[calc(0.375rem+env(safe-area-inset-bottom))] pl-[max(0.5rem,env(safe-area-inset-left))] backdrop-blur",
            "lg:inset-x-auto lg:right-4 lg:bottom-4 lg:w-[26rem] lg:rounded-lg lg:border lg:bg-popover lg:p-1.5 lg:text-popover-foreground lg:shadow-lg",
            // Below lg it would sit on top of the keyboard and cover the form being written.
            typing && "max-lg:hidden",
          )}
          onSubmit={e => { e.preventDefault(); moveFind(1); }}>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input ref={findInput} aria-label="Find code or filename" placeholder="Find in diff…" value={findQuery}
              className="pl-8 lg:h-8"
              onChange={e => { setFindQuery(e.target.value); setFindIndex(0); }}
              onKeyDown={e => { if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); moveFind(-1); } }} />
          </div>
          <span aria-hidden="true" className="shrink-0 px-1.5 text-xs text-muted-foreground tabular-nums">{findCount}</span>
          <span role="status" aria-live="polite" className="sr-only">{findStatus}</span>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Previous match" title="Previous match (Shift+Enter)" disabled={!findMatches.length} onClick={() => moveFind(-1)}><ChevronUp /></Button>
          <Button type="submit" variant="ghost" size="icon-sm" aria-label="Next match" title="Next match (Enter)" disabled={!findMatches.length}><ChevronDown /></Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Close find" title="Close (Escape)" onClick={closeFind}><X /></Button>
        </form>
      )}
      {/* Below lg the sidebar is a drawer, so reviewing moves to a bar within thumb reach. Hidden rather than
          unmounted while find is open, so closing find can return focus to its button. */}
      <nav aria-label="Review" className={cn(
        "fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden",
        (findOpen || typing) && "hidden",
      )}>
        <div className="flex h-12 items-center gap-1 pr-[max(0.5rem,env(safe-area-inset-right))] pl-[max(0.5rem,env(safe-area-inset-left))]">
          {onOpenNavigation && (
            <Button id="diff-files-button" variant="ghost" className="h-9 px-2.5" onClick={onOpenNavigation}><PanelLeft />Files</Button>
          )}
          <span className="min-w-0 truncate px-1.5 text-xs text-muted-foreground tabular-nums">
            {viewedCount}/{files.length} viewed
          </span>
          <Button variant="ghost" size="icon" className="ml-auto" aria-label="Find in diff" title="Find in diff (Ctrl+F)" onClick={openFind}><Search /></Button>
          <Button variant="ghost" className="h-9 gap-1 pr-1.5 pl-2.5" aria-label="Next unviewed file" title="Next unviewed file (n)"
            disabled={viewedCount === files.length} onClick={goToNextUnviewed}>Next<ChevronRight /></Button>
        </div>
      </nav>
      <div
        ref={listRef}
        className="relative"
        style={{ height: virtualizer.getTotalSize(), "--digits": `${String(maxLine).length}ch` } as CSSProperties}
        onFocus={e => setTyping(e.target instanceof HTMLTextAreaElement)}
        onBlur={() => setTyping(false)}
      >
        {sticky && (
          <div
            key={sticky.key}
            data-index={sticky.index}
            ref={virtualizer.measureElement}
            // Focusing its buttons mustn't scroll: they're above the page's scroll padding (5.5rem) by design.
            className="sticky top-12 z-10 [&_*]:-scroll-mt-10"
          >
            <RowView row={rows[sticky.index]!} actions={view} wrapLines={wrapLines} find={find} />
          </div>
        )}
        <div ref={horizontalRef} role="region" aria-label="Code diff" tabIndex={0} className={cn("absolute inset-0", !wrapLines && "overflow-x-auto")}>
          {!wrapLines && <div aria-hidden="true" className="pointer-events-none absolute top-0 h-px" style={{ width: horizontalWidth }} />}
          {items.filter(item => item !== sticky).map(item => (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              inert={item.end <= stickyLine && focusedRow !== String(item.index)}
              className="absolute top-0 left-0 w-full"
              style={{
                transform: `translateY(${item.start - scrollMargin}px)`,
                width: !wrapLines && rows[item.index]!.kind === "line" ? horizontalWidth || undefined : undefined,
              }}
            >
              <RowView row={rows[item.index]!} actions={view} wrapLines={wrapLines} find={find} />
            </div>
          ))}
        </div>
      </div>
      {/* Keeps the bottom bar (or the find bar) off the last rows. */}
      <div aria-hidden="true" className={cn("h-16", !findOpen && "lg:hidden")} />
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
  wrapLines: boolean;
  find?: FindState;
  actions: {
    setCollapsed: (parsed: ParsedFile, collapsed: boolean) => void;
    setViewed: (parsed: ParsedFile, viewed: boolean) => void;
    /** `extend` (shift-click) grows the current selection in the same file to this line. */
    startComment: (parsed: ParsedFile, index: number, extend: boolean) => void;
    cancelComment: () => void;
    submitComment: (parsed: ParsedFile, index: number, body: string) => Promise<void>;
    ask: (parsed: ParsedFile, index: number, question: string, model: AgentModel) => Promise<void>;
    selectedLines: (parsed: ParsedFile) => number;
    /** Shows the unchanged lines `range` (new-side numbers) of the file. */
    expand: (parsed: ParsedFile, range: LineRange) => void;
    /** Whether a walkthrough group's band shows its whole summary. */
    groupOpen: (index: number) => boolean;
    toggleGroup: (index: number) => void;
    questionActions: QuestionActions;
    headSha: string;
  };
}

const lineTint: Record<DiffLine["kind"], string> = {
  hunk: "bg-diff-hunk text-muted-foreground",
  add: "bg-diff-add",
  del: "bg-diff-del",
  context: "bg-background",
};
/** Line-number cells. */
const gutterTint: Record<DiffLine["kind"], string> = { hunk: "", add: "bg-diff-add-num", del: "bg-diff-del-num", context: "" };
const markerTint: Record<DiffLine["kind"], string> = {
  hunk: "text-muted-foreground",
  add: "text-diff-add-fg",
  del: "text-diff-del-fg",
  context: "text-muted-foreground",
};
const marker: Record<DiffLine["kind"], string> = { hunk: "", add: "+", del: "-", context: " " };
/** Rows that jumps focus (file headers, group bands); the ring only shows for keyboard users. */
const jumpTarget = "outline-none focus-visible:ring-2 focus-visible:ring-ring";
const statusPill: Record<File["status"], string> = {
  added: "bg-diff-add-num text-diff-add-fg",
  deleted: "bg-diff-del-num text-diff-del-fg",
  renamed: "bg-foreground/8 text-muted-foreground",
  modified: "",
};

/** Rows of one file share side borders; the last one closes the card. */
const fileBody = (last: boolean) => cn("border-x", last && "rounded-b-lg border-b");

/**
 * Split highlights at token boundaries while retaining matches that cross them. Tokens are syntax tokens
 * (`th-*` classes) or, with an empty `classPrefix`, segments styled with their own classes.
 */
function FoundText({ text, tokens, rowKey, find, classPrefix = "th-" }: {
  text: string;
  tokens?: { value: string; className?: string }[];
  rowKey: string;
  find?: FindState;
  classPrefix?: string;
}) {
  const ranges = find?.query ? findText(text, find.query) : [];
  let offset = 0;
  let rangeIndex = 0;
  return (tokens ?? [{ value: text }]).map((token, tokenIndex) => {
    const from = offset;
    offset += token.value.length;
    while (ranges[rangeIndex] && ranges[rangeIndex]!.end <= from) rangeIndex++;
    const parts: ReactNode[] = [];
    let cursor = from;
    for (let i = rangeIndex; ranges[i] && ranges[i]!.start < offset; i++) {
      const range = ranges[i]!;
      const start = Math.max(from, range.start);
      const end = Math.min(offset, range.end);
      if (start > cursor) parts.push(token.value.slice(cursor - from, start - from));
      const current = find?.current?.rowKey === rowKey && find.current.start === range.start;
      parts.push(<mark key={range.start} data-find-current={current ? "true" : undefined}
        className={current
          ? "rounded-sm bg-orange-300 text-black outline outline-1 outline-orange-500 dark:bg-orange-400"
          : "rounded-sm bg-yellow-200/80 text-inherit dark:bg-yellow-400/35"}>
        {token.value.slice(start - from, end - from)}
      </mark>);
      cursor = end;
    }
    if (cursor < offset) parts.push(token.value.slice(cursor - from));
    return <span key={tokenIndex} className={token.className ? classPrefix + token.className : undefined}>{parts}</span>;
  });
}

function RowView({ row, actions, wrapLines, find }: RowViewProps) {
  switch (row.kind) {
    case "gap":
      return <div className="h-4" />;

    case "group":
      return <GroupBand row={row} open={actions.groupOpen(row.index)} toggle={() => actions.toggleGroup(row.index)} />;

    case "header": {
      const { file, additions, deletions } = row.parsed;
      const path = file.status === "renamed" ? `${file.oldPath} → ${file.newPath}` : file.newPath;
      const name = file.newPath.slice(file.newPath.lastIndexOf("/") + 1);
      // Clip long paths from the directory side, but wrap them while the current find match is in them.
      const clip = find?.current?.rowKey !== row.key;
      const slash = file.newPath.lastIndexOf("/") + 1;
      const dir = cn("text-muted-foreground", clip && "min-w-0 truncate");
      const segments = [
        ...(file.status === "renamed"
          ? [{ value: file.oldPath, className: dir }, { value: " → ", className: "shrink-0 whitespace-pre text-muted-foreground" }]
          : []),
        { value: file.newPath.slice(0, slash), className: dir },
        { value: file.newPath.slice(slash), className: cn("font-medium text-foreground", clip && "max-w-full shrink-0 truncate") },
      ];
      return (
        <div
          tabIndex={-1}
          className={cn(
            "flex min-h-10 min-w-0 items-center gap-2 rounded-t-lg border bg-muted px-1.5 py-px text-xs sm:pr-1.5 sm:pl-2",
            row.closed && "rounded-b-lg",
            jumpTarget,
          )}
        >
          <button
            type="button"
            onClick={() => actions.setCollapsed(row.parsed, !row.collapsed)}
            aria-label={`${row.collapsed ? "Expand" : "Collapse"} ${name}`}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-9"
          >
            <ChevronDown className={cn("size-4 transition-transform", row.collapsed && "-rotate-90")} />
          </button>
          <span role="heading" aria-level={row.level} className={cn("min-w-0 flex-1 font-mono", clip ? "flex overflow-hidden" : "[overflow-wrap:anywhere]")} title={path}>
            <FoundText text={path} tokens={segments} classPrefix="" rowKey={row.key} find={find} />
          </span>
          {file.status !== "modified" && (
            <span className={cn("shrink-0 rounded-md px-1.5 text-xs leading-5", statusPill[file.status])}>
              {file.status}
            </span>
          )}
          <span className="shrink-0 tabular-nums">
            <span className="text-diff-add-fg">+{additions}</span> <span className="text-diff-del-fg">−{deletions}</span>
          </span>
          <button
            type="button"
            role="checkbox"
            aria-checked={file.viewed}
            aria-label={`Viewed: ${name}`}
            onClick={() => actions.setViewed(row.parsed, !file.viewed)}
            className={cn(
              buttonVariants({ variant: file.viewed ? "ghost" : "outline", size: "xs" }),
              "min-w-7 px-2 has-[>svg]:px-2 pointer-coarse:min-w-9",
              !file.viewed && "text-muted-foreground hover:text-foreground",
            )}
          >
            {file.viewed ? <Check className="size-3.5 text-success" /> : <span className="size-3.5 rounded-[3px] border border-input" />}
            <span className="max-sm:sr-only">Viewed</span>
          </button>
        </div>
      );
    }

    case "line": {
      const line = row.parsed.lines[row.index]!;
      const tokens = line.kind === "hunk" ? undefined : tokensFor(row.parsed)[row.index];
      const number = cn("px-1 text-right text-muted-foreground tabular-nums select-none sm:px-2", gutterTint[line.kind]);
      const lineNumber = line.newLine ?? line.oldLine;
      // Hunk headers stay one line (a function signature would wrap to several on phones), unless the current
      // find match is in them. The rest is in the tooltip, or on touch screens, where there is none, a swipe away
      // (without the ellipsis: Chrome doesn't paint what it elides, so the line would scroll into nothing).
      const clip = line.kind === "hunk" && find?.current?.rowKey !== row.key;
      // Shift extends the selection in the same file.
      const start = (extend: boolean) => actions.startComment(row.parsed, row.index, extend);
      return (
        <div
          className={cn(
            // Taller lines on touch screens, where the line number is the button.
            "group grid grid-cols-[var(--num)_minmax(0,1fr)] font-mono text-xs leading-6 [--num:calc(var(--digits)_+_0.5rem)] sm:grid-cols-[var(--num)_var(--num)_1.25rem_minmax(0,1fr)] sm:[--num:calc(var(--digits)_+_1rem)] sm:pointer-fine:leading-5",
            row.expander && "max-sm:grid-cols-[auto_minmax(0,1fr)]",
            lineTint[line.kind],
            // Overlays, so they also cover the tinted line-number cells. Opacity rather than `bg-primary/10`: Tailwind
            // puts that color-mix in a nested `&` rule, which can't match a pseudo-element, so it would be opaque.
            row.selected && "relative before:pointer-events-none before:absolute before:inset-0 before:bg-primary before:opacity-10 after:pointer-events-none after:absolute after:inset-y-0 after:left-0 after:w-[3px] after:bg-primary",
            row.by && "opacity-40",
            fileBody(row.last),
          )}
          title={row.by && `Changed by ${row.by}`}
        >
          {row.expander ? (
            <Expander parsed={row.parsed} gap={row.expander.gap} loading={row.expander.loading} expand={actions.expand} />
          ) : (
            <>
              <span className={cn("hidden sm:block", number)}>{line.oldLine}</span>
              <span className={number}>
                {/* On touch screens (and narrow ones) the line number is the button. With a form open in the file,
                    tapping another line selects the range up to it, as there's no shift-click. */}
                {line.kind !== "hunk" && (
                  <button
                    type="button"
                    aria-label={`Ask or comment on line ${lineNumber}`}
                    onClick={() => start(true)}
                    className="min-h-6 w-full rounded text-right outline-none hover:bg-primary hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring sm:pointer-fine:hidden"
                  >
                    {lineNumber}
                  </button>
                )}
                <span className="hidden sm:pointer-fine:inline">{line.newLine}</span>
              </span>
              <span className="hidden select-none sm:block">
                {line.kind !== "hunk" && (
                  <button
                    type="button"
                    aria-label={`Ask or comment on line ${lineNumber}`}
                    title="Ask or comment about this line (shift-click to select a range)"
                    onClick={e => start(e.shiftKey)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && e.shiftKey) {
                        e.preventDefault();
                        start(true);
                      }
                    }}
                    className="mt-0.5 flex size-4 items-center justify-center rounded bg-primary text-primary-foreground opacity-0 outline-none group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background pointer-coarse:hidden [@media(hover:none)]:opacity-100"
                  >
                    <Plus className="size-3" />
                  </button>
                )}
              </span>
            </>
          )}
          <span
            className={cn(
              "-indent-3 pr-1 pl-3 sm:pr-4",
              clip ? "min-w-0 overflow-hidden text-ellipsis whitespace-pre pointer-coarse:overflow-x-auto pointer-coarse:text-clip pointer-coarse:[scrollbar-width:none]" : wrapLines ? "whitespace-pre-wrap [overflow-wrap:anywhere]" : "min-w-max whitespace-pre",
            )}
            title={clip && line.content ? line.content : undefined}
          >
            <span className={cn("inline-block w-3 indent-0 select-none", markerTint[line.kind])}>{marker[line.kind]}</span>
            <FoundText text={line.content} tokens={tokens} rowKey={row.key} find={find} />
            {row.expander?.error && (
              <span className="ml-2 text-destructive">Couldn't load the file: {row.expander.error}</span>
            )}
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
              lineCount={actions.selectedLines(row.parsed)}
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
          className={cn("w-full p-3 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground", fileBody(row.last))}
        >
          Large diff ({row.parsed.lines.length.toLocaleString()} lines) is hidden. Show it
        </button>
      ) : (
        <p className={cn("p-3 text-sm text-muted-foreground", fileBody(row.last))}>
          No textual changes (binary file or mode change).
        </p>
      );

    case "hiddenComments":
      return (
        <div className={cn("bg-muted/50 px-3 font-mono text-xs leading-5 text-muted-foreground", fileBody(row.last))}>
          ⋯ {row.count} {row.custom ? "filtered" : "comment-only"} {row.count === 1 ? "line" : "lines"} hidden
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

/**
 * Starts a walkthrough group: a section break rather than a card, with the summary cut to a few lines so the
 * band doesn't push the code away. The first one has nothing above it to separate from. Below sm the diff runs
 * edge to edge, so the text needs its own gutter.
 */
function GroupBand({ row, open, toggle }: { row: Row & { kind: "group" }; open: boolean; toggle: () => void }) {
  const { group } = row;
  const summary = useRef<HTMLDivElement>(null);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    if (!open && summary.current) setClamped(summary.current.scrollHeight > summary.current.clientHeight + 1);
  });
  const more = group && (clamped || group.riskReason || open);
  return (
    <div
      tabIndex={-1}
      className={cn(
        "mt-4 border-t px-3 pt-4 pb-3 font-sans sm:px-0 [[data-index='0']>&]:mt-0 [[data-index='0']>&]:border-t-0 [[data-index='0']>&]:pt-1",
        // An outline rather than a ring, as the text runs up to the band's edges.
        "rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      )}
    >
      {/* Running text rather than flex items, so it wraps like a sentence on phones. */}
      <p className="text-sm leading-6 [overflow-wrap:anywhere]">
        <span className="mr-1.5 text-xs text-muted-foreground">
          {group ? `Group ${row.index + 1} of ${row.count}` : "Not in the walkthrough"} ·
        </span>
        <span role="heading" aria-level={2} className="font-semibold">{group?.title ?? "Other changes"}</span>
        {group && (
          <Badge variant="outline" className={cn("ml-2 align-[1px] font-normal", riskBadge[group.risk])}>
            {group.risk} risk
          </Badge>
        )}
      </p>
      {group && (
        <div ref={summary} className={cn("mt-1 max-w-3xl", !open && "line-clamp-3")}>
          <Markdown>{group.summary}</Markdown>
        </div>
      )}
      {open && group && (
        <div className="mt-1.5 max-w-3xl space-y-1 text-xs text-muted-foreground">
          <p>{group.kinds.join(" · ")}</p>
          {group.riskReason && <Markdown className="text-xs">{group.riskReason}</Markdown>}
        </div>
      )}
      {more && (
        <button
          type="button"
          aria-expanded={open}
          onClick={toggle}
          className="mt-1 -ml-1 inline-flex items-center gap-0.5 rounded-md px-1 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-9"
        >
          {open ? "Less" : "More"}
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </button>
      )}
    </div>
  );
}

/** Buttons on a hunk header that show the unchanged lines hidden there, like GitLab's. */
function Expander({
  parsed,
  gap,
  loading,
  expand,
}: {
  parsed: ParsedFile;
  gap: Gap;
  loading: boolean;
  expand: RowViewProps["actions"]["expand"];
}) {
  const hidden = gap.to === undefined ? undefined : gap.to - gap.from + 1;
  const buttons: [LineRange, string, LucideIcon][] = [];
  if (hidden === undefined || hidden > expandStep) {
    // Down from the hunk above, up from the hunk below.
    if (gap.edge !== "top") buttons.push([[gap.from, gap.from + expandStep - 1], `Expand down ${expandStep} lines`, ChevronDown]);
    if (gap.edge !== "bottom") buttons.push([[gap.to! - expandStep + 1, gap.to!], `Expand up ${expandStep} lines`, ChevronUp]);
  }
  buttons.push([
    [gap.from, gap.to ?? Infinity],
    hidden === undefined ? "Expand to the end of the file" : `Expand all ${hidden} lines`,
    UnfoldVertical,
  ]);
  return (
    <span className={cn("flex items-center justify-end gap-0.5 px-1 select-none sm:col-span-3", loading && "animate-pulse")}>
      {buttons.map(([range, label, Icon]) => (
        <button
          key={label}
          type="button"
          title={label}
          aria-label={label}
          disabled={loading}
          onClick={() => expand(parsed, range)}
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-9"
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </span>
  );
}

import type { DiffLine } from "./diff";

/** Unchanged lines one click shows, like GitLab. */
export const expandStep = 20;

/** New-side lines `from`..`to` hidden at a hunk header; below the last hunk, `to` is unknown until the file is loaded. */
export interface Gap {
  from: number;
  to?: number;
  /** Above the first hunk nothing comes before the hidden lines, below the last nothing after them. */
  edge?: "top" | "bottom";
}

/** Inclusive range of new-side line numbers. */
export type LineRange = [number, number];

const headerPattern = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/**
 * Adds the unchanged lines `revealed` covers, taken from the new file's `content`, above, between and below the
 * diff's hunks. A hunk header stays wherever lines remain hidden (its numbers updated to what follows it) and
 * `gaps` holds what it hides, by index; one is added below the last hunk while the file may go on.
 */
export function expandLines(lines: DiffLine[], content: string[] | undefined, revealed: LineRange[]) {
  const out: DiffLine[] = [];
  const gaps = new Map<number, Gap>();
  const added = new Set<DiffLine>();
  const shows = (n: number) => content !== undefined && n <= content.length && revealed.some(([a, b]) => a <= n && n <= b);
  const push = (n: number, offset: number) => {
    const line: DiffLine = { kind: "context", content: content![n - 1]!, oldLine: n + offset, newLine: n };
    added.add(line);
    out.push(line);
  };

  /** The unchanged lines `from`..`to` before `header` (or the end of the file), where `offset` is old minus new. */
  const gap = (from: number, to: number | undefined, offset: number, header: DiffLine | undefined, edge?: Gap["edge"]) => {
    let top = from;
    while ((to === undefined || top <= to) && shows(top)) push(top++, offset);
    let bottom = to;
    while (bottom !== undefined && bottom >= top && shows(bottom)) bottom--;
    if (bottom === undefined || top <= bottom) {
      out.push(header ?? { kind: "hunk", content: "" });
      gaps.set(out.length - 1, { from: top, to: bottom, edge });
    } else if (header && from > to!) {
      // Nothing was hidden here, like above a hunk that starts at the first line.
      out.push(header);
    }
    if (to !== undefined) for (let n = bottom! + 1; n <= to; n++) push(n, offset);
  };

  let nextOld = 1;
  let nextNew = 1;
  for (const line of lines) {
    const header = line.kind === "hunk" && line.content.match(headerPattern);
    if (!header) {
      out.push(line);
      continue;
    }
    const [, o, oldCount = "1", n, newCount = "1"] = header;
    // A side without lines is numbered by the line before it.
    const oldStart = Number(o) + (oldCount === "0" ? 1 : 0);
    const newStart = Number(n) + (newCount === "0" ? 1 : 0);
    gap(nextNew, newStart - 1, oldStart - newStart, line, line === lines[0] ? "top" : undefined);
    nextOld = oldStart + Number(oldCount);
    nextNew = newStart + Number(newCount);
  }
  if (lines.length > 0) gap(nextNew, content?.length, nextOld - nextNew, undefined, "bottom");

  // Headers above revealed lines describe the lines below them again.
  out.forEach((line, i) => {
    const header = line.kind === "hunk" && line.content.match(headerPattern);
    if (!header) return;
    const end = out.findIndex((l, j) => j > i && l.kind === "hunk");
    const body = out.slice(i + 1, end === -1 ? undefined : end);
    if (!body.some(l => added.has(l))) return;
    const range = (numbers: number[]) => `${numbers[0]},${numbers.length}`;
    const olds = body.flatMap(l => (l.oldLine === undefined ? [] : [l.oldLine]));
    const news = body.flatMap(l => (l.newLine === undefined ? [] : [l.newLine]));
    out[i] = { ...line, content: `@@ -${range(olds)} +${range(news)} @@${header[5]}` };
  });

  return { lines: out, gaps, added };
}

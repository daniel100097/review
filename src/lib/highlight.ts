import { normalizeLanguage, tokenize, type HighlightToken } from "@tanstack/highlight";
import { createThemeCss, themeTokenClasses } from "@tanstack/highlight/theme";
import { githubDarkTheme } from "@tanstack/highlight/themes/github-dark";
import { githubLightTheme } from "@tanstack/highlight/themes/github-light";
import type { DiffLine } from "./diff";

export type { HighlightToken };

/** Token colors for `th-*` classes, switching with the `.dark` class. */
export const highlightCss = [
  createThemeCss({ light: githubLightTheme, dark: githubDarkTheme, darkSelector: ".dark", includeBaseStyles: false }),
  ...themeTokenClasses.filter(c => c !== "token").map(c => `.th-${c} { color: var(--th-${c}); }`),
].join("\n");

/** Extensions the highlighter doesn't know, mapped to the closest language it does. */
const extensionAliases: Record<string, string> = {
  mts: "ts",
  cts: "ts",
  astro: "html",
  svg: "html",
  scss: "css",
  sass: "css",
  less: "css",
  c: "cpp",
  h: "cpp",
  cc: "cpp",
};

export function languageFor(path: string) {
  const name = path.split("/").pop()!.toLowerCase();
  if (name === "dockerfile" || name.endsWith(".dockerfile")) return "dockerfile";
  if (name.startsWith(".env")) return "env";
  if (name === "cmakelists.txt") return "cmake";
  const ext = name.split(".").pop()!;
  return normalizeLanguage(extensionAliases[ext] ?? ext);
}

function splitLines(tokens: HighlightToken[]) {
  const lines: HighlightToken[][] = [[]];
  for (const token of tokens) {
    token.value.split("\n").forEach((value, i) => {
      if (i > 0) lines.push([]);
      if (value) lines.at(-1)!.push({ className: token.className, value });
    });
  }
  return lines;
}

/**
 * Highlights diff lines, returning tokens per line (undefined for hunk headers and plaintext).
 * Each hunk's old and new sides are tokenized as contiguous code, so multi-line strings and
 * comments keep their context.
 */
export function highlightDiff(path: string, lines: DiffLine[]): (HighlightToken[] | undefined)[] {
  const result: (HighlightToken[] | undefined)[] = new Array(lines.length);
  const lang = languageFor(path);
  if (lang === "plaintext") return result;

  const highlightSide = (indexes: number[], keep: (line: DiffLine) => boolean) => {
    const tokens = splitLines(tokenize(indexes.map(i => lines[i]!.content).join("\n"), { lang }).tokens);
    indexes.forEach((lineIndex, j) => {
      if (keep(lines[lineIndex]!)) result[lineIndex] = tokens[j];
    });
  };

  let hunk: number[] = [];
  const flush = () => {
    // Context lines appear on both sides; take their tokens from the new side.
    highlightSide(
      hunk.filter(i => lines[i]!.kind !== "del"),
      () => true,
    );
    highlightSide(
      hunk.filter(i => lines[i]!.kind !== "add"),
      line => line.kind === "del",
    );
    hunk = [];
  };
  lines.forEach((line, i) => {
    if (line.kind === "hunk") flush();
    else hunk.push(i);
  });
  flush();
  return result;
}

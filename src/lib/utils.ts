import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

export function timeAgo(iso: string) {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

/**
 * Scrolls `element` into view inside its nearest scrollable ancestor only. `scrollIntoView` would also scroll the
 * window (and honour the page's scroll-padding), which moves the virtualized diff.
 */
export function revealInScrollParent(element: HTMLElement) {
  let parent = element.parentElement;
  while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement;
  if (!parent) return;
  const box = element.getBoundingClientRect();
  const view = parent.getBoundingClientRect();
  if (box.top < view.top) parent.scrollTop -= view.top - box.top + 8;
  else if (box.bottom > view.bottom) parent.scrollTop += box.bottom - view.bottom + 8;
}

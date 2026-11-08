import { createThemeCss } from "@tanstack/highlight/theme";
import { githubDarkTheme } from "@tanstack/highlight/themes/github-dark";
import { githubLightTheme } from "@tanstack/highlight/themes/github-light";
import viewerScript from "../vendor/flowmark/viewer.js.txt";
import viewerCss from "../vendor/flowmark/viewer.css.txt";
import type { FlowmarkModel } from "./flowmark";

/**
 * Upstream viewer variable → app token. The parent posts the tokens' computed values, so the viewer follows the app's
 * palette and theme switches live; anything not posted keeps the upstream colour.
 */
export const flowmarkThemeVars = {
  "--bg": "--background",
  "--bg-soft": "--muted",
  "--fg": "--foreground",
  "--muted": "--muted-foreground",
  "--line": "--border",
  "--accent": "--primary",
  "--accent-fg": "--primary-foreground",
  "--ring": "--ring",
  "--risk": "--destructive",
  "--unsure": "--warning",
  "--add-bg": "--diff-add",
  "--add-fg": "--diff-add-fg",
  "--del-bg": "--diff-del",
  "--del-fg": "--diff-del-fg",
} as const;

/** The viewer's own shortcuts (levels, show changes, before/after), forwarded while the review tab is open. */
export const flowmarkKeys = /^([0-3]|[cdba]|Escape)$/;

/** Code in the viewer uses the diff's syntax colours. */
const syntaxCss = `${createThemeCss({
  light: githubLightTheme,
  dark: githubDarkTheme,
  darkSelector: ":root[data-theme=dark]",
  includeBaseStyles: false,
})}
:root[data-theme] { --kw: var(--th-keyword); --str: var(--th-string); --num: var(--th-number); --type: var(--th-type); }`;

/**
 * Restyles the upstream chrome like the app's controls without forking it: segmented controls like the app's tabs
 * (one neutral raised style, so the app's primary buttons stay the only blue), soft count pills, quiet reference
 * links, the diff's 12px/20px code. `:root[data-theme]` beats the per-theme blocks copied from upstream (which also
 * set the fonts).
 */
const appCss = `
:root, :root[data-theme] {
  --sans: "Geist Variable", system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: "Geist Mono Variable", ui-monospace, "SF Mono", Menlo, monospace;
  --accent-fg: #fff;
  --risk-bg: color-mix(in oklab, var(--risk) 12%, var(--bg));
  --unsure-bg: color-mix(in oklab, var(--unsure) 14%, var(--bg));
}
html { color-scheme: light; }
:root[data-theme=dark] { color-scheme: dark; }
html:not([data-theme]) body { visibility: hidden; }
body { margin: 0; background: var(--bg); color: var(--fg); -webkit-font-smoothing: antialiased; }
.flowmark { font-size: 13px; line-height: 1.5; }
button:focus-visible, a:focus-visible, input:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--ring, var(--accent)); outline-offset: 2px; }
.ref:focus-visible, .helper-toggle:focus-visible { outline-offset: 0; }
.row.placeholder:focus-visible { outline-offset: -2px; }
.fm-header { padding: 6px 12px; gap: 8px 12px; min-height: 44px; box-sizing: border-box; }
.fm-title strong { font-size: 14px; font-weight: 600; letter-spacing: -.01em; }
/* "before.review.ts → after.review.ts" names the generated documents, not repository files. */
.fm-file { display: none; }
.fm-levels { border: 0; border-radius: 8px; background: var(--bg-soft); padding: 3px; gap: 2px; }
.fm-levels button { border: 0; border-radius: 6px; padding: 2px 10px; line-height: 22px; font-size: 13px; font-weight: 500; color: var(--muted); }
.fm-levels button:hover { color: var(--fg); }
.fm-levels button.active { background: var(--bg); color: var(--fg); box-shadow: 0 1px 2px rgb(0 0 0 / .1), 0 0 0 1px var(--line); }
.fm-counts { gap: 6px; }
.fm-toggle { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; }
.fm-toggle input { accent-color: var(--accent); margin: 0; }
.fm-count { border: 0; border-radius: 6px; padding: 1px 8px; line-height: 20px; font-size: 12px; font-weight: 500; font-variant-numeric: tabular-nums; background: var(--bg-soft); }
.fm-count.risk, .fm-count.error { background: var(--risk-bg); }
.fm-count.warn { background: var(--unsure-bg); }
main { padding: 12px 16px 32px; }
.fm-card h1 { font-size: 18px; font-weight: 600; letter-spacing: -.01em; }
.fm-card table, .fm-changes li { font-size: 12px; }
.fm-list h2, .fm-changes h2 { font-size: 12px; font-weight: 500; letter-spacing: .04em; }
.fm-changes { border: 0; border-radius: 6px; }
.fm-code { font-size: 12px; line-height: 20px; overflow-x: auto; }
.row { min-height: 20px; }
.row .ln { opacity: 1; font-variant-numeric: tabular-nums; }
.row.section { border-top-style: solid; }
/* Quiet one-line links, so references don't wrap code lines (or turn into multi-line pills on phones). */
.ref {
  display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom;
  border: 0; border-radius: 4px; background: none; padding: 0 4px; color: var(--muted);
}
.ref:hover { background: var(--bg-soft); color: var(--fg); }
.ref.scope { text-decoration: underline dashed var(--line); text-underline-offset: 3px; }
.fm-title, .fm-card, .fm-list, .fm-changes { overflow-wrap: anywhere; }
.fm-list li { flex-wrap: wrap; }
@media (max-width: 640px) {
  main { padding: 8px 8px 24px; }
  .fm-header { padding: 6px 8px; gap: 6px; }
  .fm-title { flex-basis: 100%; }
  .fm-title strong { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fm-levels button { padding: 4px 8px; }
  /* "L1 Flow" → "L1" on phones; the button keeps its accessible name. */
  .fm-levels:not(.fm-modes) { counter-reset: level -1; }
  .fm-levels:not(.fm-modes) button { font-size: 0; padding: 4px 10px; }
  .fm-levels:not(.fm-modes) button::before { counter-increment: level; content: "L" counter(level) / ""; font-size: 13px; }
  .fm-changes .what { display: block; min-width: 0; margin: 0; }
}
/* After the phone block, so touch sizing also wins there (and on wide touch screens). */
@media (pointer: coarse) { .fm-levels button { min-height: 36px; } }`;

/** Upstream's light and dark colour blocks (`:root {…}`, then the same inside `prefers-color-scheme: dark`). */
export const viewerColors = [...viewerCss.matchAll(/:root \{([^}]+)\}/g)].map(match => match[1]!);

/** Keep untrusted review text inside JSON and the upstream viewer's text nodes. */
export function flowmarkDocument(model: FlowmarkModel): string {
  const json = JSON.stringify(model).replaceAll("<", "\\u003c");
  // The embedded viewer has its own scroll/keys; app filters own the parent URL.
  const script = viewerScript.replaceAll("if (global.history && global.location)", "if (false)");
  const styles = `${viewerCss}\n:root[data-theme=light] {${viewerColors[0]}}\n:root[data-theme=dark] {${viewerColors[1]}}\n${syntaxCss}\n${appCss}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<style>${styles}</style></head><body><div id="review" class="flowmark"></div>
<script type="application/json" id="model">${json}</script>
<script>${script}
const themeVars = ${JSON.stringify(Object.keys(flowmarkThemeVars))};
const keys = ${flowmarkKeys};
window.addEventListener('message', ({ source, data }) => {
  if (source !== parent || !data) return;
  const root = document.documentElement;
  if (data.type === 'flowmark-theme') {
    root.dataset.theme = data.dark ? 'dark' : 'light';
    // Colour values only: no quotes, colons, semicolons or backslashes, so no extra declarations or escapes; url()
    // (which the character set alone allows, e.g. url(//host/x)) is rejected too, though the CSP would block it.
    for (const name of themeVars) {
      const value = data.vars?.[name];
      if (typeof value === 'string' && /^[\\w\\s.,%#()\\/+-]{1,100}$/.test(value) && !/url\\(/i.test(value)) root.style.setProperty(name, value);
      else root.style.removeProperty(name);
    }
  } else if (data.type === 'flowmark-fonts' && Array.isArray(data.fonts)) {
    // FontFace from bytes works under default-src 'none'; @font-face with data: URLs would need font-src.
    for (const font of data.fonts.slice(0, 4)) {
      if (!/^Geist (Mono )?Variable$/.test(font?.family) || !(font.data instanceof ArrayBuffer) || font.data.byteLength > 200000) continue;
      new FontFace(font.family, font.data, { weight: '100 900' }).load().then(face => document.fonts.add(face), () => {});
    }
  } else if (data.type === 'flowmark-key' && typeof data.key === 'string' && keys.test(data.key)) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: data.key }));
  }
});
// Show the review even if the parent never sends a theme.
setTimeout(() => { document.documentElement.dataset.theme ||= matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }, 1000);
document.addEventListener('click', event => {
  const ref = event.target.closest?.('.ref');
  if (!ref) return;
  event.stopImmediatePropagation();
  const lines = ref.title.split('\\n');
  const target = lines.find(line => line.startsWith('target: '))?.slice(8) || '';
  const quote = lines.find(line => line.startsWith('quote: '))?.slice(7) || '';
  parent.postMessage({type:'flowmark-copy', text:[target, quote && JSON.stringify(quote)].filter(Boolean).join(' ')}, '*');
}, true);
// Upstream's references, "⋯ N lines" placeholders and helper toggles only handle clicks: make them keyboard buttons.
const review = document.getElementById('review');
const pressable = '.ref, .row.placeholder, .helper-toggle';
const focusables = () => [...review.querySelectorAll(pressable + ', button, input')];
let focused, focusedAt = -1;
review.addEventListener('focusin', event => { focused = event.target; focusedAt = focusables().indexOf(focused); });
// Forget it when focus really leaves (Chrome also fires focusout for an element that is being removed).
review.addEventListener('focusout', ({ target }) => queueMicrotask(() => { if (focused === target && target.isConnected) focused = undefined; }));
document.addEventListener('keydown', event => {
  if ((event.key !== 'Enter' && event.key !== ' ') || !event.target.matches?.(pressable)) return;
  event.preventDefault();
  event.target.click();
});
// The viewer re-renders everything on each change, so this also runs after every level, mode or expand.
new MutationObserver(() => {
  for (const element of review.querySelectorAll(pressable)) { element.tabIndex = 0; element.setAttribute('role', 'button'); }
  for (const button of review.querySelectorAll('.fm-levels button')) button.setAttribute('aria-pressed', button.classList.contains('active'));
  // Keep keyboard focus where it was instead of dropping it to <body> with the replaced element.
  if (focused && !focused.isConnected && document.hasFocus() && !review.contains(document.activeElement)) {
    const list = focusables();
    list[Math.min(focusedAt, list.length - 1)]?.focus({ preventScroll: true });
  }
}).observe(review, { childList: true, subtree: true });
try { Flowmark.mount(review, JSON.parse(document.getElementById('model').textContent), {level:1}); }
catch (error) { review.textContent = 'Could not display Flowmark: ' + error.message; }
</script></body></html>`;
}

import geistMono from "@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2";
import geist from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { FlowmarkModel } from "@/lib/flowmark";
import { flowmarkDocument, flowmarkKeys, flowmarkThemeVars } from "@/lib/flowmark-viewer";

/**
 * The app's Latin fonts as bytes for the sandboxed viewer, fetched once per session. The app's own CSS inlines its
 * fonts, so there is no URL the frame could use, and its CSP doesn't allow loading fonts anyway.
 */
let fonts: Promise<{ family: string; data: ArrayBuffer }[]> | undefined;
const appFonts = () =>
  (fonts ??= Promise.all(
    ([["Geist Variable", geist], ["Geist Mono Variable", geistMono]] as const).map(async ([family, url]) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${family}: HTTP ${response.status}`);
      return { family, data: await response.arrayBuffer() };
    }),
  ).catch(() => {
    fonts = undefined; // The next review tries again.
    return [];
  }));

/** The upstream viewer in a sandboxed frame that fills the rest of the window; only the review scrolls inside it. */
export function FlowmarkViewer({ model, active = true }: { model: FlowmarkModel; active?: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [notice, setNotice] = useState("");
  const [top, setTop] = useState(0);
  const document = useMemo(() => flowmarkDocument(model), [model]);
  // The frame's origin is "null", so posts must target "*"; the frame checks that they come from its parent.
  const post = (message: unknown) => frame.current?.contentWindow?.postMessage(message, "*");
  const theme = () => {
    const root = window.document.documentElement;
    const css = getComputedStyle(root);
    post({
      type: "flowmark-theme",
      dark: root.classList.contains("dark"),
      vars: Object.fromEntries(Object.entries(flowmarkThemeVars).map(([name, token]) => [name, css.getPropertyValue(token).trim()])),
    });
  };
  const load = () => {
    theme();
    // Copied, not transferred: the cached buffers are reused for the next review.
    void appFonts().then(list => post({ type: "flowmark-fonts", fonts: list }));
  };

  // Fill the window below the frame's top (minus the page's 1.5rem bottom padding) next to the sidebar; below lg, fill
  // the screen under the 48px header once the page is scrolled to the frame (the page's bottom padding is 1rem
  // below sm, so the frame is taller there, or the page couldn't scroll that far). Auto-height would break the
  // viewer's sticky header and its own scrolling.
  useLayoutEffect(() => {
    const measure = () => {
      const box = frame.current?.getBoundingClientRect();
      if (box && box.width) setTop(Math.round(box.top + window.scrollY));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(window.document.body);
    return () => observer.disconnect();
  }, []);

  // Below lg, bring the frame under the header when the tab opens (or the review arrives on it): a swipe on the
  // frame scrolls the review, not the page, so the review would otherwise be read through what's left of the
  // window. The title and the actions above stay a swipe up away, as the frame chains scrolling at its top.
  useLayoutEffect(() => {
    if (!active || !matchMedia("(width < 64rem)").matches) return;
    const box = frame.current?.getBoundingClientRect();
    if (box?.width) window.scrollTo({ top: Math.round(box.top + window.scrollY - 48) });
  }, [active]);

  useEffect(() => {
    const observer = new MutationObserver(theme);
    observer.observe(window.document.documentElement, { attributes: true, attributeFilter: ["class"] });
    const copyRef = async (event: MessageEvent) => {
      const text = event.data?.text;
      if (event.source !== frame.current?.contentWindow || event.data?.type !== "flowmark-copy" || typeof text !== "string" || text.length > 20000) return;
      // Only right after a click or key press: a click in the frame also activates this page, a script alone doesn't.
      // Browsers without the API (Firefox before 120, Safari before 16.4) still copy.
      if (navigator.userActivation && !navigator.userActivation.isActive) return;
      try {
        if (navigator.clipboard) await navigator.clipboard.writeText(text);
        else {
          const field = window.document.createElement("textarea");
          field.value = text;
          field.style.cssText = "position:fixed;opacity:0";
          window.document.body.append(field);
          field.select();
          try { if (!window.document.execCommand("copy")) throw new Error("Clipboard unavailable"); }
          finally { field.remove(); frame.current?.focus(); }
        }
        setNotice(`Copied ref: ${text}`);
      } catch { setNotice("Could not copy this reference. Its target and quote are shown on hover."); }
    };
    window.addEventListener("message", copyRef);
    return () => { observer.disconnect(); window.removeEventListener("message", copyRef); };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), 3000);
    return () => clearTimeout(timeout);
  }, [notice]);

  // The viewer's keys (0–3 levels, c changes, d/b/a modes, Escape) also work before clicking into the frame.
  useEffect(() => {
    if (!active) return;
    const forward = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      const busy = target?.closest("input, textarea, select, [contenteditable], [role=dialog], [role=listbox], [role=menu]");
      if (e.defaultPrevented || busy || e.ctrlKey || e.metaKey || e.altKey || !flowmarkKeys.test(e.key)) return;
      post({ type: "flowmark-key", key: e.key });
    };
    window.addEventListener("keydown", forward);
    return () => window.removeEventListener("keydown", forward);
  }, [active]);

  return (
    <div className="relative min-w-0">
      <iframe
        ref={frame}
        title="Flowmark interactive review"
        sandbox="allow-scripts"
        srcDoc={document}
        onLoad={load}
        style={{ "--frame-top": `${top}px` } as CSSProperties}
        className="block h-[calc(100dvh-4rem)] w-full min-w-0 rounded-lg border bg-background sm:h-[calc(100dvh-4.5rem)] lg:h-[max(calc(100dvh-var(--frame-top)-1.5rem),36rem)]"
      />
      <p
        role="status"
        className={notice
          ? "fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-50 line-clamp-2 w-max max-w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 rounded-md bg-foreground px-3 py-1.5 text-xs text-background shadow-lg [overflow-wrap:anywhere]"
          : "sr-only"}
      >
        {notice}
      </p>
    </div>
  );
}

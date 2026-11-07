import { useEffect, useMemo, useRef, useState } from "react";
import type { FlowmarkModel } from "@/lib/flowmark";
import { flowmarkDocument } from "@/lib/flowmark-viewer";

export function FlowmarkViewer({ model }: { model: FlowmarkModel }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [notice, setNotice] = useState("");
  const document = useMemo(() => flowmarkDocument(model), [model]);
  const theme = () => frame.current?.contentWindow?.postMessage({ type: "flowmark-theme", dark: window.document.documentElement.classList.contains("dark") }, "*");
  useEffect(() => {
    const observer = new MutationObserver(theme);
    observer.observe(window.document.documentElement, { attributes: true, attributeFilter: ["class"] });
    const copyRef = async (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.type !== "flowmark-copy" || typeof event.data.text !== "string" || event.data.text.length > 20000) return;
      try {
        if (navigator.clipboard) await navigator.clipboard.writeText(event.data.text);
        else {
          const field = window.document.createElement("textarea");
          field.value = event.data.text;
          field.style.cssText = "position:fixed;opacity:0";
          window.document.body.append(field);
          field.select();
          try { if (!window.document.execCommand("copy")) throw new Error("Clipboard unavailable"); }
          finally { field.remove(); frame.current?.focus(); }
        }
        setNotice("Code reference copied.");
      } catch { setNotice("Could not copy this reference. Its target and quote are shown on hover."); }
    };
    window.addEventListener("message", copyRef);
    return () => { observer.disconnect(); window.removeEventListener("message", copyRef); };
  }, []);
  return <div className="min-w-0 space-y-1"><iframe ref={frame} title="Flowmark interactive review" sandbox="allow-scripts" srcDoc={document} onLoad={theme}
    className="h-[75dvh] min-h-80 w-full min-w-0 rounded-md border bg-background" />
    {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}</div>;
}

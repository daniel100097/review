import { cn } from "@/lib/utils";
import { ImageOff } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Forge Markdown links relative to the forge (GitLab's `/uploads/...`, anchors); here they would point at this app.
const absolute = (url?: string) => /^(https?:|mailto:)/i.test(url ?? "");

/** Renders Markdown from agents and forge comments. Raw HTML in it stays text, so neither can inject markup. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("markdown min-w-0 max-w-full text-sm leading-relaxed [overflow-wrap:anywhere]", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, href, ...props }) =>
            absolute(href) ? <a {...props} href={href} target="_blank" rel="noreferrer" /> : <span {...props} />,
          img: ({ node, src, alt }) =>
            typeof src === "string" && /^https:/i.test(src) ? (
              <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" />
            ) : (
              <span title="Image not available here" className="inline-flex items-center gap-1 text-muted-foreground">
                <ImageOff className="size-3.5 shrink-0" />
                {alt || "image"}
              </span>
            ),
          pre: ({ children }) => <pre className="max-w-full overflow-x-auto whitespace-pre [overflow-wrap:normal]">{children}</pre>,
          table: ({ children }) => <div className="max-w-full overflow-x-auto [overflow-wrap:normal]"><table>{children}</table></div>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

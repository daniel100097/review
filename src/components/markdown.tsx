import { cn } from "@/lib/utils";
import { Image, ImageOff } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Forge Markdown links relative to the forge (GitLab's `/uploads/...`, anchors); here they would point at this app.
const absolute = (url?: string) => /^(https?:|mailto:)/i.test(url ?? "");

/**
 * Renders Markdown from agents and forge comments. Raw HTML in it stays text, so neither can inject markup.
 * Images are links that load nothing: the reviewed code can steer an agent into writing an image URL that leaks
 * data as soon as it loads. `loadImages` shows https images inline, for what people wrote on the forge.
 */
export function Markdown({ children, className, loadImages = false }: { children: string; className?: string; loadImages?: boolean }) {
  return (
    <div className={cn("markdown min-w-0 max-w-full text-sm leading-relaxed [overflow-wrap:anywhere]", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, href, ...props }) =>
            absolute(href) ? <a {...props} href={href} target="_blank" rel="noreferrer" /> : <span {...props} />,
          img: ({ node, src, alt }) => {
            const https = typeof src === "string" && /^https:/i.test(src);
            if (https && loadImages) return <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" />;
            return https ? (
              <a href={src} target="_blank" rel="noreferrer" title="Open image in a new tab" className="inline-flex items-center gap-1">
                <Image aria-hidden className="size-3.5 shrink-0" />
                {alt || "image"}
              </a>
            ) : (
              <span title="Image not available here" className="inline-flex items-center gap-1 text-muted-foreground">
                <ImageOff aria-hidden className="size-3.5 shrink-0" />
                {alt || "image"}
              </span>
            );
          },
          pre: ({ children }) => <pre className="max-w-full overflow-x-auto whitespace-pre [overflow-wrap:normal]">{children}</pre>,
          table: ({ children }) => <div className="max-w-full overflow-x-auto [overflow-wrap:normal]"><table>{children}</table></div>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

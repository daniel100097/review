import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Renders Markdown from agents. Raw HTML in it stays text, so an answer can't inject markup. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("markdown text-sm break-words", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ a: props => <a {...props} target="_blank" rel="noreferrer" /> }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

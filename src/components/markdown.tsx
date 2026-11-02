import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Renders Markdown from agents. Raw HTML in it stays text, so an answer can't inject markup. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("markdown min-w-0 max-w-full text-sm [overflow-wrap:anywhere]", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: props => <a {...props} target="_blank" rel="noreferrer" />,
          pre: ({ children }) => <pre className="max-w-full overflow-x-auto whitespace-pre [overflow-wrap:normal]">{children}</pre>,
          table: ({ children }) => <div className="max-w-full overflow-x-auto [overflow-wrap:normal]"><table>{children}</table></div>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

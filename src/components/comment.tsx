import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { RouterOutputs } from "@/lib/trpc";
import { timeAgo } from "@/lib/utils";
import { useState, type ReactNode } from "react";

export type Comment = RouterOutputs["pulls"]["comments"][number];

/** A forge comment: avatar, name and time on one line, the Markdown body indented under them. */
export function CommentItem({ comment, context }: { comment: Comment; context?: ReactNode }) {
  const { author } = comment;
  return (
    <div className="flex min-w-0 gap-2 font-sans [overflow-wrap:anywhere]">
      {author.avatarUrl ? (
        <img src={author.avatarUrl} alt="" className="size-6 shrink-0 rounded-full bg-muted" />
      ) : (
        <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
          {author.name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-h-6 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span className="text-sm font-medium text-foreground">{author.name}</span>
          <time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()}>
            {timeAgo(comment.createdAt)}
          </time>
          {context}
        </div>
        <Markdown className="mt-1">{comment.body}</Markdown>
      </div>
    </div>
  );
}

export function CommentForm({
  onSubmit,
  onCancel,
  placeholder = "Leave a comment",
  autoFocus,
}: {
  onSubmit: (body: string) => Promise<unknown>;
  onCancel?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async () => {
    if (!body.trim() || pending) return;
    setPending(true);
    setError(undefined);
    try {
      await onSubmit(body);
      setBody("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      className="min-w-0 space-y-2 font-sans [overflow-wrap:anywhere]"
      onSubmit={e => {
        e.preventDefault();
        submit();
      }}
    >
      <Textarea
        className="min-h-20 min-w-0 resize-y"
        value={body}
        onChange={e => setBody(e.target.value)}
        placeholder={placeholder}
        aria-label="Comment"
        autoFocus={autoFocus}
        onKeyDown={e => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          if (e.key === "Escape") onCancel?.();
        }}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" size="sm" disabled={pending || !body.trim()}>
          {pending ? "Posting…" : "Comment"}
        </Button>
      </div>
    </form>
  );
}

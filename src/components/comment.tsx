import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { RouterOutputs } from "@/lib/trpc";
import { timeAgo } from "@/lib/utils";
import { useState, type ReactNode } from "react";

export type Comment = RouterOutputs["pulls"]["comments"][number];

export function CommentItem({ comment, context }: { comment: Comment; context?: ReactNode }) {
  return (
    <div className="flex gap-3">
      {comment.author.avatarUrl && <img src={comment.author.avatarUrl} alt="" className="size-7 shrink-0 rounded-full" />}
      <div className="min-w-0 flex-1 rounded-md border bg-card">
        <div className="flex flex-wrap items-center gap-x-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{comment.author.name}</span>
          <span>{timeAgo(comment.createdAt)}</span>
          {context}
        </div>
        <div className="px-3 py-2 text-sm break-words whitespace-pre-wrap">{comment.body}</div>
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
      className="space-y-2 font-sans"
      onSubmit={e => {
        e.preventDefault();
        submit();
      }}
    >
      <Textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onKeyDown={e => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          if (e.key === "Escape") onCancel?.();
        }}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
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

import { cn } from "@/lib/utils";
import type { PullState } from "@/server/providers/types";
import { GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, type LucideIcon } from "lucide-react";

const icons: Record<PullState, LucideIcon> = { open: GitPullRequest, merged: GitMerge, closed: GitPullRequestClosed };
const colors: Record<PullState, string> = {
  open: "text-state-open",
  merged: "text-state-merged",
  closed: "text-state-closed",
};
const pills: Record<PullState, string> = {
  open: "bg-state-open/12 text-state-open",
  merged: "bg-state-merged/12 text-state-merged",
  closed: "bg-state-closed/12 text-state-closed",
};

/** A pull request's state as a colored icon, for lists. Drafts get the draft icon in muted color. */
export function PullStateIcon({ state, draft, className }: { state: PullState; draft?: boolean; className?: string }) {
  const Icon = draft && state === "open" ? GitPullRequestDraft : icons[state];
  return (
    <Icon
      role="img"
      aria-label={draft && state === "open" ? "Draft" : state[0]!.toUpperCase() + state.slice(1)}
      className={cn("size-4 shrink-0", draft && state === "open" ? "text-muted-foreground" : colors[state], className)}
    />
  );
}

/** A pull request's state as a soft pill with icon, for headers. */
export function PullStateBadge({ state, draft }: { state: PullState; draft?: boolean }) {
  const Icon = icons[state];
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium capitalize", pills[state])}>
      <Icon className="size-3.5" aria-hidden />
      {state}
      {draft && <span className="font-normal opacity-80">· draft</span>}
    </span>
  );
}

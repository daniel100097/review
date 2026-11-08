import type { RouterOutputs } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { LoaderCircle, X } from "lucide-react";

export type Contributor = RouterOutputs["pulls"]["contributors"][number];

type Author = { key: string; name: string };

/** One contributor's changes: who added (by new line) and deleted (by old line) each changed line, per file. */
export interface ContributorFilter {
  key: string;
  name: string;
  lines: Map<string, { added: Map<number, Author>; deleted: Map<number, Author> }>;
}

/** Chips for a section of the Filters popover: pick a contributor to see only what they changed. */
export function ContributorList({
  contributors,
  selected,
  onSelect,
  loading,
  error,
}: {
  contributors: Contributor[];
  selected: string | undefined;
  onSelect: (key: string | undefined) => void;
  loading: boolean;
  error?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 [overflow-wrap:anywhere]">
      <div className="flex min-h-7 flex-wrap items-center gap-x-2">
        <span className="text-[13px] font-medium">Changes by</span>
        {loading && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <LoaderCircle className="size-3.5 shrink-0 animate-spin" /> finding who changed what…
          </span>
        )}
        {selected && !loading && (
          <button
            type="button"
            className="ml-auto flex items-center gap-0.5 rounded-md px-1 py-0.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-9"
            onClick={() => onSelect(undefined)}
          >
            <X className="size-3" /> everyone
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {contributors.map(c => (
          <button
            key={c.key}
            type="button"
            aria-pressed={selected === c.key}
            title={`${c.commits} ${c.commits === 1 ? "commit" : "commits"}${c.key.includes("@") ? ` · ${c.key}` : ` · @${c.key}`}`}
            onClick={() => onSelect(selected === c.key ? undefined : c.key)}
            className={cn(
              "flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md border pr-2.5 pl-1 text-xs transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-9 pointer-coarse:pl-1.5",
              // Neutral emphasis: the accent is reserved for primary actions and focus.
              selected === c.key && "border-foreground bg-foreground text-background hover:bg-foreground/90",
              selected && selected !== c.key && "text-muted-foreground",
            )}
          >
            {c.avatarUrl ? (
              <img src={c.avatarUrl} alt="" className="size-5 shrink-0 rounded-full" />
            ) : (
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[0.625rem] font-medium text-muted-foreground uppercase">
                {c.name.slice(0, 1)}
              </span>
            )}
            <span className="min-w-0 truncate">{c.name}</span>
            <span className={cn("shrink-0 text-muted-foreground tabular-nums", selected === c.key && "text-background/70")}>{c.commits}</span>
          </button>
        ))}
      </div>
      {/* Kept mounted (sr-only while empty) so a later error is announced. */}
      <p role="alert" className={cn("text-xs text-destructive", !error && "sr-only")}>{error}</p>
    </div>
  );
}

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

/** The sidebar list: pick a contributor to see only what they changed. */
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
    <div className="space-y-1 text-sm">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Changes by</span>
        {loading && (
          <span className="flex items-center gap-1">
            <LoaderCircle className="size-3 animate-spin" /> finding who changed what…
          </span>
        )}
        {selected && !loading && (
          <button type="button" className="ml-auto flex items-center gap-0.5 hover:text-foreground" onClick={() => onSelect(undefined)}>
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
              "flex items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-0.5 text-xs hover:bg-muted",
              selected === c.key && "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
              selected && selected !== c.key && "opacity-60",
            )}
          >
            {c.avatarUrl ? (
              <img src={c.avatarUrl} alt="" className="size-5 rounded-full" />
            ) : (
              <span className="flex size-5 items-center justify-center rounded-full bg-muted text-[0.625rem] font-medium text-muted-foreground uppercase">
                {c.name.slice(0, 1)}
              </span>
            )}
            {c.name}
            <span className={cn("text-muted-foreground", selected === c.key && "text-primary-foreground/70")}>{c.commits}</span>
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

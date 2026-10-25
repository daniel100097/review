import { Markdown } from "@/components/markdown";
import { ModelPicker, useAgentModel } from "@/components/question-thread";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { modelLabel, type AgentModel } from "@/lib/agents";
import type { RouterOutputs } from "@/lib/trpc";
import { cn, timeAgo } from "@/lib/utils";
import { CircleCheck, LoaderCircle, RotateCw, Sparkles, Square } from "lucide-react";

export type Walkthrough = NonNullable<RouterOutputs["walkthroughs"]["latest"]>;
export type WalkthroughGroup = NonNullable<Walkthrough["result"]>["groups"][number];

export const riskBadge: Record<WalkthroughGroup["risk"], string> = {
  high: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
  medium: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  low: "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400",
};

/** Above the diff: start a walkthrough, follow it while it runs, or read its summary. */
export function WalkthroughPanel({
  walkthrough,
  headSha,
  onStart,
  onCancel,
}: {
  walkthrough: Walkthrough | null | undefined;
  headSha: string;
  onStart: (model: AgentModel) => Promise<unknown>;
  onCancel: (id: number) => void;
}) {
  const [model, setModel] = useAgentModel("walkthroughModel", "haiku");
  const start = (
    <div className="flex items-center gap-2">
      <ModelPicker value={model} onChange={setModel} />
      <Button size="sm" variant={walkthrough ? "outline" : "default"} onClick={() => onStart(model)}>
        {walkthrough ? <RotateCw /> : <Sparkles />}
        {walkthrough ? "Analyze again" : "Analyze"}
      </Button>
    </div>
  );

  if (!walkthrough) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed px-4 py-3 text-sm">
        <Sparkles className="size-4 text-violet-500" />
        <span className="text-muted-foreground">Group the changes by purpose, with summaries, risk and a reading order.</span>
        <div className="ml-auto">{start}</div>
      </div>
    );
  }

  const stale = walkthrough.headSha !== headSha;
  return (
    <div className="space-y-2 rounded-lg border border-violet-500/30 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Sparkles className="size-4 text-violet-500" />
        <span className="font-medium text-foreground">Walkthrough</span>
        <span>
          {modelLabel(walkthrough.agent, walkthrough.model)} · {timeAgo(new Date(walkthrough.createdAt).toISOString())}
        </span>
        {stale && walkthrough.status === "done" && (
          <Badge variant="outline" title={`Made for ${walkthrough.headSha.slice(0, 8)}`}>
            earlier push
          </Badge>
        )}
        {walkthrough.status !== "running" && <div className="ml-auto">{start}</div>}
      </div>
      {walkthrough.status === "running" && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          <span>{walkthrough.activity ?? "Working"}…</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => onCancel(walkthrough.id)}>
            <Square /> Stop
          </Button>
        </div>
      )}
      {walkthrough.status === "failed" && <p className="whitespace-pre-wrap text-destructive">{walkthrough.error}</p>}
      {walkthrough.status === "cancelled" && <p className="text-muted-foreground">Stopped.</p>}
      {walkthrough.result && <Markdown>{walkthrough.result.summary}</Markdown>}
    </div>
  );
}

/** The sidebar's Groups view: groups in reading order with their files and how many are viewed. */
export function GroupList({
  groups,
  files,
  onSelectGroup,
  onSelectFile,
}: {
  groups: WalkthroughGroup[];
  /** The pull request's files that are shown, by path. Hidden files are listed but dimmed. */
  files: Map<string, { viewed: boolean }>;
  onSelectGroup: (index: number) => void;
  onSelectFile: (path: string) => void;
}) {
  return (
    <ol className="space-y-3 text-sm">
      {groups.map((group, i) => {
        const shown = group.files.filter(path => files.has(path));
        const viewed = shown.filter(path => files.get(path)!.viewed).length;
        return (
          <li key={i}>
            <button
              type="button"
              onClick={() => onSelectGroup(i)}
              className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-left hover:bg-muted"
            >
              <span className="w-4 shrink-0 text-right text-xs leading-5 text-muted-foreground">{i + 1}</span>
              <span className="min-w-0 flex-1 font-medium">{group.title}</span>
              {shown.length > 0 && viewed === shown.length ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-green-600" />
              ) : (
                <Badge variant="outline" className={cn("shrink-0", riskBadge[group.risk])}>
                  {group.risk}
                </Badge>
              )}
            </button>
            <ul className="mt-0.5 ml-7 space-y-0.5">
              {group.files.map(path => {
                const file = files.get(path);
                return (
                  <li key={path}>
                    <button
                      type="button"
                      disabled={!file}
                      title={file ? path : `${path} (hidden)`}
                      onClick={() => onSelectFile(path)}
                      className={cn(
                        "flex w-full items-center gap-1.5 rounded px-1 text-left font-mono text-xs hover:bg-muted disabled:opacity-40",
                        file?.viewed && "text-muted-foreground",
                      )}
                    >
                      <span className="min-w-0 truncate">{path.split("/").at(-1)}</span>
                      {file?.viewed && <CircleCheck className="size-3 shrink-0 text-green-600" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}

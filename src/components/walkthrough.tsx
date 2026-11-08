import { Markdown } from "@/components/markdown";
import { EarlierPush, ModelPicker, useAgentModel } from "@/components/question-thread";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { modelLabel, type AgentModel } from "@/lib/agents";
import type { RouterOutputs } from "@/lib/trpc";
import { cn, revealInScrollParent, timeAgo } from "@/lib/utils";
import { Circle, CircleAlert, CircleCheck, LoaderCircle, RotateCw, Sparkles, Square } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type Walkthrough = NonNullable<RouterOutputs["walkthroughs"]["latest"]>;
export type WalkthroughGroup = NonNullable<Walkthrough["result"]>["groups"][number];

/** Classes for `<Badge variant="outline">`: soft pills, used with the text "high risk" etc. */
export const riskBadge: Record<WalkthroughGroup["risk"], string> = {
  high: "rounded-md border-transparent font-normal bg-destructive/12 text-destructive",
  medium: "rounded-md border-transparent font-normal bg-warning/12 text-warning",
  low: "rounded-md border-transparent font-normal bg-success/12 text-success",
};

const riskDot: Record<WalkthroughGroup["risk"], string> = {
  high: "bg-destructive",
  medium: "bg-warning",
  low: "bg-success",
};

/**
 * Hands focus from the control that was just replaced (Analyze → Stop → the result's trigger) to `target`, so it
 * doesn't drop to `<body>`. Only when focus was on one of the walkthrough's controls (`data-walkthrough`).
 */
function useFocusHandoff(key: string) {
  const target = useRef<HTMLButtonElement>(null);
  const owned = useRef(false);
  useEffect(() => {
    const focusIn = (e: FocusEvent) => (owned.current = Boolean((e.target as Element).closest?.("[data-walkthrough]")));
    // Chrome also fires focusout when the focused element is removed, so only a target still in the page counts as
    // focus moving away (e.g. a click on the diff).
    const focusOut = (e: FocusEvent) =>
      setTimeout(() => {
        if ((e.target as Element).isConnected && document.activeElement === document.body) owned.current = false;
      });
    document.addEventListener("focusin", focusIn);
    document.addEventListener("focusout", focusOut);
    return () => {
      document.removeEventListener("focusin", focusIn);
      document.removeEventListener("focusout", focusOut);
    };
  }, []);
  useLayoutEffect(() => {
    if (owned.current && (!document.activeElement || document.activeElement === document.body)) {
      target.current?.focus({ preventScroll: true });
    }
  }, [key]);
  return target;
}

/** A toolbar control above the diff: start a walkthrough, follow it while it runs, or read its summary. */
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
  const [open, setOpen] = useState(false);
  const start = () => {
    setOpen(false);
    onStart(model);
  };
  const status = walkthrough === undefined ? undefined : (walkthrough?.status ?? null);
  const focusTarget = useFocusHandoff(status === "running" ? "running" : walkthrough ? "done" : "none");

  // Announce changes while the page is open, not the state found on load (undefined while loading).
  const [announce, setAnnounce] = useState(false);
  const lastStatus = useRef(status);
  useEffect(() => {
    if (lastStatus.current !== undefined && lastStatus.current !== status) setAnnounce(true);
    lastStatus.current = status;
  }, [status]);
  const groups = walkthrough?.result?.groups.length ?? 0;
  const groupCount = `${groups} ${groups === 1 ? "group" : "groups"}`;
  const announcement = !announce
    ? ""
    : status === "running"
      ? "Walkthrough running…"
      : status === "done"
        ? `Walkthrough ready: ${groupCount}`
        : status === "failed"
          ? "Walkthrough failed"
          : status === "cancelled"
            ? "Walkthrough stopped"
            : "";
  // Kept mounted (always the second child) so screen readers hear it change.
  const live = (
    <span role="status" className="sr-only">
      {announcement}
    </span>
  );

  if (walkthrough?.status === "running") {
    const activity = `${walkthrough.activity ?? "Working"}…`;
    const started = `${modelLabel(walkthrough.agent, walkthrough.model)} · started ${timeAgo(new Date(walkthrough.createdAt).toISOString())}`;
    return (
      <>
        <div className="inline-flex h-8 min-w-0 items-center gap-2 text-sm text-muted-foreground" title={`${activity}\n${started}`}>
          <LoaderCircle className="size-4 shrink-0 animate-spin text-ai" />
          <span className="max-w-48 min-w-0 truncate">{activity}</span>
          <span className="hidden shrink-0 text-xs sm:inline">{started}</span>
          <Button ref={focusTarget} data-walkthrough variant="ghost" size="xs" onClick={() => onCancel(walkthrough.id)}>
            <Square /> Stop
          </Button>
        </div>
        {live}
      </>
    );
  }

  if (!walkthrough) {
    return (
      <>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button ref={focusTarget} data-walkthrough variant="outline" size="sm">
              <Sparkles className="text-ai" /> Analyze
            </Button>
          </PopoverTrigger>
          <PopoverContent data-walkthrough aria-label="Analyze changes" align="end" className="space-y-3">
            <p className="text-muted-foreground">Group the changes by purpose, with summaries, risk and a reading order.</p>
            <div className="flex items-center gap-2">
              <ModelPicker value={model} onChange={setModel} />
              <Button size="sm" className="ml-auto" onClick={start}>
                <Sparkles /> Analyze
              </Button>
            </div>
          </PopoverContent>
        </Popover>
        {live}
      </>
    );
  }

  const stale = walkthrough.status === "done" && walkthrough.headSha !== headSha;
  const label =
    walkthrough.status === "failed"
      ? "Walkthrough failed"
      : walkthrough.status === "cancelled"
        ? "Walkthrough stopped"
        : `Walkthrough · ${groupCount}`;
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button ref={focusTarget} data-walkthrough variant="outline" size="sm" className="min-w-0">
            {walkthrough.status === "failed" ? <CircleAlert className="text-destructive" /> : <Sparkles className="text-ai" />}
            <span className="truncate">{label}</span>
            {stale && <EarlierPush />}
          </Button>
        </PopoverTrigger>
        <PopoverContent data-walkthrough aria-label="Walkthrough" align="end" className="w-[28rem] space-y-3 [overflow-wrap:anywhere]">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{modelLabel(walkthrough.agent, walkthrough.model)}</span>
            <span>{timeAgo(new Date(walkthrough.createdAt).toISOString())}</span>
            {stale && <EarlierPush title={`Made for ${walkthrough.headSha.slice(0, 8)}`} />}
          </div>
          {walkthrough.status === "failed" && <p className="whitespace-pre-wrap text-destructive">{walkthrough.error}</p>}
          {walkthrough.status === "cancelled" && <p className="text-muted-foreground">Stopped before it finished.</p>}
          {walkthrough.result && (
            <div className="max-h-80 overflow-y-auto overscroll-contain">
              <Markdown>{walkthrough.result.summary}</Markdown>
            </div>
          )}
          <div className="flex items-center gap-2 border-t pt-3">
            <ModelPicker value={model} onChange={setModel} />
            <Button variant="outline" size="sm" className="ml-auto" onClick={start}>
              <RotateCw /> Analyze again
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {live}
    </>
  );
}

/** The sidebar's Groups view: groups in reading order with their files and how many are viewed. */
export function GroupList({
  groups,
  files,
  current,
  onSelectGroup,
  onSelectFile,
}: {
  groups: WalkthroughGroup[];
  /** The pull request's files that are shown, by path. Hidden files are listed but dimmed. */
  files: Map<string, { viewed: boolean }>;
  /** The file at the top of the diff, highlighted and kept in view. */
  current?: string;
  onSelectGroup: (index: number) => void;
  onSelectFile: (path: string) => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>('[aria-current="true"]');
    if (row) revealInScrollParent(row);
  }, [current]);

  return (
    <ol ref={list} className="space-y-2 text-[13px]">
      {groups.map((group, i) => {
        const shown = group.files.filter(path => files.has(path));
        const viewed = shown.filter(path => files.get(path)!.viewed).length;
        const risk = `${group.risk[0]!.toUpperCase()}${group.risk.slice(1)} risk`;
        return (
          <li key={i}>
            <button
              type="button"
              onClick={() => onSelectGroup(i)}
              className="flex min-h-8 w-full items-start gap-2 rounded-md px-1.5 py-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-9"
            >
              <span className="w-4 shrink-0 text-right leading-5 text-muted-foreground tabular-nums">{i + 1}</span>
              <span className="min-w-0 flex-1 leading-5 font-medium [overflow-wrap:anywhere]">{group.title}</span>
              {/* A 16px box, so the dot lines up with the check that replaces it. */}
              <span className="flex h-5 w-4 shrink-0 items-center justify-center">
                {shown.length > 0 && viewed === shown.length ? (
                  <CircleCheck aria-label="All viewed" className="size-4 text-success" />
                ) : (
                  <span title={risk} className={cn("size-1.5 rounded-full", riskDot[group.risk])}>
                    <span className="sr-only">{risk}</span>
                  </span>
                )}
              </span>
            </button>
            <ul className="ml-6">
              {group.files.map(path => {
                const file = files.get(path);
                return (
                  <li key={path}>
                    <button
                      type="button"
                      disabled={!file}
                      title={file ? path : `${path} (hidden)`}
                      aria-current={path === current ? "true" : undefined}
                      onClick={() => onSelectFile(path)}
                      className={cn(
                        "flex min-h-7 w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left leading-5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 pointer-coarse:min-h-9",
                        file?.viewed && "text-muted-foreground",
                        path === current && "bg-accent font-medium",
                      )}
                    >
                      {file?.viewed ? (
                        <CircleCheck aria-label="Viewed" className="size-3.5 shrink-0 text-success" />
                      ) : (
                        <Circle className="size-3.5 shrink-0 text-muted-foreground/60" />
                      )}
                      <span className="min-w-0 truncate">{path.split("/").at(-1)}</span>
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

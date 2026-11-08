import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CircleStop, Download, FileText, LoaderCircle, RefreshCw, Sparkles, TriangleAlert, X } from "lucide-react";
import { QueryError } from "@/components/page";
import { EarlierPush, ModelPicker, useAgentModel } from "@/components/question-thread";
import { FlowmarkViewer } from "@/components/flowmark-viewer";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { queryClient, trpc, type RouterOutputs } from "@/lib/trpc";
import { modelLabel } from "@/lib/agents";
import type { flowmarkModes } from "@/lib/flowmark";
import { cn, timeAgo } from "@/lib/utils";

type Mode = (typeof flowmarkModes)[number];
type Review = NonNullable<RouterOutputs["flowmark"]["latest"]>;
/** A saved review: the latest one, or the previous finished one (without its sources) while a newer run isn't done. */
type Saved = Review | NonNullable<Review["previous"]>;
type Input = { sourceId: number; repo: string; number: number };

/** "walkthrough" is the stored value; the label avoids clashing with the Files tab's Analyze walkthrough. */
const modes: Record<Mode, { label: string; hint: string }> = {
  changes: { label: "Before / after", hint: "Explains the base and head commits side by side, with Changes, Before and After views." },
  walkthrough: { label: "Current flow", hint: "Explains how the code works at the head commit." },
};

/** Keep controls and the running request alive across PR tab switches. */
export function useFlowmark(input: Input, enabled: boolean) {
  const latest = useQuery({
    ...trpc.flowmark.latest.queryOptions(input), enabled,
    refetchInterval: query => query.state.data?.status === "running" ? 1500 : false,
  });
  const [mode, setMode] = useState<Mode>("changes");
  const [request, setRequest] = useState("");
  const [model, setModel] = useAgentModel("flowmarkModel", "sonnet");
  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.flowmark.latest.queryKey(input) });
  const start = useMutation(trpc.flowmark.start.mutationOptions({ onSuccess: refresh }));
  const cancel = useMutation(trpc.flowmark.cancel.mutationOptions({ onSuccess: refresh }));
  // A newly opened tab must recheck a cached completed review for work started on another device.
  const wasEnabled = useRef(false);
  useEffect(() => {
    if (enabled && !wasEnabled.current) void refresh();
    wasEnabled.current = enabled;
  }, [enabled]);
  return { latest, mode, setMode, request, setRequest, model, setModel, start, cancel };
}
type Flowmark = ReturnType<typeof useFlowmark>;

function download(source: string, filename: string) {
  const url = URL.createObjectURL(new Blob([source], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Clicks into the review frame don't reach the page, so popovers close when the frame takes focus. */
function useDismissOnFrameFocus(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const blur = () => requestAnimationFrame(() => { if (document.activeElement instanceof HTMLIFrameElement) close(); });
    window.addEventListener("blur", blur);
    return () => window.removeEventListener("blur", blur);
  }, [open]);
}

export function FlowmarkPanel({ flowmark: f, input, baseSha, headSha, active = true }: {
  flowmark: Flowmark;
  input: Input;
  baseSha: string;
  headSha: string;
  /** The tab is showing; the viewer's keyboard shortcuts only apply then. */
  active?: boolean;
}) {
  const latest = f.latest.data;
  // While a newer run is going, failed or was stopped, the last finished review stays on screen.
  const review = latest?.status === "done" ? latest : latest?.previous;
  const running = f.start.isPending || latest?.status === "running";
  const stale = review && (review.headSha !== headSha || review.baseSha !== baseSha);
  const [regenerating, setRegenerating] = useState(false);
  useDismissOnFrameFocus(regenerating, () => setRegenerating(false));
  const [dismissed, dismiss] = useDismissed(latest?.id);
  const start = () => f.start.mutate(
    { ...input, baseSha, headSha, mode: f.mode, request: f.request, agent: f.model.agent, model: f.model.model },
    { onSuccess: () => setRegenerating(false) },
  );
  const run = running ? {
    mode: modes[latest?.status === "running" ? latest.mode : f.mode].label,
    model: latest?.status === "running" ? modelLabel(latest.agent, latest.model) : modelLabel(f.model.agent, f.model.model),
    activity: `${latest?.status === "running" ? latest.activity ?? "Working" : "Starting"}…`,
    since: latest?.status === "running" ? latest.createdAt : undefined,
    stop: latest?.status === "running" ? () => f.cancel.mutate({ ...input, id: latest.id }) : undefined,
  } : undefined;
  const error = f.latest.error ?? f.cancel.error;
  const ended = latest !== review && !dismissed && (latest?.status === "failed" || latest?.status === "cancelled") ? latest : undefined;

  if (f.latest.isPending) {
    return <Skeleton role="status" aria-label="Loading Flowmark review" className="h-[60dvh] w-full rounded-lg" />;
  }
  return (
    <section aria-label="Flowmark review" className="min-w-0 space-y-3">
      {error && <QueryError error={error} />}
      {review?.result ? (
        <>
          <div className="flex min-h-8 min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <ReviewMeta review={review} />
            {stale && <EarlierPush title="This explanation is for an earlier PR revision. Regenerate to analyze the current code." />}
            <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1">
              {run && (
                <p role="status" title={`Regenerating ${run.mode} with ${run.model}: ${run.activity}`}
                  className="flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-md bg-muted pl-2 text-xs text-muted-foreground pointer-coarse:h-9">
                  <LoaderCircle aria-hidden className="size-3.5 shrink-0 animate-spin" />
                  <span className={cn("min-w-0 truncate", !run.stop && "pr-2")}>Regenerating · {run.activity}</span>
                  {run.stop && (
                    <Button size="xs" variant="ghost" onClick={run.stop} disabled={f.cancel.isPending} className="hover:bg-background">
                      <CircleStop /> Stop
                    </Button>
                  )}
                </p>
              )}
              <div className="flex shrink-0 items-center gap-1">
                <ReportPopover review={review} />
                {/* A previous review comes without its sources (see the server), so it has no downloads. */}
                {latest?.status === "done" && <Downloads review={latest} number={input.number} />}
                <Popover open={regenerating} onOpenChange={setRegenerating}>
                  <PopoverTrigger asChild>
                    <Button size="sm" variant={stale ? "default" : "outline"} disabled={running}>
                      <RefreshCw /> Regenerate
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" aria-label="Regenerate Flowmark review" className="w-[min(24rem,calc(100vw-1rem))]">
                    <GenerateForm flowmark={f} running={running} label="Regenerate" onStart={start} />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>
          {ended?.status === "failed" && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 py-1 pr-1 pl-3 text-sm text-destructive">
              <details className="min-w-0 flex-1 py-1">
                <summary className="cursor-pointer">
                  Regenerating failed. Showing the previous review. <Ago date={ended.createdAt} className="text-xs opacity-80" />
                </summary>
                <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{ended.error}</p>
              </details>
              <DismissButton onClick={dismiss} />
            </div>
          )}
          {ended?.status === "cancelled" && (
            <div role="status" className="flex items-center gap-1 text-xs text-muted-foreground">
              <p>Regenerating stopped. Showing the previous review. <Ago date={ended.createdAt} className="opacity-80" /></p>
              <DismissButton onClick={dismiss} />
            </div>
          )}
          <FlowmarkViewer model={review.result} active={active} />
        </>
      ) : run ? (
        <RunProgress run={run} stopping={f.cancel.isPending} />
      ) : (
        <div className="mx-auto max-w-md space-y-5 py-8 sm:py-12">
          <div className="space-y-1.5 text-center">
            <Sparkles aria-hidden className="mx-auto size-5 text-ai" />
            <h2 className="text-base font-semibold tracking-tight">Explain this PR’s flow</h2>
            <p className="text-sm text-muted-foreground">
              Flowmark writes a checked, layered explanation: the card and risks first, then the flow at L1–L3.
            </p>
          </div>
          {latest?.status === "failed" && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm whitespace-pre-wrap text-destructive [overflow-wrap:anywhere]">
              {latest.error}
            </p>
          )}
          {latest?.status === "cancelled" && <p role="status" className="text-center text-sm text-muted-foreground">Generation stopped.</p>}
          <GenerateForm flowmark={f} running={running} label={latest ? "Try again" : "Generate for this PR"} onStart={start} />
        </div>
      )}
    </section>
  );
}

/** Hides a failed or stopped run's notice for good (per run, on this browser). */
function useDismissed(id: number | undefined) {
  const key = `flowmarkDismissed:${id}`;
  const [dismissed, setDismissed] = useState<string>();
  const stored = useMemo(() => {
    try { return localStorage.getItem(key) !== null; } catch { return false; }
  }, [key]);
  const dismiss = () => {
    setDismissed(key);
    try { localStorage.setItem(key, "1"); } catch {}
  };
  return [stored || dismissed === key, dismiss] as const;
}

function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="icon-sm" variant="ghost" aria-label="Dismiss" title="Dismiss" onClick={onClick} className="size-7 shrink-0 text-current pointer-coarse:size-9">
      <X />
    </Button>
  );
}

function Ago({ date, className }: { date: string; className?: string }) {
  const iso = new Date(date).toISOString();
  return <time dateTime={iso} title={new Date(date).toLocaleString()} className={cn("whitespace-nowrap", className)}>{timeAgo(iso)}</time>;
}

type Run = { mode: string; model: string; activity: string; since?: string; stop?: () => void };

/** A first run, with nothing to show yet: what is being generated, the current step and the elapsed time. */
function RunProgress({ run, stopping }: { run: Run; stopping: boolean }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = run.since ? Math.max(0, Math.floor((now - new Date(run.since).getTime()) / 1000)) : 0;
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-12 text-center sm:py-16">
      <LoaderCircle aria-hidden className="size-5 animate-spin text-muted-foreground" />
      <h2 className="text-base font-semibold tracking-tight">Generating {run.mode} with {run.model}</h2>
      <p role="status" title={run.activity} className="max-w-full truncate text-sm text-muted-foreground">{run.activity}</p>
      <p className="text-xs text-muted-foreground tabular-nums">
        {run.since && `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} elapsed · `}runs take up to 10 minutes
      </p>
      {run.stop && (
        <Button size="sm" variant="outline" onClick={run.stop} disabled={stopping}>
          <CircleStop /> Stop
        </Button>
      )}
    </div>
  );
}

function GenerateForm({ flowmark: f, running, label, onStart }: { flowmark: Flowmark; running: boolean; label: string; onStart: () => void }) {
  return (
    <form className="min-w-0 space-y-3" onSubmit={e => { e.preventDefault(); onStart(); }}>
      <div className="flex flex-wrap gap-2">
        <Select value={f.mode} onValueChange={mode => f.setMode(mode as Mode)} disabled={running}>
          <SelectTrigger size="sm" aria-label="Review mode" className="min-w-36 flex-1 pointer-coarse:h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(modes) as Mode[]).map(mode => (
              <SelectItem key={mode} value={mode}>{modes[mode].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ModelPicker value={f.model} onChange={f.setModel} />
      </div>
      <p className="text-xs text-muted-foreground">{modes[f.mode].hint}</p>
      <details className="group" open={Boolean(f.request) || undefined}>
        <summary className="cursor-pointer text-[13px] text-muted-foreground hover:text-foreground">Focus (optional)</summary>
        <Label htmlFor="flowmark-request" className="mt-2 mb-1.5 text-[13px]">What should the review explain?</Label>
        <Textarea
          id="flowmark-request"
          value={f.request}
          onChange={e => f.setRequest(e.target.value)}
          maxLength={4000}
          disabled={running}
          placeholder="For example: explain the billing flow, its side effects, and what changed."
          className="min-h-20 text-base md:text-sm"
        />
      </details>
      {f.start.error && <p role="alert" className="text-sm whitespace-pre-wrap text-destructive [overflow-wrap:anywhere]">{f.start.error.message}</p>}
      <Button type="submit" className="w-full" disabled={running}>
        {running ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
        {running ? "Generating…" : label}
      </Button>
      <p className="text-xs text-muted-foreground">
        Uses your installed AI CLI with read-only source tools. Reviews are saved for this PR and commit pair, on every device.
      </p>
    </form>
  );
}

function ReviewMeta({ review }: { review: Saved }) {
  // Each item brings its own leading "·"; the row is pulled left and clipped, so a wrapped line never starts with one.
  return (
    <div className="min-w-0 overflow-hidden text-xs text-muted-foreground">
      <div className="-ml-3 flex flex-wrap items-center gap-y-0.5">
        {[
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            <Sparkles aria-hidden className="size-3.5 text-ai" /> {modes[review.mode].label}
          </span>,
          modelLabel(review.agent, review.model),
          <code className="font-mono tabular-nums" title={`Base ${review.baseSha}, head ${review.headSha}`}>
            {review.baseSha.slice(0, 7)} → {review.headSha.slice(0, 7)}
          </code>,
          <Ago date={review.createdAt} />,
        ].map((item, i) => (
          <span key={i} className="inline-flex min-w-0 max-w-full items-center">
            <span aria-hidden className="w-3 shrink-0 text-center">·</span>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

const reportSections = [
  ["omitted", "Left out", "left out"],
  ["specGaps", "Language gaps", "gaps"],
  ["unverifiedRefs", "Unverified references", "unverified"],
  ["retainedWarnings", "Retained checker findings", "findings"],
] as const;

/** The writer's report and the disclaimer, behind one line of counts. */
function ReportPopover({ review }: { review: Saved }) {
  const [open, setOpen] = useState(false);
  useDismissOnFrameFocus(open, () => setOpen(false));
  const result = review.result!;
  const report = result.writerReport;
  const counts = reportSections.map(([key, , short]) => [short, report?.[key].length ?? 0] as const).filter(([, n]) => n > 0);
  const attention = (report?.unverifiedRefs.length ?? 0) + (report?.retainedWarnings.length ?? 0) > 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="xs" variant="ghost" className={cn(attention && "text-warning")}
          aria-label={`Writer report${counts.length ? `: ${counts.map(([label, n]) => `${n} ${label}`).join(", ")}` : ""}`}>
          {attention ? <TriangleAlert /> : <FileText />} Report
          {counts.length > 0 && (
            <span className="hidden font-normal text-muted-foreground tabular-nums md:inline">
              · {counts.map(([label, n]) => `${n} ${label}`).join(" · ")}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-label="Writer report" className="w-[min(32rem,calc(100vw-1rem))] space-y-3 text-[13px] [overflow-wrap:anywhere]">
        <p className="text-xs text-muted-foreground">
          AI-written explanation. {result.typechecked ? "Flowmark format and prelude types checked." : "Flowmark format checked."} Code
          references still need human verification.
        </p>
        {review.request && <p><span className="font-medium">Focus:</span> {review.request}</p>}
        {report && <p><span className="font-medium">Capability:</span> {report.capability}</p>}
        {report && reportSections.filter(([key]) => report[key].length).map(([key, label]) => (
          <div key={key}>
            <p className={cn("font-medium", (key === "unverifiedRefs" || key === "retainedWarnings") && "text-warning")}>
              {label} <span className="font-normal text-muted-foreground tabular-nums">{report[key].length}</span>
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">{report[key].map((item, i) => <li key={i}>{item}</li>)}</ul>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function Downloads({ review, number }: { review: Review; number: number }) {
  const [open, setOpen] = useState(false);
  useDismissOnFrameFocus(open, () => setOpen(false));
  const after = () => download(review.headSource!, `pr-${number}-after.review.ts`);
  if (!review.headSource) return null;
  if (!review.baseSource) {
    return (
      <Button size="icon-sm" variant="ghost" aria-label="Download review" title="Download review (.review.ts)" onClick={after}>
        <Download />
      </Button>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label="Download" title="Download .review.ts documents">
          <Download />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-label="Download" className="flex w-52 flex-col p-1">
        <Button variant="ghost" size="sm" className="justify-start" onClick={() => { after(); setOpen(false); }}>Download review (after)</Button>
        <Button variant="ghost" size="sm" className="justify-start" onClick={() => { download(review.baseSource!, `pr-${number}-before.review.ts`); setOpen(false); }}>
          Download before
        </Button>
      </PopoverContent>
    </Popover>
  );
}

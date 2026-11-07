import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, LoaderCircle, Sparkles, Square } from "lucide-react";
import { ModelPicker, useAgentModel } from "@/components/question-thread";
import { FlowmarkViewer } from "@/components/flowmark-viewer";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { queryClient, trpc } from "@/lib/trpc";
import { modelLabel } from "@/lib/agents";

/** Keep controls and the running request alive across PR tab switches. */
export function useFlowmark(input: { sourceId: number; repo: string; number: number }, enabled: boolean) {
  const latest = useQuery({
    ...trpc.flowmark.latest.queryOptions(input), enabled,
    refetchInterval: query => query.state.data?.status === "running" ? 1500 : false,
  });
  const [mode, setMode] = useState<"changes" | "walkthrough">("changes");
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

function download(source: string, filename: string) {
  const url = URL.createObjectURL(new Blob([source], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function FlowmarkPanel({ flowmark: f, input, baseSha, headSha }: {
  flowmark: ReturnType<typeof useFlowmark>;
  input: { sourceId: number; repo: string; number: number };
  baseSha: string; headSha: string;
}) {
  const review = f.latest.data;
  const running = f.start.isPending || review?.status === "running";
  const stale = review && (review.headSha !== headSha || review.baseSha !== baseSha);
  return <section aria-label="Flowmark review" className="min-w-0 space-y-4">
    <div className="space-y-3 rounded-md border bg-card p-3">
      <div>
        <h2 className="font-semibold">Flowmark</h2>
        <p className="text-sm text-muted-foreground">Generate an explanation of this PR. Start with the card and risks, then explore the flow at L1–L3.</p>
      </div>
      <div className="flex min-w-0 flex-wrap items-end gap-3">
        <div className="min-w-0 space-y-1">
          <Label htmlFor="flowmark-mode">Review mode</Label>
          <select id="flowmark-mode" value={f.mode} onChange={e => f.setMode(e.target.value as typeof f.mode)} disabled={running}
            className="h-9 max-w-full rounded-md border bg-background px-2 text-base md:text-sm">
            <option value="changes">Changes — Before / After</option>
            <option value="walkthrough">Walkthrough — current flow</option>
          </select>
        </div>
        <ModelPicker value={f.model} onChange={f.setModel} />
        <Button disabled={running} onClick={() => f.start.mutate({ ...input, baseSha, headSha, mode: f.mode, request: f.request, agent: f.model.agent, model: f.model.model })}>
          {running ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
          {running ? "Generating…" : review ? "Generate again" : "Generate for this PR"}
        </Button>
      </div>
      <details>
        <summary className="cursor-pointer text-sm text-muted-foreground">Focus this review (optional)</summary>
        <Label htmlFor="flowmark-request" className="mt-3 mb-2">What should the walkthrough explain?</Label>
        <Textarea id="flowmark-request" value={f.request} onChange={e => f.setRequest(e.target.value)} maxLength={4000}
          disabled={running} placeholder="For example: explain the billing flow, its side effects, and what changed." className="min-h-24" />
      </details>
      <p className="text-xs text-muted-foreground">Uses your installed AI CLI. Reviews are saved for this PR and its commit pair, available across devices.</p>
    </div>
    {f.latest.isPending && <p role="status" className="text-sm text-muted-foreground">Loading Flowmark review…</p>}
    {(f.latest.error || f.start.error || f.cancel.error) && <p role="alert" className="text-sm text-destructive">{(f.latest.error || f.start.error || f.cancel.error)?.message}</p>}
    {review && <>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{review.mode === "changes" ? "Changes" : "Walkthrough"} · {modelLabel(review.agent, review.model)}</span>
        <code title={`Base ${review.baseSha}, head ${review.headSha}`}>{review.baseSha.slice(0, 8)} → {review.headSha.slice(0, 8)}</code>
        {stale && <Badge variant="outline">Earlier PR revision</Badge>}
        {review.status === "running" && <><span role="status">{review.activity ?? "Working"}…</span>
          <Button size="sm" variant="ghost" disabled={f.cancel.isPending} onClick={() => f.cancel.mutate({ ...input, id: review.id })}><Square /> Stop</Button></>}
        {review.headSource && <Button size="sm" variant="outline" onClick={() => download(review.headSource!, `pr-${input.number}-after.review.ts`)}><Download /> Download review</Button>}
        {review.baseSource && <Button size="sm" variant="outline" onClick={() => download(review.baseSource!, `pr-${input.number}-before.review.ts`)}><Download /> Download before</Button>}
      </div>
      {stale && <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">This explanation is for an earlier PR revision. Generate again to analyze the current code.</p>}
      {review.status === "failed" && <p role="alert" className="text-sm whitespace-pre-wrap text-destructive">{review.error}</p>}
      {review.status === "cancelled" && <p role="status" className="text-sm text-muted-foreground">Generation stopped.</p>}
      {review.result?.writerReport && <div className="space-y-2 rounded-md border p-3 text-sm [overflow-wrap:anywhere]">
        <p><span className="font-medium">Capability:</span> {review.result.writerReport.capability}</p>
        {([ ["Left out", review.result.writerReport.omitted], ["Language gaps", review.result.writerReport.specGaps], ["Unverified references", review.result.writerReport.unverifiedRefs], ["Retained checker findings", review.result.writerReport.retainedWarnings] ] as const).filter(([, items]) => items.length).map(([label, items]) =>
          <div key={label}><p className="font-medium">{label}</p><ul className="list-disc pl-5">{items.map((item, i) => <li key={i}>{item}</li>)}</ul></div>)}
      </div>}
      {review.result && <><p className="text-xs text-muted-foreground">AI-written explanation. {review.result.typechecked ? "Flowmark format and prelude types checked." : "Flowmark format checked."} Code references still need human verification.</p>
        <FlowmarkViewer model={review.result} /></>}
    </>}
  </section>;
}

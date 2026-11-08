import { ModelPicker, useAgentModel } from "@/components/question-thread";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { compileFilterRules, exampleFilterRules, filterPrompt, parseFilterRules, type FilterRules } from "@/lib/filter-rules";
import { changeView, parse, type File } from "@/lib/parsed-file";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import type { useReviewFilters } from "@/lib/review-filters";
import { useMutation } from "@tanstack/react-query";
import { Copy, LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

/** Keep the PR's editor alive when mobile controls move into or out of the drawer. */
export function useFilterRules(filters: ReturnType<typeof useReviewFilters>) {
  const { rules, rulesEnabled: enabled, error, setRules: save } = filters;
  const compiled = useMemo(
    () => enabled && rules ? compileFilterRules(rules) : undefined,
    [enabled, rules],
  );
  const [request, setRequest] = useState("");
  const appliedText = rules ? JSON.stringify(rules, null, 2) : "";
  const [draft, setDraft] = useState(appliedText);
  const [notice, setNotice] = useState("");
  const [editorError, setError] = useState("");
  const ownRuleUpdate = useRef<string | undefined>(undefined);
  const [model, setModel] = useAgentModel("filterRuleModel", "sonnet");
  const generated = useMutation(trpc.filters.generate.mutationOptions());
  // Back/forward and reset can replace the applied rules without remounting the editor.
  useEffect(() => {
    setDraft(appliedText);
    if (ownRuleUpdate.current !== appliedText) {
      setNotice("");
      setError("");
    }
    ownRuleUpdate.current = undefined;
  }, [appliedText]);
  return {
    rules, enabled, error, compiled, save,
    editor: { request, setRequest, draft, setDraft, notice, setNotice, error: editorError, setError, ownRuleUpdate, model, setModel, generated },
  };
}

export function FilterRulesPanel({ filters, files, input, pull }: {
  filters: ReturnType<typeof useFilterRules>;
  files: File[];
  input: { sourceId: number; repo: string; number: number };
  pull: { title: string; body: string };
}) {
  const id = useId();
  const { request, setRequest, draft, setDraft, notice, setNotice, error, setError, ownRuleUpdate, model, setModel, generated } = filters.editor;
  const preview = useMemo(() => {
    if (!draft.trim()) return undefined;
    try {
      const rules = parseFilterRules(draft);
      const compiled = compileFilterRules(rules);
      let hiddenFiles = 0;
      let hiddenLines = 0;
      for (const file of files) {
        const parsed = parse(file);
        const wholeFile = compiled.hidesFile(file);
        const view = changeView(parsed, false, compiled);
        if (wholeFile || view.allHidden) hiddenFiles++;
        hiddenLines += wholeFile ? parsed.additions + parsed.deletions : view.hiddenCount;
      }
      return { rules, hiddenFiles, hiddenLines };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [draft, files]);
  const edit = (text: string) => {
    setDraft(text);
    setNotice("");
    setError("");
  };
  const save = (rules: FilterRules | undefined, enabled: boolean) => {
    try {
      ownRuleUpdate.current = rules ? JSON.stringify(rules, null, 2) : "";
      filters.save(rules, enabled);
      setError("");
      setNotice(rules ? (enabled ? "Custom filters applied." : "Custom filters paused.") : "Custom filters cleared.");
      return true;
    } catch {
      ownRuleUpdate.current = undefined;
      setError("Could not update the filter URL. Try a smaller rule set.");
      return false;
    }
  };
  const copy = async (text: string, message: string) => {
    try {
      if (navigator.clipboard) await navigator.clipboard.writeText(text);
      else {
        // The Clipboard API requires HTTPS; local VPN addresses commonly use HTTP.
        const field = document.createElement("textarea");
        const focused = document.activeElement;
        const container = focused instanceof Element ? focused.closest('[role="dialog"]') : null;
        field.value = text;
        field.style.cssText = "position:fixed;opacity:0;pointer-events:none";
        (container ?? document.body).append(field);
        field.select();
        try {
          if (!document.execCommand("copy")) throw new Error("Clipboard unavailable");
        } finally {
          field.remove();
          if (focused instanceof HTMLElement) focused.focus();
        }
      }
      setError("");
      setNotice(message);
    } catch {
      setError("Could not access the clipboard. Check your browser's clipboard permissions.");
    }
  };
  const generate = async () => {
    setError("");
    setNotice("");
    try {
      const rules = await generated.mutateAsync({ ...input, request, agent: model.agent, model: model.model });
      setDraft(JSON.stringify(rules, null, 2));
      setNotice(rules.rules.length ? "Analysis complete. Check the proposed exclusions, then apply." : "No changes were confidently identified for hiding. Your applied filters are unchanged.");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // The body of the "Custom filters" sheet: the sheet supplies the title, close button, padding and scrolling.
  return (
    <div className="flex min-h-full min-w-0 flex-col gap-6 [overflow-wrap:anywhere]">
      <p className="text-[13px] text-muted-foreground">
        Describe what matters to you; AI reads this pull request and proposes changes to hide. Applied rules are part of the URL, so a copied link keeps this view.
      </p>
      <div className="min-w-0 space-y-2">
        <Label htmlFor={`${id}-request`}>Describe what to hide</Label>
        <Textarea id={`${id}-request`} value={request} onChange={e => setRequest(e.target.value)} maxLength={4000}
          placeholder="e.g. Hide edits that only wrap the same values in a requestBody object."
          className="min-h-24 min-w-0 resize-y pointer-coarse:text-base" disabled={generated.isPending} />
        <div className="flex flex-wrap items-center gap-2">
          <ModelPicker value={model} onChange={setModel} />
          <Button size="sm" disabled={!request.trim() || generated.isPending} onClick={generate} title="Analyze this PR with your installed AI CLI">
            {generated.isPending ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
            {generated.isPending ? "Analyzing diff…" : "Generate"}
          </Button>
          <Button variant="ghost" size="xs" className="text-muted-foreground" disabled={!request.trim()} title="Copies the instruction and this PR’s diff for use in another chat"
            onClick={() => copy(filterPrompt(request, { ...pull, files }), "Prompt and diff copied. Paste them into your chat, then paste the returned rules here.")}>
            <Copy /> Copy prompt for chat
          </Button>
        </div>
      </div>
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <Label htmlFor={`${id}-rules`}>Rules (JSON)</Label>
          <div className="flex gap-1">
            <Button variant="ghost" size="xs" className="text-muted-foreground" disabled={generated.isPending} onClick={() => edit(exampleFilterRules)}>Use example</Button>
            <Button variant="ghost" size="xs" className="text-muted-foreground" disabled={!preview?.rules} onClick={() => copy(JSON.stringify(preview!.rules, null, 2), "Rules copied.")}><Copy /> Copy rules</Button>
          </div>
        </div>
        <Textarea id={`${id}-rules`} value={draft} onChange={e => edit(e.target.value)} placeholder={'{ "version": 1, "rules": [] }'}
          maxLength={100000} spellCheck={false} disabled={generated.isPending} aria-invalid={Boolean(preview?.error)}
          aria-describedby={preview?.error ? `${id}-error` : undefined} className="min-h-40 max-h-96 min-w-0 resize-y font-mono pointer-fine:text-xs pointer-coarse:text-base" />
        {/* Live regions here stay mounted (sr-only while empty) so screen readers announce their text changes. */}
        <p id={`${id}-error`} role="alert" className={cn("text-[13px] whitespace-pre-wrap text-destructive", !preview?.error && "sr-only")}>{preview?.error}</p>
        <details className="text-xs text-muted-foreground">
          <summary className="w-fit cursor-pointer hover:text-foreground">Rule format</summary>
          <div className="mt-1.5 space-y-1.5">
            <p>Rules can select exact changes with a reason, or use reusable paths and line patterns. Paths match from the repository root: * stays within a directory, ** crosses directories, and **/ also matches the root. Line patterns match the full trimmed line; * matches any text and ? one character. Both sides of a replacement stay together.</p>
            <p>AI selections match exact changes and stop matching when that file’s patch changes. Pause filters to see everything they hide.</p>
          </div>
        </details>
      </div>
      {/* sr-only (out of flow, so no gap) until there is a preview, keeping its count's live region mounted. */}
      <div className={cn("flex min-w-0 flex-col gap-2", !preview?.rules && "sr-only")}>
        {preview?.rules && (
          <>
            <h3 className="text-sm font-medium">Preview</h3>
            {preview.rules.summary && <p className="text-[13px] whitespace-pre-wrap">{preview.rules.summary}</p>}
            {preview.rules.rules.length > 0 && (
              <ul className="space-y-1.5 text-[13px]">
                {preview.rules.rules.map((rule, i) => (
                  <li key={i}><span className="font-medium">{rule.name}</span>{rule.reason && <span className="text-muted-foreground"> — {rule.reason}</span>}</li>
                ))}
              </ul>
            )}
          </>
        )}
        <p className={cn("text-[13px] tabular-nums", preview?.hiddenFiles || preview?.hiddenLines ? "text-warning" : "text-muted-foreground")} role="status">
          {preview?.rules && `Preview: ${preview.hiddenFiles} of ${files.length} files and ${preview.hiddenLines} changed lines would be hidden by these rules.`}
        </p>
      </div>
      {/* Pinned to the bottom of the sheet's scroll area. Sticky insets count from inside its p-4, so -bottom-4 and -mx-4 make the bar flush. */}
      <div className="sticky -bottom-4 -mx-4 mt-auto -mb-4 flex flex-col gap-2 border-t bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <p role="alert" className={cn("text-[13px] text-destructive", !(error || filters.error) && "sr-only")}>{error || filters.error}</p>
        <p role="status" className={cn("text-xs text-muted-foreground", !notice && "sr-only")}>{notice}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!preview?.rules?.rules.length || generated.isPending} onClick={() => preview?.rules && save(preview.rules, true)}>Apply rules</Button>
          {filters.rules && (
            // A plain label, not aria-pressed: "Pause filters, pressed" would read backwards while they run.
            <Button variant="outline" size="sm" onClick={() => save(filters.rules, !filters.enabled)}>
              {filters.enabled ? "Pause filters" : "Enable filters"}
            </Button>
          )}
          <Button variant="ghost" size="sm" className="ml-auto" disabled={generated.isPending || (!filters.rules && !draft)} onClick={() => { if (save(undefined, false)) setDraft(""); }}>Clear rules</Button>
        </div>
      </div>
    </div>
  );
}

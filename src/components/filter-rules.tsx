import { ModelPicker, useAgentModel } from "@/components/question-thread";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { compileFilterRules, exampleFilterRules, filterPrompt, parseFilterRules, type FilterRules } from "@/lib/filter-rules";
import { changeView, parse, type File } from "@/lib/parsed-file";
import { trpc } from "@/lib/trpc";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Copy, Filter, LoaderCircle, Sparkles } from "lucide-react";
import { useId, useMemo, useState } from "react";

function readSaved(key: string, inheritedKey?: string) {
  try {
    const stored = localStorage.getItem(key) ?? (inheritedKey ? localStorage.getItem(inheritedKey) : null);
    if (stored) {
      const value = JSON.parse(stored);
      const parsed = parseFilterRules(JSON.stringify(value.rules));
      const rules = parsed.rules.length ? parsed : undefined;
      return { key, rules, enabled: Boolean(rules && value.enabled === true), error: "" };
    }
    return { key, rules: undefined, enabled: false, error: "" };
  } catch {
    return { key, rules: undefined, enabled: false, error: "Saved custom filters could not be loaded. Paste the rules again to restore them." };
  }
}

/** Each PR remembers its filters; existing repository rules are inherited until it saves its own. */
export function useFilterRules(key: string, inheritedKey?: string) {
  const [saved, setSaved] = useState(() => readSaved(key, inheritedKey));
  if (saved.key !== key) setSaved(readSaved(key, inheritedKey));
  const current = saved.key === key ? saved : readSaved(key, inheritedKey);
  const compiled = useMemo(
    () => current.enabled && current.rules ? compileFilterRules(current.rules) : undefined,
    [current.enabled, current.rules],
  );
  const save = (rules: FilterRules | undefined, enabled: boolean) => {
    // Save first: storage errors leave the currently applied rules intact.
    if (rules) localStorage.setItem(key, JSON.stringify({ rules, enabled }));
    else localStorage.setItem(key, JSON.stringify({ rules: { version: 1, rules: [] }, enabled: false }));
    setSaved({ key, rules, enabled, error: "" });
  };
  return { ...current, compiled, save };
}

export function FilterRulesPanel({ filters, files, input, pull }: {
  filters: ReturnType<typeof useFilterRules>;
  files: File[];
  input: { sourceId: number; repo: string; number: number };
  pull: { title: string; body: string };
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState("");
  const [draft, setDraft] = useState(() => filters.rules ? JSON.stringify(filters.rules, null, 2) : "");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [model, setModel] = useAgentModel("filterRuleModel", "sonnet");
  const generated = useMutation(trpc.filters.generate.mutationOptions());
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
      filters.save(rules, enabled);
      setError("");
      setNotice(rules ? (enabled ? "Custom filters applied." : "Custom filters paused.") : "Custom filters cleared.");
      return true;
    } catch {
      setError("Could not save custom filters in this browser.");
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
        field.value = text;
        field.style.cssText = "position:fixed;opacity:0;pointer-events:none";
        document.body.append(field);
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

  return (
    <section className="rounded-md border bg-card p-3" aria-label="Custom filters">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={`${id}-editor`}>
          <Filter /> Custom filters {open ? <ChevronUp /> : <ChevronDown />}
        </Button>
        <span className="text-xs text-muted-foreground">
          {filters.enabled ? `${filters.rules?.rules.length ?? 0} ${filters.rules?.rules.length === 1 ? "rule" : "rules"} active` : "Off"}
        </span>
        {filters.rules && (
          <Button variant="outline" size="sm" className="ml-auto" aria-pressed={filters.enabled} onClick={() => save(filters.rules, !filters.enabled)}>
            {filters.enabled ? "Pause filters" : "Enable filters"}
          </Button>
        )}
      </div>
      {open && (
        <div id={`${id}-editor`} className="mt-3 space-y-3 border-t pt-3">
          <p className="text-xs text-muted-foreground">Describe what matters to you. AI reads this pull request and proposes changes to hide. Saved for this PR in your browser.</p>
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${id}-request`}>Describe what to hide</Label>
              <Textarea id={`${id}-request`} value={request} onChange={e => setRequest(e.target.value)} maxLength={4000}
                placeholder="Show behavior changes. Hide mechanical edits that only wrap the same values in a requestBody object."
                className="min-h-24" disabled={generated.isPending} />
              <div className="flex flex-wrap items-center gap-2">
                <ModelPicker value={model} onChange={setModel} />
                <Button size="sm" disabled={!request.trim() || generated.isPending} onClick={generate}>
                  {generated.isPending ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
                  {generated.isPending ? "Analyzing diff…" : "Generate"}
                </Button>
                <Button variant="outline" size="sm" disabled={!request.trim()} onClick={() => copy(filterPrompt(request, { ...pull, files }), "Prompt and diff copied. Paste them into your chat, then paste the returned rules here.")}>
                  <Copy /> Copy prompt for chat
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Generate uses your installed AI CLI. Copy prompt includes this PR’s diff for use in another chat.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-rules`}>Rules (JSON)</Label>
              <Textarea id={`${id}-rules`} value={draft} onChange={e => edit(e.target.value)} placeholder={exampleFilterRules}
                maxLength={100000} spellCheck={false} disabled={generated.isPending} aria-invalid={Boolean(preview?.error)}
                aria-describedby={preview?.error ? `${id}-error` : undefined} className="min-h-40 max-h-96 font-mono text-xs" />
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" size="sm" disabled={generated.isPending} onClick={() => edit(exampleFilterRules)}>Use example</Button>
                <Button variant="ghost" size="sm" disabled={!preview?.rules} onClick={() => copy(JSON.stringify(preview!.rules, null, 2), "Rules copied.")}><Copy /> Copy rules</Button>
              </div>
              <p className="text-xs text-muted-foreground">AI selections match exact changes and stop matching when that file’s patch changes. Pause filters to see everything they hide.</p>
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">Rule format</summary>
                <p className="mt-1">Rules can select exact changes with a reason, or use reusable paths and line patterns. Paths match from the repository root: * stays within a directory, ** crosses directories, and **/ also matches the root. Line patterns match the full trimmed line; * matches any text and ? one character. Both sides of a replacement stay together.</p>
              </details>
            </div>
          </div>
          {preview?.error && <p id={`${id}-error`} role="alert" className="text-sm whitespace-pre-wrap text-destructive">{preview.error}</p>}
          {preview?.rules?.summary && <p className="text-sm whitespace-pre-wrap">{preview.rules.summary}</p>}
          {preview?.rules && preview.rules.rules.length > 0 && (
            <ul className="space-y-2 text-sm">
              {preview.rules.rules.map((rule, i) => (
                <li key={i}><span className="font-medium">{rule.name}</span>{rule.reason && <span className="text-muted-foreground"> — {rule.reason}</span>}</li>
              ))}
            </ul>
          )}
          {preview?.rules && <p className="text-sm" role="status">Preview: {preview.hiddenFiles} of {files.length} files and {preview.hiddenLines} changed lines would be hidden by these rules.</p>}
          <div className="flex gap-2">
            <Button size="sm" disabled={!preview?.rules?.rules.length || generated.isPending} onClick={() => preview?.rules && save(preview.rules, true)}>Apply rules</Button>
            <Button variant="ghost" size="sm" disabled={generated.isPending} onClick={() => { if (save(undefined, false)) setDraft(""); }}>Clear rules</Button>
          </div>
        </div>
      )}
      {(error || filters.error) && <p role="alert" className="mt-2 text-sm text-destructive">{error || filters.error}</p>}
      {notice && <p role="status" className="mt-2 text-xs text-muted-foreground">{notice}</p>}
    </section>
  );
}

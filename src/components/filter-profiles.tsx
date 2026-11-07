import type { useFilterRules } from "@/components/filter-rules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FilterProfileSettings } from "@/lib/filter-profiles";
import { captureReviewFilters, type useReviewFilters } from "@/lib/review-filters";
import { queryClient, trpc } from "@/lib/trpc";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";

/** Keep profile controls and mutations alive above the mobile drawer. */
export function useFilterProfiles(
  input: { sourceId: number; repo: string },
  filters: ReturnType<typeof useReviewFilters>,
  rules: ReturnType<typeof useFilterRules>,
) {
  const repository = JSON.stringify([input.sourceId, input.repo]);
  const initialState = { repository, selectedId: "", name: "", confirmDelete: false, error: "", notice: "" };
  const [state, setState] = useState(initialState);
  if (state.repository !== repository) setState(initialState);

  const list = useQuery(trpc.filterProfiles.list.queryOptions(input));
  const selected = list.data?.find(profile => String(profile.id) === state.selectedId);
  const change = (changes: Partial<typeof state>, scope = input) => {
    const key = JSON.stringify([scope.sourceId, scope.repo]);
    setState(current => current.repository === key ? { ...current, ...changes } : current);
  };
  const failed = (cause: { message: string; data?: { code?: string } | null }, scope: typeof input) => {
    change({
      error: cause.data?.code === "CONFLICT"
        ? "A profile with this name already exists. Choose another name."
        : cause.data?.code === "NOT_FOUND"
          ? "This profile no longer exists. Choose another profile or save a new one."
          : cause.message,
      notice: "",
      confirmDelete: false,
    }, scope);
    if (cause.data?.code === "NOT_FOUND") {
      void queryClient.invalidateQueries({ queryKey: trpc.filterProfiles.list.queryKey({ sourceId: scope.sourceId, repo: scope.repo }) });
    }
  };
  const save = useMutation(trpc.filterProfiles.save.mutationOptions({
    onSuccess: async (profile, variables) => {
      const queryKey = trpc.filterProfiles.list.queryKey({ sourceId: variables.sourceId, repo: variables.repo });
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData(queryKey, (current = []) =>
        [...current.filter(item => item.id !== profile.id), profile].sort((a, b) => a.name.localeCompare(b.name)),
      );
      change({
        selectedId: String(profile.id),
        ...(variables.id === undefined ? { name: "" } : {}),
        confirmDelete: false,
        error: "",
        notice: variables.id === undefined ? `Profile “${profile.name}” saved.` : `Profile “${profile.name}” updated.`,
      }, variables);
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: failed,
  }));
  const remove = useMutation(trpc.filterProfiles.remove.mutationOptions({
    onSuccess: async (_, variables) => {
      const queryKey = trpc.filterProfiles.list.queryKey({ sourceId: variables.sourceId, repo: variables.repo });
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData(queryKey, (current = []) => current.filter(profile => profile.id !== variables.id));
      change({ selectedId: "", confirmDelete: false, error: "", notice: "Profile deleted." }, variables);
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: failed,
  }));
  const busy = save.isPending || remove.isPending;
  const saveCurrent = (update: boolean) => {
    if (busy || (update && !selected)) return;
    const name = update ? selected!.name : state.name.trim();
    if (!name || name.length > 80) {
      change({ error: "Enter a profile name of 1–80 characters.", notice: "" });
      return;
    }
    try {
      const settings: FilterProfileSettings = captureReviewFilters(filters, rules.editor.request);
      change({ error: "", notice: "", confirmDelete: false });
      save.mutate({ ...input, ...(update ? { id: selected!.id } : {}), name, settings });
    } catch {
      change({ error: "Could not save the current filters. Check your applied filters and try again.", notice: "" });
    }
  };

  return {
    ...state,
    items: list.data ?? [],
    selected,
    loading: list.isPending,
    loadError: list.error?.message,
    retry: () => { void list.refetch(); },
    busy,
    pending: save.isPending ? (save.variables?.id === undefined ? "Saving profile…" : "Updating profile…") : remove.isPending ? "Deleting profile…" : "",
    applyingBlocked: rules.editor.generated.isPending,
    select: (selectedId: string) => change({ selectedId, confirmDelete: false, error: "", notice: "" }),
    setName: (name: string) => change({ name, error: "", notice: "" }),
    save: () => saveCurrent(false),
    update: () => saveCurrent(true),
    apply: () => {
      if (!selected || busy || rules.editor.generated.isPending) return;
      try {
        filters.replace(selected.settings);
        rules.editor.setRequest(selected.settings.request);
        rules.editor.setDraft(selected.settings.rules?.rules.length ? JSON.stringify(selected.settings.rules, null, 2) : "");
        rules.editor.setError("");
        rules.editor.setNotice("");
        rules.editor.ownRuleUpdate.current = undefined;
        change({ error: "", notice: `Profile “${selected.name}” applied.`, confirmDelete: false });
      } catch {
        change({ error: "Could not apply this profile. Try again.", notice: "" });
      }
    },
    askDelete: () => change({ confirmDelete: true, error: "", notice: "" }),
    cancelDelete: () => change({ confirmDelete: false }),
    remove: () => {
      if (!selected || busy || !state.confirmDelete) return;
      change({ error: "", notice: "" });
      remove.mutate({ ...input, id: selected.id });
    },
  };
}

export function FilterProfilesPanel({ profiles }: { profiles: ReturnType<typeof useFilterProfiles> }) {
  const id = useId();
  return (
    <section className="min-w-0 shrink-0 space-y-3 rounded-md border bg-card p-3 [overflow-wrap:anywhere]" aria-labelledby={`${id}-title`} aria-busy={profiles.loading || profiles.busy}>
      <h3 id={`${id}-title`} className="text-sm font-medium">Filter profiles</h3>
      <p className="text-xs text-muted-foreground">Saved for this repository. Apply to replace this PR’s filters.</p>
      <div className="min-w-0 space-y-2">
        <Label htmlFor={`${id}-saved`}>Saved profile</Label>
        <select
          id={`${id}-saved`}
          value={profiles.selected ? profiles.selectedId : ""}
          onChange={event => profiles.select(event.target.value)}
          disabled={profiles.loading || profiles.busy || !profiles.items.length}
          className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-base shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 md:text-sm"
        >
          <option value="">{profiles.items.length ? "Choose a profile" : "No saved profiles"}</option>
          {profiles.items.map(profile => <option key={profile.id} value={String(profile.id)}>{profile.name}</option>)}
        </select>
        <Button type="button" size="sm" disabled={!profiles.selected || profiles.busy || profiles.applyingBlocked} onClick={profiles.apply}>Apply profile</Button>
        {profiles.applyingBlocked && <p role="status" className="text-xs text-muted-foreground">Wait for analysis to finish before applying a profile.</p>}
      </div>
      <details className="space-y-3">
        <summary className="cursor-pointer text-xs font-medium">Save or manage profiles</summary>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={!profiles.selected || profiles.busy} onClick={profiles.update}>Update profile</Button>
          <Button type="button" size="sm" variant="ghost" disabled={!profiles.selected || profiles.busy || profiles.confirmDelete} onClick={profiles.askDelete}>Delete profile</Button>
        </div>
        {profiles.confirmDelete && profiles.selected && (
          <div role="group" aria-labelledby={`${id}-confirm`} className="space-y-2 rounded-md border p-2">
            <p id={`${id}-confirm`} className="text-xs">Delete “{profiles.selected.name}” from this repository?</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="destructive" disabled={profiles.busy} onClick={profiles.remove}>Confirm delete</Button>
              <Button type="button" size="sm" variant="ghost" disabled={profiles.busy} onClick={profiles.cancelDelete}>Cancel</Button>
            </div>
          </div>
        )}
      <form className="min-w-0 space-y-2 border-t pt-3" onSubmit={event => { event.preventDefault(); profiles.save(); }}>
        <Label htmlFor={`${id}-name`}>Profile name</Label>
        <Input id={`${id}-name`} value={profiles.name} onChange={event => profiles.setName(event.target.value)} maxLength={80} disabled={profiles.busy} autoComplete="off" />
        <Button type="submit" size="sm" variant="outline" disabled={profiles.busy || !profiles.name.trim()}>Save profile</Button>
        <p className="text-xs text-muted-foreground">Save current filters as a new profile. Saves applied filters and current instructions; unapplied Custom filters drafts are excluded.</p>
      </form>
      <p className="text-xs text-muted-foreground">Exact AI selections only match the original patch. Use saved instructions to regenerate in Custom filters.</p>
      </details>
      {profiles.loading && <p role="status" className="text-xs text-muted-foreground">Loading profiles…</p>}
      {profiles.loadError && (
        <div role="alert" className="space-y-2 text-xs text-destructive">
          <p>Could not load profiles: {profiles.loadError}</p>
          <Button type="button" size="sm" variant="outline" onClick={profiles.retry} disabled={profiles.loading}>Retry</Button>
        </div>
      )}
      {profiles.pending && <p role="status" className="text-xs text-muted-foreground">{profiles.pending}</p>}
      {profiles.error && <p role="alert" className="text-xs text-destructive">{profiles.error}</p>}
      {profiles.notice && <p role="status" className="text-xs text-muted-foreground">{profiles.notice}</p>}
    </section>
  );
}

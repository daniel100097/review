import type { useFilterRules } from "@/components/filter-rules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FilterProfileSettings } from "@/lib/filter-profiles";
import { captureReviewFilters, type useReviewFilters } from "@/lib/review-filters";
import { queryClient, trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useId, useRef, useState } from "react";

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

/** Radix Select reserves "" for its placeholder, so "None" needs a value of its own. */
const NO_PROFILE = "none";

/** Borderless content for a section of the Filters popover; the popover provides padding. */
export function FilterProfilesPanel({ profiles }: { profiles: ReturnType<typeof useFilterProfiles> }) {
  const id = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  // Reopening the popover mid-edit (or mid-delete) shows the form that is still in progress.
  const [manage, setManage] = useState(Boolean(profiles.name || profiles.confirmDelete));
  const empty = !profiles.items.length;
  const toggle = () => {
    setManage(!manage);
    // "Save current as…" only reveals the name field; the click commits synchronously, so it exists by the next frame.
    if (!manage && empty) requestAnimationFrame(() => nameInput.current?.focus());
  };
  const selectedName = profiles.selected?.name;
  // Live regions stay mounted (sr-only while empty) so screen readers announce text changes.
  const status = [
    profiles.applyingBlocked && "Wait for analysis to finish before applying a profile.",
    profiles.loading && "Loading profiles…",
    profiles.pending,
    profiles.notice,
  ].filter(Boolean).join(" ");
  return (
    // A flex gap rather than space-y: the sr-only live regions are out of flow and must not leave margins behind.
    <section className="flex min-w-0 flex-col gap-2 text-[13px] [overflow-wrap:anywhere]" aria-labelledby={`${id}-title`} aria-busy={profiles.loading}>
      {/* While the first load runs, only the status line below shows. */}
      <div className={cn("flex min-h-7 items-center gap-2 pointer-coarse:min-h-9", empty && profiles.loading && "sr-only")}>
        <h3 id={`${id}-title`} className={cn("min-w-0 flex-1 font-medium", empty && "sr-only")}
          title="Saved for this repository on the UI server. Applying one replaces this PR’s filters.">
          Profile
        </h3>
        {empty ? (
          !profiles.loading && (
            <>
              <p className="min-w-0 flex-1 text-muted-foreground">{profiles.loadError ? "Profiles not loaded" : "No saved profiles"}</p>
              <Button type="button" variant="ghost" size="xs" aria-expanded={manage} aria-controls={`${id}-manage`} onClick={toggle}
                title="Save this PR’s filters as a profile for this repository">
                Save current as…
              </Button>
            </>
          )
        ) : (
          <Button type="button" variant="ghost" size="xs" className="text-muted-foreground" aria-expanded={manage} aria-controls={`${id}-manage`} onClick={toggle}>
            Manage <ChevronDown className={cn("transition-transform", manage && "rotate-180")} />
          </Button>
        )}
      </div>
      {!empty && (
        <div className="flex min-w-0 gap-2">
          <Select value={profiles.selected ? profiles.selectedId : ""} onValueChange={value => profiles.select(value === NO_PROFILE ? "" : value)}
            disabled={profiles.loading || profiles.busy}>
            <SelectTrigger size="sm" className="min-w-0 flex-1 text-[13px] pointer-coarse:h-9" aria-labelledby={`${id}-title`}>
              <SelectValue placeholder="Choose a profile" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_PROFILE} className="text-[13px] text-muted-foreground pointer-coarse:min-h-9">None</SelectItem>
              {profiles.items.map(profile => <SelectItem key={profile.id} value={String(profile.id)} className="text-[13px] pointer-coarse:min-h-9">{profile.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button type="button" size="sm" disabled={!profiles.selected || profiles.busy || profiles.applyingBlocked} onClick={profiles.apply}
            title={selectedName ? `Replace this PR’s filters with “${selectedName}”` : undefined}>
            Apply
          </Button>
        </div>
      )}
      {manage && (
        <div id={`${id}-manage`} className="min-w-0 space-y-2">
          <form className="flex min-w-0 gap-2" onSubmit={event => { event.preventDefault(); profiles.save(); }}>
            {/* readOnly rather than disabled while saving, so focus stays in the field. 16px on touch avoids iOS zoom. */}
            <Input ref={nameInput} value={profiles.name} onChange={event => profiles.setName(event.target.value)} maxLength={80} readOnly={profiles.busy} autoComplete="off"
              placeholder="New profile name" aria-label="Profile name" aria-describedby={`${id}-save-hint`}
              className="h-7 min-w-0 flex-1 px-2 pointer-fine:text-[13px] pointer-coarse:h-9 pointer-coarse:text-base" />
            <Button type="submit" size="xs" variant="outline" disabled={profiles.busy || !profiles.name.trim()}>Save</Button>
          </form>
          <p id={`${id}-save-hint`} className="text-xs text-muted-foreground"
            title="Exact AI selections only match their original patch; the saved instruction can regenerate them in Custom filters.">
            Saves applied filters and the AI instruction, not unapplied rule drafts.
          </p>
          {!empty && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="xs" variant="outline" disabled={!profiles.selected || profiles.busy} onClick={profiles.update}
                title={selectedName ? `Save the current filters over “${selectedName}”` : "Choose a profile to update"}>
                Update
              </Button>
              <Button type="button" size="xs" variant="ghost" disabled={!profiles.selected || profiles.busy || profiles.confirmDelete} onClick={profiles.askDelete}
                title={selectedName ? `Delete “${selectedName}”` : "Choose a profile to delete"}>
                Delete
              </Button>
            </div>
          )}
          {profiles.confirmDelete && profiles.selected && (
            <div role="group" aria-labelledby={`${id}-confirm`} className="space-y-2">
              <p id={`${id}-confirm`} className="text-xs">Delete “{profiles.selected.name}” from this repository?</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="xs" variant="destructive" disabled={profiles.busy} onClick={profiles.remove}>Confirm delete</Button>
                <Button type="button" size="xs" variant="ghost" disabled={profiles.busy} onClick={profiles.cancelDelete}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}
      <p role="status" className={cn("text-xs text-muted-foreground", !status && "sr-only")}>{status}</p>
      <div className={cn("flex flex-wrap items-center gap-2 text-xs text-destructive", !profiles.error && !profiles.loadError && "sr-only")}>
        <div role="alert" className="min-w-0 flex-1 space-y-1">
          {profiles.loadError && <p>Could not load profiles: {profiles.loadError}</p>}
          {profiles.error && <p>{profiles.error}</p>}
        </div>
        {profiles.loadError && <Button type="button" size="xs" variant="outline" onClick={profiles.retry} disabled={profiles.loading}>Retry</Button>}
      </div>
    </section>
  );
}

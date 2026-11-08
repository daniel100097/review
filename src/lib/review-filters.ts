import { useMemo } from "react";
import { navigate, useLocationProperty } from "wouter/use-browser-location";
import { parseFilterRules, type FilterRules } from "./filter-rules";
import { filterProfileSettingsSchema, type FilterProfileSettings } from "./filter-profiles";

const queryKeys = ["hideTests", "hideCommentChanges", "hideReviewComments", "hideFolder", "by"];
const fragmentKeys = ["rules", "rulesPaused"];
type ToggleKey = "hideTests" | "hideCommentChanges" | "hideReviewComments";
type FilterUpdate = (query: URLSearchParams, fragment: URLSearchParams) => void;

export function readReviewFilters(url: URL) {
  const query = url.searchParams;
  const fragment = new URLSearchParams(url.hash.slice(1));
  let rules: FilterRules | undefined;
  let error = "";
  const text = fragment.get("rules");
  if (text?.trim()) {
    try {
      const parsed = parseFilterRules(text);
      if (parsed.rules.length) rules = parsed;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }
  return {
    hideTests: query.get("hideTests") === "1",
    hideCommentChanges: query.get("hideCommentChanges") === "1",
    hideReviewComments: query.get("hideReviewComments") === "1",
    hiddenFolders: [...new Set(query.getAll("hideFolder").filter(Boolean))],
    by: query.get("by") || undefined,
    rules,
    rulesEnabled: Boolean(rules && fragment.get("rulesPaused") !== "1"),
    error,
    hasFilters: queryKeys.some(key => query.has(key)) || fragmentKeys.some(key => fragment.has(key)),
  };
}

export function updateReviewFilters(url: URL, update: FilterUpdate): URL {
  const next = new URL(url.href);
  const query = new URLSearchParams(url.search);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const previousQuery = query.toString();
  const previousFragment = fragment.toString();
  update(query, fragment);
  if (query.toString() !== previousQuery) next.search = query.toString();
  if (fragment.toString() !== previousFragment) next.hash = fragment.toString();
  return next;
}

function changeFilters(update: FilterUpdate) {
  navigate(updateReviewFilters(new URL(window.location.href), update), { state: history.state });
}

/** Save applied filters; the editor's unreviewed JSON draft is deliberately excluded. */
export function captureReviewFilters(filters: ReturnType<typeof readReviewFilters>, request: string): FilterProfileSettings {
  if (filters.error) throw new Error("Fix the invalid custom rules before saving a profile.");
  return filterProfileSettingsSchema.parse({
    hideTests: filters.hideTests,
    hideCommentChanges: filters.hideCommentChanges,
    hideReviewComments: filters.hideReviewComments,
    hiddenFolders: filters.hiddenFolders,
    by: filters.by,
    rules: filters.rules,
    rulesEnabled: filters.rulesEnabled,
    request,
  });
}

function writeRules(fragment: URLSearchParams, rules: FilterRules | undefined, enabled: boolean) {
  if (rules?.rules.length) {
    // Fragments keep large exact selections out of the HTTP request URL.
    fragment.set("rules", JSON.stringify(rules));
    if (enabled) fragment.delete("rulesPaused");
    else fragment.set("rulesPaused", "1");
  } else {
    for (const key of fragmentKeys) fragment.delete(key);
  }
}

// These actions read the URL at call time, including consecutive calls before React renders.
export const reviewFilterActions = {
  setToggle(key: ToggleKey, value: boolean) {
    changeFilters(query => value ? query.set(key, "1") : query.delete(key));
  },
  setFolderHidden(path: string, hidden: boolean) {
    changeFilters(query => {
      const folders = new Set(query.getAll("hideFolder").filter(Boolean));
      if (hidden && path) folders.add(path);
      else folders.delete(path);
      query.delete("hideFolder");
      for (const folder of folders) query.append("hideFolder", folder);
    });
  },
  /** Unhides every folder in one history entry, so Back restores them all at once. */
  clearFolders() {
    changeFilters(query => query.delete("hideFolder"));
  },
  setContributor(by?: string) {
    changeFilters(query => by ? query.set("by", by) : query.delete("by"));
  },
  setRules(rules: FilterRules | undefined, enabled: boolean) {
    const parsed = rules === undefined ? undefined : parseFilterRules(JSON.stringify(rules));
    changeFilters((_, fragment) => writeRules(fragment, parsed, enabled));
  },
  replace(settings: FilterProfileSettings) {
    const parsed = filterProfileSettingsSchema.parse(settings);
    changeFilters((query, fragment) => {
      for (const key of queryKeys) query.delete(key);
      for (const key of ["hideTests", "hideCommentChanges", "hideReviewComments"] as const) {
        if (parsed[key]) query.set(key, "1");
      }
      for (const folder of new Set(parsed.hiddenFolders)) query.append("hideFolder", folder);
      if (parsed.by) query.set("by", parsed.by);
      writeRules(fragment, parsed.rules, parsed.rulesEnabled);
    });
  },
  reset() {
    changeFilters((query, fragment) => {
      for (const key of queryKeys) query.delete(key);
      for (const key of fragmentKeys) fragment.delete(key);
    });
  },
};

export function useReviewFilters() {
  const href = useLocationProperty(() => window.location.href);
  const state = useMemo(() => readReviewFilters(new URL(href)), [href]);
  return { ...state, ...reviewFilterActions };
}

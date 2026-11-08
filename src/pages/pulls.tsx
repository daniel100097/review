import { EmptyState, ListSkeleton, Page, QueryError, useSource } from "@/components/page";
import { PullStateIcon } from "@/components/pull-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { routes } from "@/lib/routes";
import { trpc } from "@/lib/trpc";
import { cn, timeAgo } from "@/lib/utils";
import type { PullQuery, PullSummary } from "@/server/providers/types";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ListFilter, MessageSquare, Search, UserRound, UserRoundCheck, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Link, useSearchParams } from "wouter";

const stateLabels: Record<PullQuery["state"], string> = { open: "Open", merged: "Merged", closed: "Closed", all: "All" };
const states = Object.keys(stateLabels) as PullQuery["state"][];
const sortLabels: Record<PullQuery["sort"], string> = {
  updated: "Recently updated",
  newest: "Newest",
  oldest: "Oldest",
};
/** Radix Select can't use an empty value, so "no label filter" gets a sentinel. */
const anyLabel = "__any";
// Phones only have room for a short search placeholder.
const sm = matchMedia("(min-width: 640px)");
const subscribeSm = (onChange: () => void) => {
  sm.addEventListener("change", onChange);
  return () => sm.removeEventListener("change", onChange);
};

export function PullsPage({ sourceId, repo }: { sourceId: number; repo: string }) {
  const source = useSource(sourceId);

  // Filters live in the URL so a filtered list can be linked and survives reloads.
  const [params, setParams] = useSearchParams();
  const filters = {
    state: states.find(state => state === params.get("state")) ?? "open",
    search: params.get("q") ?? "",
    author: params.get("author") ?? "",
    label: params.get("label") ?? "",
    sort: (Object.keys(sortLabels) as PullQuery["sort"][]).find(sort => sort === params.get("sort")) ?? "updated",
  };
  const setFilters = (changes: Partial<Record<"state" | "q" | "author" | "label" | "sort", string>>, replace = false) => {
    // The live URL, not this render's params: the debounced search can fire after another filter changed.
    const current = new URLSearchParams(window.location.search);
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    // A control reporting the same value again would still push a history entry, so Back would seem to do nothing.
    if (next.toString() !== current.toString()) setParams(next, { replace });
  };

  // Typing updates the box immediately and the URL (and query) after a pause.
  const [searchText, setSearchText] = useState(filters.search);
  // Follow Back/Forward, but don't strip a trailing space the debounce just left out of the URL.
  useEffect(() => {
    if (searchText.trim() !== filters.search) setSearchText(filters.search);
  }, [filters.search]);
  useEffect(() => {
    if (searchText.trim() === filters.search) return;
    const timeout = setTimeout(() => setFilters({ q: searchText.trim() }, true), 300);
    return () => clearTimeout(timeout);
  }, [searchText, filters.search]);

  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focusSearch = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]");
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  const pulls = useInfiniteQuery({
    ...trpc.pulls.list.infiniteQueryOptions(
      { sourceId, repo, ...filters },
      { getNextPageParam: last => last.nextCursor },
    ),
    placeholderData: keepPreviousData,
  });
  const labels = useQuery(trpc.repos.labels.queryOptions({ sourceId, repo }));

  const items = useMemo(() => {
    // A number lookup can also appear on a later search page. Keep the first, richer result.
    const unique = new Map<number, PullSummary>();
    for (const pull of pulls.data?.pages.flatMap(p => p.items) ?? []) {
      if (!unique.has(pull.number)) unique.set(pull.number, pull);
    }
    return [...unique.values()];
  }, [pulls.data]);
  const authors = useMemo(() => [...new Set(items.map(p => p.author.username))].sort(), [items]);
  const labelColor = (name: string) => labels.data?.find(l => l.name === name)?.color;
  const filtered = Boolean(filters.search || filters.author || filters.label);
  const mine = Boolean(source && filters.author === source.username);
  // Sort counts too: it's hidden in the popover, so the button is the only hint that it isn't the default.
  const popoverActive = [filters.author, filters.label, filters.sort !== "updated"].filter(Boolean).length;
  const wide = useSyncExternalStore(subscribeSm, () => sm.matches);
  const clearFilters = () => {
    setSearchText("");
    setFilters({ q: "", author: "", label: "" });
  };

  // A chip's ✕ removes the chip; focus then moves to the next chip (or the Filters button) instead of <body>.
  const filtersButton = useRef<HTMLButtonElement>(null);
  const chipRow = useRef<HTMLDivElement>(null);
  const chipKeys = [filters.author && !mine && "author", filters.label && "label"].filter(key => !!key);
  const removedChip = useRef<{ key: string; index: number }>(undefined);
  const removeChip = (key: "author" | "label") => {
    removedChip.current = { key, index: chipKeys.indexOf(key) };
    setFilters({ [key]: "" });
  };
  useLayoutEffect(() => {
    const removed = removedChip.current;
    if (!removed || chipKeys.includes(removed.key)) return;
    removedChip.current = undefined;
    (chipRow.current?.querySelectorAll<HTMLElement>("[data-chip-action]")[removed.index] ?? filtersButton.current)?.focus();
  });

  return (
    <Page crumbs={[{ label: source?.host ?? "…", href: routes.source(sourceId) }, { label: repo }]}>
      <h1 className="sr-only">Pull requests — {repo}</h1>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-full sm:min-w-64 sm:basis-0">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              onKeyDown={e => e.key === "Escape" && setSearchText("")}
              aria-label="Search pull requests"
              placeholder={wide ? "Search titles and descriptions, or #number" : "Search or #number"}
              className="pl-8 pointer-fine:pr-10"
            />
            <kbd className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 pointer-fine:block">/</kbd>
          </div>
          {/* Native radios: one change per pick (Radix Tabs reported twice), arrow keys for free, and no tab panels to point at. */}
          <div role="radiogroup" aria-label="State" className="flex h-9 rounded-lg bg-muted p-[3px] max-sm:w-full pointer-coarse:h-11">
            {states.map(state => (
              <label
                key={state}
                className="relative flex flex-1 cursor-pointer items-center justify-center rounded-md border border-transparent px-2.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground has-checked:bg-background has-checked:text-foreground has-checked:shadow-sm dark:has-checked:border-input dark:has-checked:bg-input/30"
              >
                <input
                  type="radio"
                  name="pull-state"
                  value={state}
                  checked={filters.state === state}
                  onChange={() => setFilters({ state: state === "open" ? "" : state })}
                  // Transparent over the whole segment, so the radio itself takes clicks and shows focus.
                  className="absolute inset-0 cursor-pointer appearance-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                {stateLabels[state]}
              </label>
            ))}
          </div>
        </div>

        <div ref={chipRow} className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-pressed={mine}
            disabled={!source}
            title={source && `Pull requests by @${source.username}`}
            onClick={() => source && setFilters({ author: mine ? "" : source.username })}
            className="aria-pressed:bg-accent dark:aria-pressed:bg-accent"
          >
            {/* The check makes "on" readable without relying on the faint accent background (it's also the hover colour). */}
            {mine ? <UserRoundCheck /> : <UserRound />}
            Mine
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button ref={filtersButton} variant="outline" size="sm" aria-label={popoverActive ? `Filters, ${popoverActive} active` : "Filters"}>
                <ListFilter />
                Filters
                {popoverActive > 0 && (
                  <span className="-mr-1 flex h-5 min-w-5 items-center justify-center rounded-sm bg-muted px-1 text-xs tabular-nums">
                    {popoverActive}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-72 space-y-3"
              aria-label="Pull request filters"
              onOpenAutoFocus={e => {
                // Focusing the Author field would pop up the on-screen keyboard; focus the popover itself instead.
                if (!matchMedia("(pointer: coarse)").matches) return;
                e.preventDefault();
                (e.currentTarget as HTMLElement).focus();
              }}
            >
              <Field label="Author" htmlFor="pull-author">
                <Input
                  id="pull-author"
                  list="pull-authors"
                  value={filters.author}
                  onChange={e => setFilters({ author: e.target.value.trim() }, true)}
                  placeholder="Any author"
                  // Chrome's datalist ▼ (an !important UA style) clashes with the selects' chevrons; typing still suggests.
                  className="h-8 pointer-coarse:h-9 [&::-webkit-calendar-picker-indicator]:hidden!"
                />
                <datalist id="pull-authors">
                  {authors.map(author => (
                    <option key={author} value={author} />
                  ))}
                </datalist>
              </Field>
              <Field label="Label" htmlFor="pull-label">
                <Select value={filters.label || anyLabel} onValueChange={v => setFilters({ label: v === anyLabel ? "" : v })}>
                  <SelectTrigger id="pull-label" size="sm" className="w-full min-w-0 pointer-coarse:data-[size=sm]:h-9" aria-label="Label">
                    <SelectValue className="min-w-0" />
                  </SelectTrigger>
                  <SelectContent className="max-w-[calc(100vw-2rem)]">
                    <SelectItem value={anyLabel}>Any label</SelectItem>
                    {labels.data?.map(label => (
                      <SelectItem key={label.name} value={label.name} className="[&>span:last-child]:min-w-0">
                        <LabelDot color={label.color} />
                        <span className="truncate">{label.name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Sort" htmlFor="pull-sort">
                <Select value={filters.sort} onValueChange={sort => setFilters({ sort: sort === "updated" ? "" : sort })}>
                  <SelectTrigger id="pull-sort" size="sm" className="w-full pointer-coarse:data-[size=sm]:h-9" aria-label="Sort">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(sortLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </PopoverContent>
          </Popover>
          {/* Mine already shows the author filter when it's you. */}
          {filters.author && !mine && <FilterChip label={`Author: ${filters.author}`} onRemove={() => removeChip("author")} />}
          {filters.label && (
            <FilterChip label={`Label: ${filters.label}`} onRemove={() => removeChip("label")}>
              <LabelDot color={labelColor(filters.label)} />
            </FilterChip>
          )}
          {filtered && (
            <Button variant="ghost" size="xs" className="text-muted-foreground" title="Clear search, author and label" onClick={clearFilters}>
              Clear
            </Button>
          )}
          <p role="status" className="ml-auto text-xs text-muted-foreground tabular-nums">
            {pulls.isFetching && !pulls.isFetchingNextPage ? "Loading…" : pulls.data && `${items.length} shown`}
          </p>
        </div>

        {pulls.error ? (
          <QueryError error={pulls.error} />
        ) : !pulls.data ? (
          <ListSkeleton />
        ) : items.length === 0 ? (
          <EmptyState>
            {filtered ? (
              <>
                No pull requests match these filters.{" "}
                <Button variant="link" className="h-auto p-0 text-foreground underline" onClick={clearFilters}>
                  Clear filters
                </Button>
              </>
            ) : (
              "No pull requests."
            )}
          </EmptyState>
        ) : (
          <ul className={cn("divide-y overflow-hidden rounded-lg border transition-opacity", pulls.isPlaceholderData && "opacity-60")}>
            {items.map(pull => (
              <li key={pull.number}>
                <PullRow pull={pull} href={routes.pull(sourceId, repo, pull.number)} labelColor={labelColor} />
              </li>
            ))}
          </ul>
        )}

        {pulls.hasNextPage && (
          <div className="flex justify-center">
            <Button variant="outline" onClick={() => pulls.fetchNextPage()} disabled={pulls.isFetching}>
              {pulls.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </div>
    </Page>
  );
}

function PullRow({ pull, href, labelColor }: { pull: PullSummary; href: string; labelColor: (name: string) => string | undefined }) {
  return (
    <Link
      href={href}
      title={`opened ${timeAgo(pull.createdAt)}`}
      className="flex gap-3 px-4 py-3 outline-none hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <PullStateIcon state={pull.state} draft={pull.draft} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{pull.title}</span>
          {pull.draft && (
            <Badge variant="outline" className="font-normal text-muted-foreground">
              Draft
            </Badge>
          )}
          {pull.labels.map(label => (
            <Badge key={label.name} variant="outline" title={label.name} className="max-w-48 min-w-0 font-normal">
              <LabelDot color={label.color || labelColor(label.name)} />
              <span className="truncate">{label.name}</span>
            </Badge>
          ))}
        </div>
        {/* On phones the branches go last on their own line (truncated there), so wrapping rarely starts a line with a dot. */}
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground [&>*+*]:before:mr-1.5 [&>*+*]:before:content-['·']">
          <span className="tabular-nums">#{pull.number}</span>
          <span title={`@${pull.author.username}`}>{pull.author.name}</span>
          {pull.sourceBranch && (
            <span className="flex min-w-0 max-w-full items-center max-sm:order-last max-sm:basis-full max-sm:before:hidden">
              <span className="min-w-0 truncate font-mono sm:max-w-72" title={pull.sourceBranch}>
                {pull.sourceBranch}
              </span>
              <span className="shrink-0 px-1">→</span>
              <span className="max-w-40 shrink-0 truncate font-mono" title={pull.targetBranch}>
                {pull.targetBranch}
              </span>
            </span>
          )}
          <span>updated {timeAgo(pull.updatedAt)}</span>
        </div>
      </div>
      {pull.comments > 0 && (
        <span className="mt-0.5 flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums" title={`${pull.comments} comments`}>
          <MessageSquare className="size-3.5" /> {pull.comments}
        </span>
      )}
    </Link>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[13px] font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

/** An active popover filter, shown next to the Filters button so it's visible and removable in one click. */
function FilterChip({ label, onRemove, children }: { label: string; onRemove: () => void; children?: ReactNode }) {
  return (
    <span title={label} className="inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md bg-muted pl-2 text-xs pointer-coarse:h-9">
      {children}
      <span className="truncate">{label}</span>
      <button
        type="button"
        data-chip-action
        aria-label={`Remove filter: ${label}`}
        title="Remove filter"
        onClick={onRemove}
        className="-ml-1.5 flex h-full shrink-0 items-center rounded-r-md px-1.5 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset pointer-coarse:px-3"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

function LabelDot({ color }: { color?: string }) {
  return <span className="size-2 shrink-0 rounded-full bg-muted-foreground" style={color ? { background: color } : undefined} />;
}

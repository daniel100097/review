import { ListSkeleton, Page, QueryError, useSource } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { routes } from "@/lib/routes";
import { trpc } from "@/lib/trpc";
import { cn, timeAgo } from "@/lib/utils";
import type { PullQuery, PullState, PullSummary } from "@/server/providers/types";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { MessageSquare, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "wouter";

export const stateBadge: Record<PullState, string> = {
  open: "bg-green-600 text-white",
  merged: "bg-purple-600 text-white",
  closed: "bg-red-600 text-white",
};

const states: PullQuery["state"][] = ["open", "merged", "closed", "all"];
const sortLabels: Record<PullQuery["sort"], string> = {
  updated: "Recently updated",
  newest: "Newest",
  oldest: "Oldest",
};
/** Radix Select can't use an empty value, so "no label filter" gets a sentinel. */
const anyLabel = "__any";

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
  const setFilters = (changes: Partial<Record<"state" | "q" | "author" | "label" | "sort", string>>, replace = false) =>
    setParams(
      prev => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace },
    );

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
  const mine = source && filters.author === source.username;

  return (
    <Page crumbs={[{ label: source?.host ?? "…", href: routes.source(sourceId) }, { label: repo }]}>
      <div className="mx-auto max-w-6xl space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-64 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              onKeyDown={e => e.key === "Escape" && setSearchText("")}
              aria-label="Search pull requests"
              placeholder="Search titles and descriptions, or #number"
              className="pr-10 pl-8"
            />
            <kbd className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded border px-1.5 font-mono text-xs text-muted-foreground">
              /
            </kbd>
          </div>
          <Tabs value={filters.state} onValueChange={state => setFilters({ state: state === "open" ? "" : state })}>
            <TabsList>
              {states.map(state => (
                <TabsTrigger key={state} value={state} className="capitalize">
                  {state}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            list="pull-authors"
            value={filters.author}
            onChange={e => setFilters({ author: e.target.value.trim() }, true)}
            placeholder="Author"
            aria-label="Author"
            className="h-8 w-44"
          />
          <datalist id="pull-authors">
            {authors.map(author => (
              <option key={author} value={author} />
            ))}
          </datalist>
          {source && (
            <Button
              variant={mine ? "secondary" : "outline"}
              size="sm"
              aria-pressed={Boolean(mine)}
              onClick={() => setFilters({ author: mine ? "" : source.username })}
            >
              Mine
            </Button>
          )}
          <Select value={filters.label || anyLabel} onValueChange={v => setFilters({ label: v === anyLabel ? "" : v })}>
            <SelectTrigger size="sm" className="w-48" aria-label="Label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={anyLabel}>Any label</SelectItem>
              {labels.data?.map(label => (
                <SelectItem key={label.name} value={label.name}>
                  <LabelDot color={label.color} />
                  {label.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filters.sort} onValueChange={sort => setFilters({ sort: sort === "updated" ? "" : sort })}>
            <SelectTrigger size="sm" className="w-44" aria-label="Sort">
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
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchText("");
                setFilters({ q: "", author: "", label: "" });
              }}
            >
              <X /> Clear filters
            </Button>
          )}
          <span role="status" className="ml-auto text-xs text-muted-foreground">
            {pulls.isFetching && !pulls.isFetchingNextPage ? "Loading…" : pulls.data && `${items.length} shown`}
          </span>
        </div>

        {pulls.error ? (
          <QueryError error={pulls.error} />
        ) : !pulls.data ? (
          <ListSkeleton />
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {filtered ? "No pull requests match these filters." : "No pull requests."}
          </p>
        ) : (
          <ul className={cn("divide-y rounded-lg border transition-opacity", pulls.isPlaceholderData && "opacity-60")}>
            {items.map(pull => (
              <li key={pull.number}>
                <Link href={routes.pull(sourceId, repo, pull.number)} className="flex gap-3 px-4 py-3 hover:bg-muted/50">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={stateBadge[pull.state]}>{pull.state}</Badge>
                      {pull.draft && <Badge variant="outline">draft</Badge>}
                      <span className="font-medium">{pull.title}</span>
                      {pull.labels.map(label => (
                        <Badge key={label.name} variant="outline" className="font-normal">
                          <LabelDot color={label.color || labelColor(label.name)} />
                          {label.name}
                        </Badge>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      #{pull.number} by {pull.author.name}
                      {pull.sourceBranch && (
                        <>
                          {" · "}
                          <code>{pull.sourceBranch}</code> → <code>{pull.targetBranch}</code>
                        </>
                      )}
                      {" · "}
                      opened {timeAgo(pull.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
                    <span>updated {timeAgo(pull.updatedAt)}</span>
                    {pull.comments > 0 && (
                      <span className="flex items-center gap-1">
                        <MessageSquare className="size-3.5" /> {pull.comments}
                      </span>
                    )}
                  </div>
                </Link>
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

function LabelDot({ color }: { color?: string }) {
  return <span className="size-2 shrink-0 rounded-full bg-muted-foreground" style={color ? { background: color } : undefined} />;
}

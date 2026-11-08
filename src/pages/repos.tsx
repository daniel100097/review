import { EmptyState, ListSkeleton, Page, QueryError, useSource } from "@/components/page";
import { Input } from "@/components/ui/input";
import { routes } from "@/lib/routes";
import { trpc } from "@/lib/trpc";
import { timeAgo } from "@/lib/utils";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "wouter";

export function ReposPage({ sourceId }: { sourceId: number }) {
  const source = useSource(sourceId);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timeout = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const repos = useQuery({
    ...trpc.repos.list.queryOptions({ sourceId, search: query }),
    placeholderData: keepPreviousData,
  });

  return (
    <Page crumbs={[{ label: source?.host ?? "…" }]}>
      <h1 className="sr-only">Repositories — {source?.host ?? "…"}</h1>
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search repositories"
            placeholder="Search repositories"
            className="pl-8"
            autoFocus
          />
        </div>
        {repos.error ? (
          <QueryError error={repos.error} />
        ) : !repos.data ? (
          <ListSkeleton />
        ) : repos.data.length === 0 ? (
          <EmptyState>No repositories found.</EmptyState>
        ) : (
          <ul className="divide-y overflow-hidden rounded-lg border">
            {repos.data.map(repo => {
              const slash = repo.path.lastIndexOf("/") + 1;
              return (
                <li key={repo.path}>
                  <Link
                    href={routes.repo(sourceId, repo.path)}
                    className="flex flex-col gap-0.5 px-4 py-3 outline-none hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:flex-row sm:items-baseline sm:gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm [overflow-wrap:anywhere]">
                        <span className="text-muted-foreground">{repo.path.slice(0, slash)}</span>
                        <span className="font-medium">{repo.path.slice(slash)}</span>
                      </p>
                      {repo.description && (
                        <p className="truncate text-sm text-muted-foreground" title={repo.description}>
                          {repo.description}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">updated {timeAgo(repo.updatedAt)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Page>
  );
}

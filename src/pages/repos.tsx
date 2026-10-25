import { ListSkeleton, Page, QueryError, useSource } from "@/components/page";
import { Input } from "@/components/ui/input";
import { routes } from "@/lib/routes";
import { trpc } from "@/lib/trpc";
import { timeAgo } from "@/lib/utils";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
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
      <div className="mx-auto max-w-4xl space-y-4">
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search repositories" autoFocus />
        {repos.error ? (
          <QueryError error={repos.error} />
        ) : !repos.data ? (
          <ListSkeleton />
        ) : repos.data.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">No repositories found.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {repos.data.map(repo => (
              <li key={repo.path}>
                <Link href={routes.repo(sourceId, repo.path)} className="block px-4 py-3 hover:bg-muted/50">
                  <div className="flex items-baseline gap-3">
                    <span className="font-medium">{repo.path}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{timeAgo(repo.updatedAt)}</span>
                  </div>
                  {repo.description && <p className="truncate text-sm text-muted-foreground">{repo.description}</p>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Page>
  );
}

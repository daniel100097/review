import { ListSkeleton, Page, QueryError } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { routes } from "@/lib/routes";
import { queryClient, trpc } from "@/lib/trpc";
import type { ProviderKind } from "@/server/providers/types";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

const kinds: Record<ProviderKind, { label: string; placeholder: string }> = {
  gitlab: { label: "GitLab (glab)", placeholder: "gitlab.com" },
  forgejo: { label: "Forgejo (fj)", placeholder: "codeberg.org" },
};

export function SourcesPage() {
  const sources = useQuery(trpc.sources.list.queryOptions());
  const [kind, setKind] = useState<ProviderKind>("gitlab");
  const [host, setHost] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: trpc.sources.list.queryKey() });
  const add = useMutation(
    trpc.sources.add.mutationOptions({
      onSuccess: () => {
        setHost("");
        invalidate();
      },
    }),
  );
  const remove = useMutation(trpc.sources.remove.mutationOptions({ onSuccess: invalidate }));

  return (
    <Page crumbs={[]}>
      <div className="mx-auto max-w-3xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Add a source</CardTitle>
            <CardDescription>
              Uses your existing forge login. Log in first with <code>glab auth login</code> or{" "}
              <code>fj auth login</code>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex gap-2"
              onSubmit={e => {
                e.preventDefault();
                add.mutate({ kind, host });
              }}
            >
              <Select value={kind} onValueChange={v => setKind(v as ProviderKind)}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(kinds).map(([value, { label }]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input value={host} onChange={e => setHost(e.target.value)} placeholder={kinds[kind].placeholder} />
              <Button type="submit" disabled={add.isPending || !host.trim()}>
                {add.isPending ? "Checking…" : "Add"}
              </Button>
            </form>
            {add.error && <p className="mt-2 text-sm text-destructive">{add.error.message}</p>}
          </CardContent>
        </Card>

        {sources.error ? (
          <QueryError error={sources.error} />
        ) : !sources.data ? (
          <ListSkeleton rows={2} />
        ) : sources.data.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">No sources yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {sources.data.map(source => (
              <li key={source.id} className="flex items-center gap-3 px-4 py-3">
                <Badge variant="secondary">{source.kind}</Badge>
                <Link href={routes.source(source.id)} className="font-medium hover:underline">
                  {source.host}
                </Link>
                <span className="text-sm text-muted-foreground">@{source.username}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto"
                  aria-label="Remove source"
                  onClick={() => remove.mutate({ id: source.id })}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Page>
  );
}

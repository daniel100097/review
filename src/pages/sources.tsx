import { ListSkeleton, Page, QueryError } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { routes } from "@/lib/routes";
import { queryClient, trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import type { ProviderKind } from "@/server/providers/types";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "wouter";

const kinds: Record<ProviderKind, { name: string; cli: string; placeholder: string }> = {
  gitlab: { name: "GitLab", cli: "glab", placeholder: "gitlab.com" },
  forgejo: { name: "Forgejo", cli: "fj", placeholder: "codeberg.org" },
};

export function SourcesPage() {
  const sources = useQuery(trpc.sources.list.queryOptions());
  const [kind, setKind] = useState<ProviderKind>("gitlab");
  const [host, setHost] = useState("");
  const [adding, setAdding] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: trpc.sources.list.queryKey() });
  const add = useMutation(
    trpc.sources.add.mutationOptions({
      onSuccess: () => {
        setHost("");
        setAdding(false);
        invalidate();
      },
    }),
  );
  const remove = useMutation(trpc.sources.remove.mutationOptions({ onSuccess: invalidate }));
  // With nothing to list, adding a source is the only thing to do here.
  const empty = sources.data?.length === 0;

  return (
    <Page crumbs={[]}>
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Sources</h1>
          <p className="text-sm text-muted-foreground">
            Forge accounts using your local <code>glab</code> / <code>fj</code> login.
          </p>
        </div>

        {sources.error ? (
          <QueryError error={sources.error} />
        ) : !sources.data ? (
          <ListSkeleton rows={2} />
        ) : (
          !empty && (
            <ul className="divide-y overflow-hidden rounded-lg border">
              {sources.data.map(source => (
                // The host link covers the whole row; the remove button sits above it.
                <li key={source.id} className="relative flex items-center gap-3 py-2 pr-2 pl-4 has-[a:hover]:bg-accent/50">
                  {/* On phones the forge moves next to the username, leaving the host room for "Remove?". */}
                  <span className="w-14 shrink-0 text-xs text-muted-foreground max-sm:hidden">{kinds[source.kind].name}</span>
                  <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 text-sm [overflow-wrap:anywhere]">
                    <Link
                      href={routes.source(source.id)}
                      className="min-w-0 font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
                    >
                      {source.host}
                    </Link>
                    <span className="min-w-0 text-muted-foreground">
                      @{source.username}
                      <span className="sm:hidden"> · {kinds[source.kind].name}</span>
                    </span>
                  </div>
                  <RemoveButton
                    host={source.host}
                    pending={remove.isPending && remove.variables?.id === source.id}
                    onConfirm={() => remove.mutate({ id: source.id })}
                  />
                </li>
              ))}
            </ul>
          )
        )}

        {adding || empty ? (
          <form
            className="space-y-2"
            onSubmit={e => {
              e.preventDefault();
              add.mutate({ kind, host });
            }}
          >
            <h2 className="text-sm font-medium">Add a source</h2>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select value={kind} onValueChange={v => setKind(v as ProviderKind)}>
                <SelectTrigger className="w-full sm:w-44 sm:shrink-0" aria-label="Forge">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(kinds).map(([value, { name, cli }]) => (
                    <SelectItem key={value} value={value}>
                      {name} ({cli})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={host}
                onChange={e => setHost(e.target.value)}
                placeholder={kinds[kind].placeholder}
                aria-label="Host"
                autoFocus={adding}
              />
              <div className="flex gap-2">
                <Button type="submit" className="flex-1 sm:flex-none" disabled={add.isPending || !host.trim()}>
                  {add.isPending ? "Checking…" : "Add"}
                </Button>
                {!empty && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setAdding(false);
                      setHost("");
                      add.reset();
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </div>
            {add.error && <p className="text-sm text-destructive [overflow-wrap:anywhere]">{add.error.message}</p>}
            <p className="text-xs text-muted-foreground">
              Log in first with <code>glab auth login</code> or <code>fj auth login</code>.
            </p>
          </form>
        ) : (
          <Button variant="ghost" size="sm" className="-ml-2.5 text-muted-foreground" onClick={() => setAdding(true)}>
            <Plus /> Add source
          </Button>
        )}
      </div>
    </Page>
  );
}

/** One stray click shouldn't remove a source: the first click asks, a second within 3s (without leaving the button) confirms. */
function RemoveButton({ host, pending, onConfirm }: { host: string; pending: boolean; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timeout = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timeout);
  }, [armed]);
  // Same element in both states, so keyboard focus stays on it.
  return (
    <Button
      variant="ghost"
      size={armed ? "sm" : "icon-sm"}
      aria-label={armed ? `Confirm removing ${host}` : `Remove ${host}`}
      title={armed ? undefined : `Remove ${host}`}
      disabled={pending}
      className={cn("relative z-10 shrink-0", armed ? "text-destructive hover:text-destructive" : "text-muted-foreground hover:text-foreground")}
      onClick={() => (armed ? onConfirm() : setArmed(true))}
      onBlur={() => setArmed(false)}
    >
      {armed ? "Remove?" : <Trash2 />}
    </Button>
  );
}

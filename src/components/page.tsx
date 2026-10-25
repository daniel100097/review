import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { isDark, toggleTheme } from "@/lib/theme";
import { trpc } from "@/lib/trpc";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, GitPullRequest, Moon, Sun } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { Link } from "wouter";

export interface Crumb {
  label: string;
  href?: string;
}

export function Page({ crumbs, actions, children }: { crumbs: Crumb[]; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b bg-background/95 px-4 text-sm backdrop-blur">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold">
          <GitPullRequest className="size-4" />
          codereview
        </Link>
        {crumbs.map(crumb => (
          <Fragment key={crumb.label}>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            {crumb.href ? (
              <Link href={crumb.href} className="truncate text-muted-foreground hover:text-foreground">
                {crumb.label}
              </Link>
            ) : (
              <span className="truncate">{crumb.label}</span>
            )}
          </Fragment>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {actions}
          <ThemeToggle />
        </div>
      </header>
      <main className="p-4">{children}</main>
    </div>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(isDark);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => {
        toggleTheme();
        setDark(isDark());
      }}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}

export function QueryError({ error }: { error: { message: string } }) {
  return (
    <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
      {error.message}
    </div>
  );
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-14" />
      ))}
    </div>
  );
}

export function useSource(sourceId: number) {
  return useQuery({ ...trpc.sources.list.queryOptions(), select: list => list.find(s => s.id === sourceId) }).data;
}

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
        <Link href="/" aria-label="codereview home" className="flex shrink-0 items-center gap-2 font-semibold">
          <GitPullRequest className="size-4" />
          <span className="hidden sm:inline">codereview</span>
        </Link>
        {crumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1 sm:gap-2">
            {crumbs.map(crumb => (
              <Fragment key={crumb.label}>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                {crumb.href ? (
                  <Link href={crumb.href} title={crumb.label} className="min-w-8 truncate text-muted-foreground hover:text-foreground">
                    {crumb.label}
                  </Link>
                ) : (
                  <span title={crumb.label} className="min-w-8 truncate">{crumb.label}</span>
                )}
              </Fragment>
            ))}
          </nav>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <div className="hidden items-center gap-2 lg:flex">{actions}</div>
          <ThemeToggle />
        </div>
      </header>
      {actions && <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 lg:hidden">{actions}</div>}
      <main className="min-w-0 p-4">{children}</main>
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
    <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive [overflow-wrap:anywhere]">
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

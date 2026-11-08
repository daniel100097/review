import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { isDark, toggleTheme } from "@/lib/theme";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, GitPullRequest, Moon, Sun } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { Link } from "wouter";

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * The app shell: a 48px sticky header (diff rows and file headers stick below it) and the page.
 * `actions` sit at the right of the header on every screen size, so keep them few and compact.
 * `wide` lets the page use the full window width (the pull request page); otherwise content is centered.
 */
export function Page({
  crumbs,
  actions,
  wide,
  children,
}: {
  crumbs: Crumb[];
  actions?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 flex h-12 items-center gap-1.5 border-b bg-background pr-[max(0.75rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))] text-sm sm:pr-[max(1rem,env(safe-area-inset-right))] sm:pl-[max(1rem,env(safe-area-inset-left))]">
        <Link
          href="/"
          aria-label="codereview home"
          className="-ml-1 flex shrink-0 items-center gap-2 rounded-md px-1.5 py-1 font-semibold tracking-tight hover:bg-accent pointer-coarse:px-2.5 pointer-coarse:py-2"
        >
          <GitPullRequest className="size-4" />
          <span className={cn(crumbs.length > 0 && "hidden md:inline")}>codereview</span>
        </Link>
        {crumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1">
            {crumbs.map((crumb, i) => (
              // On phones only the last two crumbs fit; earlier ones are reachable through them.
              <Fragment key={crumb.label}>
                <ChevronRight
                  aria-hidden
                  className={cn("size-3.5 shrink-0 text-muted-foreground/60", i < crumbs.length - 2 && "hidden md:block")}
                />
                {crumb.href ? (
                  <Link
                    href={crumb.href}
                    title={crumb.label}
                    className={cn(
                      // Parent crumbs give up their width before the current one does.
                      "min-w-8 shrink-[10] truncate rounded px-1 text-muted-foreground hover:text-foreground pointer-coarse:py-2",
                      i < crumbs.length - 2 && "hidden md:inline",
                    )}
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span aria-current="page" title={crumb.label} className="max-w-[60%] min-w-8 shrink-0 truncate px-1 font-medium">
                    {crumb.label}
                  </span>
                )}
              </Fragment>
            ))}
          </nav>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {actions}
          <ThemeToggle />
        </div>
      </header>
      <main className={cn("min-w-0 px-[max(0.75rem,env(safe-area-inset-left))] py-4 sm:px-4 sm:py-6", !wide && "mx-auto max-w-5xl")}>{children}</main>
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
      title={dark ? "Light mode" : "Dark mode"}
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
    <div
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive [overflow-wrap:anywhere]"
    >
      {error.message}
    </div>
  );
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y overflow-hidden rounded-lg border">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="space-y-2 px-4 py-3">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      ))}
    </div>
  );
}

/** A quiet centered message for empty lists. */
export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="px-4 py-12 text-center text-sm text-muted-foreground">{children}</p>;
}

export function useSource(sourceId: number) {
  return useQuery({ ...trpc.sources.list.queryOptions(), select: list => list.find(s => s.id === sourceId) }).data;
}

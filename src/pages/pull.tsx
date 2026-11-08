import { CommentForm, CommentItem } from "@/components/comment";
import { DiffList, type File } from "@/components/diff-list";
import { FilterRulesPanel, useFilterRules } from "@/components/filter-rules";
import { FilterProfilesPanel, useFilterProfiles } from "@/components/filter-profiles";
import { FlowmarkPanel, useFlowmark } from "@/components/flowmark";
import { Markdown } from "@/components/markdown";
import type { QuestionActions, QuestionThread } from "@/components/question-thread";
import { GroupList, WalkthroughPanel } from "@/components/walkthrough";
import { ContributorList, type ContributorFilter } from "@/components/contributors";
import { buildTree, FileTree, treeOrder } from "@/components/file-tree";
import { EmptyState, ListSkeleton, Page, QueryError, useSource } from "@/components/page";
import { PullStateBadge } from "@/components/pull-state";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AgentModel } from "@/lib/agents";
import type { CompiledFilterRules } from "@/lib/filter-rules";
import { isInHiddenFolder, isTestOrGenerated } from "@/lib/hidden-files";
import { changeView, parse } from "@/lib/parsed-file";
import { routes } from "@/lib/routes";
import { useReviewFilters } from "@/lib/review-filters";
import { queryClient, trpc } from "@/lib/trpc";
import { timeAgo } from "@/lib/utils";
import type { LinePosition } from "@/server/providers/types";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, Eye, ListFilter, PanelLeft, RotateCcw, Search, WrapText, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";

/** Where the Filters popover opens from: the toolbar, or the Filters icon in the sidebar or the mobile drawer. */
type FiltersAt = "toolbar" | "sidebar" | "drawer";

export function PullPage({ sourceId, repo, number }: { sourceId: number; repo: string; number: number }) {
  const source = useSource(sourceId);
  const input = { sourceId, repo, number };
  const pull = useQuery(trpc.pulls.get.queryOptions(input));
  const files = useQuery(trpc.pulls.files.queryOptions(input));
  const comments = useQuery(trpc.pulls.comments.queryOptions(input));
  const reviewFilters = useReviewFilters();
  const commentsHidden = reviewFilters.hideReviewComments;
  const visibleComments = useMemo(() => commentsHidden ? [] : comments.data ?? [], [commentsHidden, comments.data]);
  const toggleComments = () => reviewFilters.setToggle("hideReviewComments", !commentsHidden);

  const addComment = useMutation(
    trpc.pulls.addComment.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.pulls.comments.queryKey(input) }),
    }),
  );
  const comment = (body: string, position?: LinePosition) => addComment.mutateAsync({ ...input, body, position });
  const questions = useQuestions(input);

  const setViewed = useMutation(
    trpc.pulls.setViewed.mutationOptions({
      onMutate: ({ path, viewed }) =>
        queryClient.setQueryData(trpc.pulls.files.queryKey(input), old =>
          old?.map(f => (f.newPath === path ? { ...f, viewed } : f)),
        ),
      onError: () => queryClient.invalidateQueries({ queryKey: trpc.pulls.files.queryKey(input) }),
    }),
  );

  // Memoized: the diff list rebuilds its rows whenever this array changes.
  const inline = useMemo(() => visibleComments.filter(c => c.position), [visibleComments]);
  const [tab, setTab] = useState("files");
  const flowmark = useFlowmark(input, tab === "flowmark");
  const [wrapLines, setWrapLines] = useState(() => localStorage.diffWrapLines !== "false");
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [filtersAt, setFiltersAt] = useState<FiltersAt>();
  const [rulesOpen, setRulesOpen] = useState(false);
  const filtersButton = useRef<HTMLButtonElement>(null);
  const sidebarFiltersButton = useRef<HTMLButtonElement>(null);
  const emptyFilesButton = useRef<HTMLButtonElement>(null);
  // The rules sheet returns focus to whatever opened it, if that's still there.
  const rulesReturn = useRef<HTMLElement | null>(null);
  // Set when something else takes focus as a sheet closes (find's input, a jumped-to file header).
  const keepFocus = useRef({ drawer: false, rules: false });
  const [currentPath, setCurrentPath] = useState<string>();
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => { if (desktop.matches) setNavigationOpen(false); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);
  const [jumpTo, setJumpTo] = useState<{ path?: string; group?: number; key: number }>();
  // Set when the drawer's Find is pressed: find opens once the drawer is gone, so Escape returns to its Files button.
  const findAfterDrawer = useRef(false);
  const byContributor = useContributorFilter(input, reviewFilters.by);
  const filterKey = `${sourceId}:${repo}:${number}`;
  const filters = useFilterRules(reviewFilters);
  const profiles = useFilterProfiles({ sourceId, repo }, reviewFilters, filters);
  const hiding = useHiddenFiles(files.data, reviewFilters, byContributor.only, filters.compiled);
  const walkthrough = useWalkthrough(input);
  const groups = walkthrough.latest?.result?.groups;
  const [sidebar, setSidebar] = useState<string>(() => localStorage.pullSidebar ?? "groups");
  const toggleSidebar = (view: string) => {
    localStorage.pullSidebar = view;
    setSidebar(view);
  };
  // In the Groups view the diff follows the walkthrough's reading order; files it doesn't mention come last.
  const ordered = useMemo(() => {
    if (!groups || sidebar !== "groups") return hiding.visible;
    const rank = new Map(groups.flatMap((g, i) => g.files.map((path, j) => [path, i * 10_000 + j] as const)));
    return hiding.visible.toSorted((a, b) => (rank.get(a.newPath) ?? Infinity) - (rank.get(b.newPath) ?? Infinity));
  }, [groups, sidebar, hiding.visible]);
  const viewedCount = hiding.visible.filter(f => f.viewed).length;
  const hiddenCount = (files.data?.length ?? 0) - hiding.visible.length;
  // The diff remounts when it comes back (from another tab, or after filters hid every file); a jump it already
  // made mustn't replay then, scrolling and taking focus. A comment's link sets the tab and the jump together.
  const diffGone = tab !== "files" || (!!files.data && hiding.visible.length === 0);
  useEffect(() => { if (diffGone) setJumpTo(undefined); }, [diffGone]);
  const jump = (to: { path?: string; group?: number }) => {
    setJumpTo({ ...to, key: Date.now() });
    // The diff focuses the file it jumps to.
    if (navigationOpen) keepFocus.current.drawer = true;
    setNavigationOpen(false);
  };
  const openRules = (returnTo: HTMLElement | null) => {
    rulesReturn.current = returnTo;
    setFiltersAt(undefined);
    setRulesOpen(true);
  };

  const ruleCount = filters.rules?.rules.length ?? 0;
  const pauseRules = () => filters.save(filters.rules, !filters.enabled);
  const contributorName = byContributor.contributors.find(c => c.key === reviewFilters.by)?.name ?? reviewFilters.by;
  const folderCount = hiding.hiddenFolders.length;
  // Each active filter as a chip whose ✕ undoes just that filter.
  const chips = [
    hiding.hideTests && { key: "tests", label: "No tests & generated", remove: hiding.toggleTests },
    hiding.hideComments && { key: "comments", label: "No comment-only changes", remove: hiding.toggleComments },
    commentsHidden && { key: "review", label: "No review comments", remove: toggleComments },
    reviewFilters.by && { key: "by", label: `By ${contributorName}`, remove: () => reviewFilters.setContributor(undefined) },
    folderCount > 0 && {
      key: "folders",
      label: `${folderCount} ${folderCount === 1 ? "folder" : "folders"} hidden`,
      title: hiding.hiddenFolders.join("\n"),
      remove: reviewFilters.clearFolders,
    },
    filters.enabled && {
      key: "rules",
      label: `${ruleCount} custom ${ruleCount === 1 ? "rule" : "rules"}`,
      remove: pauseRules,
      removeLabel: "Pause custom rules",
    },
  ].filter(chip => !!chip);
  const rulesPaused = Boolean(filters.rules && !filters.enabled);
  // Every button in the chip strip, in order: chips' ✕, then "Rules paused · Enable" and "Invalid custom rules".
  const chipKeys = [...chips.map(chip => chip.key), rulesPaused && "paused", filters.error && "invalid"].filter(key => !!key);

  // A chip's button removes the chip; focus then moves to the next one (or the Filters button) instead of <body>.
  const chipBar = useRef<HTMLDivElement>(null);
  const removedChip = useRef<{ key: string; index: number }>(undefined);
  const removeChip = (key: string, remove: () => void) => {
    removedChip.current = { key, index: chipKeys.indexOf(key) };
    remove();
  };
  useLayoutEffect(() => {
    const removed = removedChip.current;
    if (!removed || chipKeys.includes(removed.key)) return;
    removedChip.current = undefined;
    (chipBar.current?.querySelectorAll<HTMLElement>("[data-chip-action]")[removed.index] ?? filtersButton.current)?.focus();
  });

  const filtersContent = (
    <>
      <div className="space-y-0.5 px-3 py-2">
        {hiding.testCount > 0 && (
          <SwitchRow checked={hiding.hideTests} onChange={hiding.toggleTests}>
            Hide tests & generated <span className="ml-1 text-muted-foreground tabular-nums">{hiding.testCount}</span>
          </SwitchRow>
        )}
        <SwitchRow checked={hiding.hideComments} onChange={hiding.toggleComments}>Hide comment-only changes</SwitchRow>
        <SwitchRow checked={commentsHidden} onChange={hidden => reviewFilters.setToggle("hideReviewComments", hidden)}>
          Hide review comments
        </SwitchRow>
      </div>
      {(byContributor.contributors.length > 1 || byContributor.selected) && (
        <div className="p-3">
          <ContributorList
            contributors={byContributor.contributors}
            selected={byContributor.selected}
            onSelect={reviewFilters.setContributor}
            loading={byContributor.loading}
            error={byContributor.error}
          />
        </div>
      )}
      {folderCount > 0 && (
        <section className="space-y-1 p-3">
          <h2 className="font-medium">Hidden folders</h2>
          <ul>
            {hiding.hiddenFolders.map(path => (
              <li key={path} className="flex items-center gap-2">
                <span title={path} className="min-w-0 flex-1 truncate font-mono text-xs">{path}</span>
                <Button variant="ghost" size="xs" aria-label={`Show ${path}`} title={`Show ${path}`}
                  onClick={() => hiding.setFolderHidden(path, false)}>
                  <Eye /> Show
                </Button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Hide more with the eye icon next to a folder in the file tree.</p>
        </section>
      )}
      <section className="space-y-1 p-3">
        <div className="flex min-h-8 items-center gap-1">
          <h2 className="font-medium">Custom rules</h2>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {filters.error ? "· invalid" : filters.enabled ? `· ${ruleCount} active` : filters.rules ? "· paused" : "· none"}
          </span>
          {filters.rules && (
            <Button variant="ghost" size="xs" onClick={pauseRules}>{filters.enabled ? "Pause" : "Enable"}</Button>
          )}
          <Button
            variant="outline"
            size="xs"
            onClick={() => {
              if (filtersAt !== "drawer") return openRules(filtersAt === "sidebar" ? sidebarFiltersButton.current : filtersButton.current);
              // The drawer closes so the sheet isn't stacked on it; focus then returns to the bottom bar.
              keepFocus.current.drawer = true;
              setNavigationOpen(false);
              openRules(document.getElementById("diff-files-button"));
            }}
          >
            Edit rules…
          </Button>
        </div>
        {filters.error && <p className="text-xs text-destructive">{filters.error}</p>}
      </section>
      <div className="p-3">
        <FilterProfilesPanel profiles={profiles} />
      </div>
      <div className="p-2">
        {/* Closing returns focus to the trigger; it would fall to <body> as this button disables itself. */}
        <Button variant="ghost" size="sm" className="text-[13px]" disabled={!reviewFilters.hasFilters}
          onClick={() => { reviewFilters.reset(); setFiltersAt(undefined); }}>
          <RotateCcw /> Reset filters
        </Button>
      </div>
    </>
  );
  // The same panel opens from each trigger; only one is open at a time. In the drawer it's modal so it can scroll
  // (the drawer blocks scrolling everywhere outside itself otherwise).
  const filtersPopover = (at: FiltersAt, trigger: ReactElement) => (
    <Popover open={filtersAt === at} onOpenChange={open => setFiltersAt(current => open ? at : current === at ? undefined : current)} modal={at === "drawer"}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      {/* From the sidebar's icon it opens over the sidebar rather than the diff. */}
      <PopoverContent align={at === "toolbar" ? "start" : "end"} className="divide-y p-0 text-[13px]" aria-label="Review filters">
        {filtersContent}
      </PopoverContent>
    </Popover>
  );

  // The desktop sidebar and the mobile drawer show the same navigation; only the hint differs.
  const navigation = (drawer: boolean) => (
    <>
      {!drawer && (
        // The tree has a tab stop per row; this skips past all of them.
        <button
          type="button"
          onClick={() => document.querySelector<HTMLElement>('[aria-label="Code diff"]')?.focus()}
          className="sr-only rounded-md text-[13px] font-medium outline-none focus:not-sr-only focus:px-2 focus:py-1.5 focus-visible:ring-2 focus-visible:ring-ring"
        >
          Skip to diff
        </button>
      )}
      <div className="shrink-0 space-y-1.5 text-[13px] tabular-nums">
        {/* Filters and Find stay at hand mid-review: the toolbar above the diff scrolls away, the sidebar doesn't. */}
        <div className="flex h-8 items-center gap-1 pointer-coarse:h-9">
          <p className="min-w-0 flex-1 truncate">
            <span className="font-medium">{viewedCount} of {hiding.visible.length} viewed</span>
            {hiddenCount > 0 && <span className="text-muted-foreground"> · {hiddenCount} hidden</span>}
          </p>
          {filtersPopover(drawer ? "drawer" : "sidebar", (
            <Button
              ref={drawer ? undefined : sidebarFiltersButton}
              variant="ghost"
              size="sm"
              aria-label={chips.length ? `Filters, ${chips.length} active` : "Filters"}
              title="Filters"
              className="gap-1 px-2 text-muted-foreground has-[>svg]:px-2 pointer-coarse:min-w-9"
            >
              <ListFilter />
              {chips.length > 0 && <span className="text-xs tabular-nums">{chips.length}</span>}
            </Button>
          ))}
          {hiding.visible.length > 0 && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Find in diff"
              aria-keyshortcuts="Control+F"
              title="Find in diff (Ctrl+F)"
              className="text-muted-foreground"
              onClick={() => {
                if (!drawer) return window.dispatchEvent(new Event("diff:find"));
                findAfterDrawer.current = true;
                setNavigationOpen(false);
              }}
            >
              <Search />
            </Button>
          )}
        </div>
        <div aria-hidden className="h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-success transition-[width]"
            style={{ width: `${hiding.visible.length ? (viewedCount / hiding.visible.length) * 100 : 0}%` }}
          />
        </div>
      </div>
      {groups && (
        <div
          role="group"
          aria-label="Sidebar view"
          title="Groups follow the walkthrough's reading order and reorder the diff to match. Tree keeps folder order."
          className="flex shrink-0 rounded-lg bg-muted p-[3px] text-[13px] font-medium"
        >
          {([["files", "Tree"], ["groups", "Groups"]] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={sidebar === value}
              onClick={() => toggleSidebar(value)}
              className="h-7 flex-1 rounded-md border border-transparent text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm dark:aria-pressed:border-input dark:aria-pressed:bg-input/30 dark:aria-pressed:text-foreground pointer-coarse:h-8"
            >
              {label}
              {value === "groups" && (
                <>
                  <span aria-hidden className="ml-1 text-muted-foreground tabular-nums">{groups.length}</span>
                  <span className="sr-only">, {groups.length} groups</span>
                </>
              )}
            </button>
          ))}
        </div>
      )}
      {/* The sidebar scrolls only the list, so progress and hints stay put; the drawer scrolls as a whole. */}
      <div className={drawer ? "min-w-0" : "-mx-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1"}>
        {groups && sidebar === "groups" ? (
          <GroupList
            groups={groups}
            files={new Map(hiding.visible.map(f => [f.newPath, f]))}
            current={currentPath}
            onSelectGroup={group => jump({ group })}
            onSelectFile={path => jump({ path })}
          />
        ) : (
          <FileTree
            tree={hiding.tree}
            hiddenFolders={hiding.hiddenFolders}
            visiblePaths={hiding.visiblePaths}
            current={currentPath}
            onFolderHiddenChange={hiding.setFolderHidden}
            onSelect={path => jump({ path })}
          />
        )}
      </div>
      {drawer ? (
        <p className="shrink-0 text-xs text-muted-foreground">Tap a line number to ask or comment.</p>
      ) : (
        <p className="shrink-0 text-xs leading-5 text-balance text-muted-foreground">
          <kbd>j</kbd>/<kbd>k</kbd> files{groups && <> · <kbd>]</kbd>/<kbd>[</kbd> groups</>} · <kbd>n</kbd> next
          unviewed · <kbd>v</kbd> viewed
        </p>
      )}
    </>
  );

  return (
    <Page
      wide
      crumbs={[
        { label: source?.host ?? "…", href: routes.source(sourceId) },
        { label: repo, href: routes.repo(sourceId, repo) },
        { label: `#${number}` },
      ]}
      actions={
        pull.data && (
          <Button variant="ghost" size="sm" className="max-sm:w-9" asChild>
            <a href={pull.data.url} target="_blank" rel="noreferrer" title={`Open on ${source?.host ?? "the forge"}`}>
              <span className="max-sm:sr-only">Open</span> <ExternalLink />
            </a>
          </Button>
        )
      }
    >
      {pull.error ? (
        <QueryError error={pull.error} />
      ) : !pull.data ? (
        <div className="space-y-2.5" aria-busy="true" aria-label="Loading pull request">
          <Skeleton className="h-7 w-full max-w-xl" />
          <Skeleton className="h-5 w-2/3 max-w-sm" />
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight [overflow-wrap:anywhere]">
              {pull.data.title} <span className="font-normal text-muted-foreground">#{number}</span>
            </h1>
            {/* Each item brings its own leading "·"; the row is pulled left and clipped, so a wrapped line never
                starts or ends with one. */}
            <div className="overflow-hidden text-sm text-muted-foreground">
              <div className="-ml-4 flex flex-wrap items-center gap-y-1">
                {[
                  <PullStateBadge state={pull.data.state} draft={pull.data.draft} />,
                  pull.data.author.name,
                  <>
                    <span title={pull.data.sourceBranch} className="min-w-0 truncate font-mono text-[13px]">{pull.data.sourceBranch}</span>
                    <span aria-hidden className="shrink-0 px-1.5">→</span>
                    <span className="sr-only"> into </span>
                    <span title={pull.data.targetBranch} className="min-w-0 truncate font-mono text-[13px]">{pull.data.targetBranch}</span>
                  </>,
                  `opened ${timeAgo(pull.data.createdAt)}`,
                ].map((item, i) => (
                  <span key={i} className="inline-flex min-w-0 max-w-full items-center">
                    <span aria-hidden className="w-4 shrink-0 text-center">·</span>
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <Tabs value={tab} onValueChange={setTab} className="mt-4 gap-4">
            <TabsList variant="line">
              <TabsTrigger value="conversation">
                Conversation <span className="font-normal text-muted-foreground tabular-nums">{comments.data?.length ?? "…"}</span>
              </TabsTrigger>
              <TabsTrigger
                value="files"
                title={files.data && `${viewedCount} of ${hiding.visible.length} shown files viewed${hiddenCount ? `, ${hiddenCount} hidden by filters` : ""}`}
              >
                Files{" "}
                <span className="font-normal text-muted-foreground tabular-nums">
                  {files.data ? `${viewedCount}/${hiding.visible.length}` : "…"}
                </span>
              </TabsTrigger>
              <TabsTrigger value="flowmark">Flowmark</TabsTrigger>
            </TabsList>

            {/* Kept mounted, so the review's level, mode and scroll survive switching tabs. */}
            <TabsContent value="flowmark" forceMount hidden={tab !== "flowmark"}>
              <FlowmarkPanel flowmark={flowmark} input={input} baseSha={pull.data.baseSha} headSha={pull.data.headSha} active={tab === "flowmark"} />
            </TabsContent>

            <TabsContent value="conversation" className="max-w-3xl space-y-6">
              {pull.data.body ? (
                <Markdown>{pull.data.body}</Markdown>
              ) : (
                <p className="text-sm text-muted-foreground">No description.</p>
              )}
              <div className="space-y-4">
                {/* The same filter as the Files tab's, so comments can be hidden without leaving this tab. */}
                {comments.data && (comments.data.length > 0 || commentsHidden) && (
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-medium tabular-nums">
                      {comments.data.length} {comments.data.length === 1 ? "comment" : "comments"}
                    </h2>
                    <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={toggleComments}>
                      {commentsHidden ? "Show comments" : "Hide comments"}
                    </Button>
                  </div>
                )}
                {commentsHidden ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    Comments are hidden by your filters.{" "}
                    <Button variant="link" className="h-auto p-0 text-foreground underline underline-offset-4" onClick={toggleComments}>
                      Show
                    </Button>
                  </p>
                ) : (
                  comments.error && <QueryError error={comments.error} />
                )}
                {visibleComments
                  .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
                  .map(c => (
                    <CommentItem
                      key={c.id}
                      comment={c}
                      context={
                        c.position && (
                          <button
                            type="button"
                            className="font-mono hover:underline"
                            onClick={() => {
                              setTab("files");
                              setJumpTo({ path: c.position!.path, key: Date.now() });
                            }}
                          >
                            {c.position.path}:{c.position.newLine ?? c.position.oldLine}
                          </button>
                        )
                      }
                    />
                  ))}
              </div>
              <CommentForm onSubmit={body => comment(body)} />
            </TabsContent>

            <TabsContent value="files" forceMount hidden={tab !== "files"}>
              {files.error ? (
                <QueryError error={files.error} />
              ) : !files.data ? (
                <ListSkeleton />
              ) : (
                <div className="grid min-w-0 gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
                  {/* Pulled up so its first row lines up with the toolbar, yet clears the header once it sticks. */}
                  <aside
                    aria-label="Files"
                    className="sticky top-12 -mt-3 hidden h-[calc(100dvh-3rem)] min-w-0 flex-col gap-3 self-start py-3 lg:flex"
                  >
                    {navigation(false)}
                  </aside>
                  <Sheet open={navigationOpen} onOpenChange={setNavigationOpen}>
                    <SheetContent
                      side="left"
                      title="Files"
                      description="Choose a file or group to jump to."
                      className="lg:hidden"
                      onCloseAutoFocus={event => {
                        // Back to the Files button that opened it, unless find's input or the jumped-to file took focus.
                        event.preventDefault();
                        if (!keepFocus.current.drawer) (document.getElementById("diff-files-button") ?? emptyFilesButton.current)?.focus();
                        keepFocus.current.drawer = false;
                        if (findAfterDrawer.current) window.dispatchEvent(new Event("diff:find"));
                        findAfterDrawer.current = false;
                      }}
                    >
                      <nav aria-label="Files" className="flex flex-col gap-3">{navigation(true)}</nav>
                    </SheetContent>
                  </Sheet>
                  <div className="min-w-0 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {filtersPopover("toolbar", (
                        <Button ref={filtersButton} variant="outline" size="sm">
                          <ListFilter /> Filters
                          {chips.length > 0 && (
                            <span className="-mr-1 flex h-5 min-w-5 items-center justify-center rounded-sm bg-muted px-1 text-xs tabular-nums">
                              {chips.length}
                            </span>
                          )}
                        </Button>
                      ))}
                      {chipKeys.length > 0 && (
                        // Below sm the chips scroll sideways in one row instead of pushing the diff down a row each.
                        <div
                          ref={chipBar}
                          className="flex min-w-0 items-center gap-2 max-sm:order-last max-sm:-m-1 max-sm:w-[calc(100%+0.5rem)] max-sm:overflow-x-auto max-sm:p-1 max-sm:[scrollbar-width:none] sm:contents [&::-webkit-scrollbar]:hidden"
                        >
                          {chips.map(chip => (
                            <span key={chip.key} title={"title" in chip ? chip.title : undefined}
                              className="inline-flex h-7 max-w-full min-w-0 shrink-0 items-center rounded-md bg-muted pl-2 text-xs pointer-coarse:h-9">
                              <span className="truncate">{chip.label}</span>
                              <button
                                type="button"
                                data-chip-action
                                aria-label={"removeLabel" in chip ? chip.removeLabel : `Remove filter: ${chip.label}`}
                                title={"removeLabel" in chip ? chip.removeLabel : "Remove filter"}
                                onClick={() => removeChip(chip.key, chip.remove)}
                                className="flex h-full shrink-0 items-center justify-center rounded-r-md px-1.5 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset pointer-coarse:w-9"
                              >
                                <X className="size-3" />
                              </button>
                            </span>
                          ))}
                          {rulesPaused && (
                            <button type="button" data-chip-action title={`Enable ${ruleCount} custom ${ruleCount === 1 ? "rule" : "rules"}`}
                              onClick={() => removeChip("paused", pauseRules)}
                              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-muted px-2 text-xs text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-9">
                              Rules paused <span aria-hidden>·</span> <span className="font-medium text-foreground">Enable</span>
                            </button>
                          )}
                          {filters.error && (
                            <button type="button" data-chip-action title={filters.error} onClick={event => openRules(event.currentTarget)}
                              className="inline-flex h-7 shrink-0 items-center rounded-md bg-destructive/10 px-2 text-xs text-destructive outline-none hover:bg-destructive/15 focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-9">
                              Invalid custom rules
                            </button>
                          )}
                        </div>
                      )}
                      {/* Always present so screen readers announce the error when it appears. */}
                      <span role="alert" className="sr-only">{filters.error && `Invalid custom rules: ${filters.error}`}</span>
                      <div className="ml-auto flex min-w-0 items-center gap-1">
                        <WalkthroughPanel
                          walkthrough={walkthrough.latest}
                          headSha={pull.data.headSha}
                          onStart={walkthrough.start}
                          onCancel={walkthrough.cancel}
                        />
                        {hiding.visible.length > 0 && (
                          // Below lg the diff's bottom bar has its own Find button.
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Find in diff"
                            aria-keyshortcuts="Control+F"
                            title="Find in diff (Ctrl+F)"
                            className="hidden text-muted-foreground lg:inline-flex"
                            onClick={() => window.dispatchEvent(new Event("diff:find"))}
                          >
                            <Search />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Wrap lines"
                          title="Wrap lines"
                          aria-pressed={wrapLines}
                          className="text-muted-foreground aria-pressed:bg-accent aria-pressed:text-foreground"
                          onClick={() => {
                            localStorage.diffWrapLines = String(!wrapLines);
                            setWrapLines(!wrapLines);
                          }}
                        >
                          <WrapText />
                        </Button>
                      </div>
                    </div>
                    <Sheet open={rulesOpen} onOpenChange={setRulesOpen}>
                      <SheetContent
                        side="right"
                        title="Custom filters"
                        onCloseAutoFocus={event => {
                          // Whatever opened the sheet (often a popover that's gone now) gets focus back, unless find took it.
                          event.preventDefault();
                          const target = rulesReturn.current?.isConnected ? rulesReturn.current : filtersButton.current;
                          if (!keepFocus.current.rules) target?.focus();
                          keepFocus.current.rules = false;
                        }}
                      >
                        <FilterRulesPanel key={filterKey} filters={filters} files={files.data} input={input} pull={pull.data} />
                      </SheetContent>
                    </Sheet>
                    {hiding.visible.length > 0 ? tab === "files" && (
                      <div className="-mx-3 sm:mx-0">
                        <DiffList
                          files={ordered}
                          groups={groups && sidebar === "groups" ? groups : undefined}
                          comments={inline}
                          questions={questions.threads}
                          headSha={pull.data.headSha}
                          onComment={comment}
                          onAsk={questions.ask}
                          questionActions={questions.actions}
                          jumpTo={jumpTo}
                          wrapLines={wrapLines}
                          onOpenNavigation={() => setNavigationOpen(true)}
                          onCurrentFileChange={setCurrentPath}
                          onOpenFind={() => {
                            // Find opens over the diff, so the drawer and the rules sheet make way and leave focus to it.
                            keepFocus.current.drawer ||= navigationOpen;
                            keepFocus.current.rules ||= rulesOpen;
                            setNavigationOpen(false);
                            setRulesOpen(false);
                          }}
                          hideCommentChanges={hiding.hideComments}
                          filterRules={filters.compiled}
                          contributor={byContributor.filter}
                          loadFile={path =>
                            queryClient.fetchQuery({
                              ...trpc.repos.file.queryOptions({ sourceId, repo, path, ref: pull.data.headSha }),
                              staleTime: Infinity,
                            })
                          }
                          onViewedChange={(file, viewed) =>
                            setViewed.mutate({ ...input, path: file.newPath, patchHash: file.patchHash, viewed })
                          }
                        />
                      </div>
                    ) : (
                      <EmptyState>
                        {files.data.length ? "Your filters hide every file in this pull request." : "This pull request changes no files."}
                        {/* Without a diff there's no bottom bar, so phones need another way into the file tree. */}
                        <span className="mt-4 flex flex-wrap justify-center gap-2">
                          {files.data.length > 0 && (
                            <Button ref={emptyFilesButton} variant="outline" size="sm" className="lg:hidden" onClick={() => setNavigationOpen(true)}>
                              <PanelLeft /> Files
                            </Button>
                          )}
                          {reviewFilters.hasFilters && (
                            // This empty state goes away with the reset, and focus with it unless it moves.
                            <Button variant="outline" size="sm" onClick={() => { reviewFilters.reset(); filtersButton.current?.focus(); }}>
                              <RotateCcw /> Reset filters
                            </Button>
                          )}
                        </span>
                      </EmptyState>
                    )}
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
    </Page>
  );
}

/** A Filters popover row: the label fills the row and toggles too, so the whole row is the touch target. */
function SwitchRow({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  const id = useId();
  return (
    <div className="flex min-h-8 items-center gap-3 pointer-coarse:min-h-10">
      <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer items-center self-stretch py-1">{children}</label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/**
 * Showing one contributor's changes (`?by=` in the URL). Who committed comes from the forge right away; who changed
 * which line needs git blame in a local clone, so that's only fetched once someone is picked.
 */
function useContributorFilter(input: { sourceId: number; repo: string; number: number }, selected?: string) {
  const contributors = useQuery(trpc.pulls.contributors.queryOptions(input));
  const attribution = useQuery({ ...trpc.pulls.attribution.queryOptions(input), enabled: Boolean(selected), staleTime: Infinity });

  // Memoized: the diff list rebuilds its rows whenever this changes.
  const filter = useMemo((): ContributorFilter | undefined => {
    const contributor = contributors.data?.find(c => c.key === selected);
    if (!contributor || !attribution.data) return undefined;
    const { authors, files } = attribution.data;
    const lines = new Map(
      Object.entries(files).map(([path, f]) => [
        path,
        {
          added: new Map(f.added.map(([line, i]) => [line, authors[i]!])),
          deleted: new Map(f.deleted.map(([line, i]) => [line, authors[i]!])),
        },
      ]),
    );
    return { key: contributor.key, name: contributor.name, lines };
  }, [contributors.data, attribution.data, selected]);

  const only = useMemo(() => {
    if (!filter) return undefined;
    return (file: File) => {
      const authors = filter.lines.get(file.newPath);
      return [...(authors?.added.values() ?? []), ...(authors?.deleted.values() ?? [])].some(a => a.key === filter.key);
    };
  }, [filter]);

  return {
    contributors: contributors.data ?? [],
    selected,
    loading: attribution.isFetching,
    error: attribution.error?.message,
    filter,
    /** Keeps files the contributor changed. */
    only,
  };
}

/** The pull request's latest walkthrough. Polls while one is being written. */
function useWalkthrough(input: { sourceId: number; repo: string; number: number }) {
  const latest = useQuery({
    ...trpc.walkthroughs.latest.queryOptions(input),
    refetchInterval: query => (query.state.data?.status === "running" ? 1000 : false),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.latest.queryKey(input) });
  const start = useMutation(trpc.walkthroughs.start.mutationOptions({ onSuccess: refresh }));
  const cancel = useMutation(trpc.walkthroughs.cancel.mutationOptions({ onSuccess: refresh }));
  return {
    latest: latest.data,
    start: (model: AgentModel) => start.mutateAsync({ ...input, agent: model.agent, model: model.model }),
    cancel: (id: number) => cancel.mutate({ id }),
  };
}

/** Local conversations with agents about this pull request's lines. Polls while an answer is being written. */
function useQuestions(input: { sourceId: number; repo: string; number: number }) {
  const list = useQuery({
    ...trpc.questions.list.queryOptions(input),
    refetchInterval: query =>
      query.state.data?.some(t => t.messages.some(m => m.status === "running")) ? 500 : false,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.questions.list.queryKey(input) });
  const ask = useMutation(trpc.questions.ask.mutationOptions({ onSuccess: refresh }));
  const followUp = useMutation(trpc.questions.followUp.mutationOptions({ onSuccess: refresh }));
  const cancel = useMutation(trpc.questions.cancel.mutationOptions({ onSuccess: refresh }));
  const remove = useMutation(trpc.questions.delete.mutationOptions({ onSuccess: refresh }));

  return {
    // Memoized by the query: the diff list rebuilds its rows whenever this array changes.
    threads: list.data ?? noThreads,
    ask: (question: string, model: AgentModel, position: LinePosition, excerpt: string) =>
      ask.mutateAsync({ ...input, question, position, excerpt, agent: model.agent, model: model.model }),
    actions: {
      followUp: (threadId: number, question: string) => followUp.mutateAsync({ threadId, question }),
      cancel: (messageId: number) => cancel.mutate({ messageId }),
      remove: (threadId: number) => remove.mutate({ threadId }),
    } satisfies QuestionActions,
  };
}
const noThreads: QuestionThread[] = [];

/** Applies only the current URL's filters and returns visible files in tree order. */
function useHiddenFiles(files: File[] | undefined, filters: ReturnType<typeof useReviewFilters>, only?: (file: File) => boolean, rules?: CompiledFilterRules) {
  const { hideTests, hideCommentChanges: hideComments, hiddenFolders } = filters;

  const testCount = useMemo(() => files?.filter(isTestOrGenerated).length ?? 0, [files]);
  // Keep hidden files in the tree so their folders can explain what each filter excludes.
  const tree = useMemo(() => buildTree(files ?? []), [files]);
  // Memoized: the diff list rebuilds its rows whenever this array changes.
  const visible = useMemo(
    () => treeOrder(tree).filter(f =>
      !isInHiddenFolder(f, hiddenFolders) &&
      !(hideTests && isTestOrGenerated(f)) &&
      !rules?.hidesFile(f) &&
      !changeView(parse(f), hideComments, rules).allHidden &&
      (only?.(f) ?? true),
    ),
    [tree, hiddenFolders, hideTests, hideComments, only, rules],
  );
  const visiblePaths = useMemo(() => new Set(visible.map(file => file.newPath)), [visible]);

  return {
    hideTests,
    toggleTests: () => filters.setToggle("hideTests", !hideTests),
    hideComments,
    toggleComments: () => filters.setToggle("hideCommentChanges", !hideComments),
    testCount,
    tree,
    visible,
    visiblePaths,
    hiddenFolders,
    setFolderHidden: filters.setFolderHidden,
  };
}

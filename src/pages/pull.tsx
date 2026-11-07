import { CommentForm, CommentItem } from "@/components/comment";
import { DiffList, type File } from "@/components/diff-list";
import { FilterRulesPanel, useFilterRules } from "@/components/filter-rules";
import { FilterProfilesPanel, useFilterProfiles } from "@/components/filter-profiles";
import { FlowmarkPanel, useFlowmark } from "@/components/flowmark";
import type { QuestionActions, QuestionThread } from "@/components/question-thread";
import { GroupList, WalkthroughPanel } from "@/components/walkthrough";
import { ContributorList, type ContributorFilter } from "@/components/contributors";
import { buildTree, FileTree, treeOrder } from "@/components/file-tree";
import { ListSkeleton, Page, QueryError, useSource } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { ExternalLink, Eye, EyeOff, ListTree, MessageSquareOff, MessageSquareText, RotateCcw, WrapText, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { stateBadge } from "./pulls";

export function PullPage({ sourceId, repo, number }: { sourceId: number; repo: string; number: number }) {
  const source = useSource(sourceId);
  const input = { sourceId, repo, number };
  const pull = useQuery(trpc.pulls.get.queryOptions(input));
  const files = useQuery(trpc.pulls.files.queryOptions(input));
  const comments = useQuery(trpc.pulls.comments.queryOptions(input));
  const reviewFilters = useReviewFilters();
  const commentsHidden = reviewFilters.hideReviewComments;
  const visibleComments = useMemo(() => commentsHidden ? [] : comments.data ?? [], [commentsHidden, comments.data]);

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
  const openingFind = useRef(false);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => { if (desktop.matches) setNavigationOpen(false); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);
  const [jumpTo, setJumpTo] = useState<{ path?: string; group?: number; key: number }>();
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
  const reviewTools = pull.data && files.data && (
    <>
      <FilterRulesPanel key={filterKey} filters={filters} files={files.data} input={input} pull={pull.data} />
      <WalkthroughPanel
        walkthrough={walkthrough.latest}
        headSha={pull.data.headSha}
        onStart={walkthrough.start}
        onCancel={walkthrough.cancel}
      />
    </>
  );

  const navigation = (
    <>
      <FilterProfilesPanel profiles={profiles} />
      <Button
        variant="outline"
        size="sm"
        className="justify-start"
        aria-pressed={wrapLines}
        onClick={() => {
          localStorage.diffWrapLines = String(!wrapLines);
          setWrapLines(!wrapLines);
        }}
      >
        <WrapText /> Wrap lines: {wrapLines ? "On" : "Off"}
      </Button>
      <p className="text-xs text-muted-foreground sm:hidden">Tap a line number to ask or comment.</p>
      <div className="space-y-3 lg:hidden">{reviewTools}</div>
      {(byContributor.contributors.length > 1 || byContributor.selected) && (
        <ContributorList
          contributors={byContributor.contributors}
          selected={byContributor.selected}
          onSelect={reviewFilters.setContributor}
          loading={byContributor.loading}
          error={byContributor.error}
        />
      )}
      {hiding.testCount > 0 && (
        <Button variant="outline" size="sm" className="justify-start" onClick={hiding.toggleTests}>
          {hiding.hideTests ? <Eye /> : <EyeOff />}
          {hiding.hideTests ? "Show" : "Hide"} tests & generated ({hiding.testCount})
        </Button>
      )}
      <Button variant="outline" size="sm" className="justify-start" onClick={hiding.toggleComments}>
        {hiding.hideComments ? <MessageSquareText /> : <MessageSquareOff />}
        {hiding.hideComments ? "Show" : "Hide"} comment-only changes
      </Button>
      {groups && (
        <Tabs value={sidebar} onValueChange={toggleSidebar}>
          <TabsList className="w-full">
            <TabsTrigger value="groups">Groups ({groups.length})</TabsTrigger>
            <TabsTrigger value="files">Files</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      <div className="shrink-0">
        {groups && sidebar === "groups" ? (
          <GroupList
            groups={groups}
            files={new Map(hiding.visible.map(f => [f.newPath, f]))}
            onSelectGroup={group => { setJumpTo({ group, key: Date.now() }); setNavigationOpen(false); }}
            onSelectFile={path => { setJumpTo({ path, key: Date.now() }); setNavigationOpen(false); }}
          />
        ) : (
          <FileTree
            tree={hiding.tree}
            hiddenFolders={hiding.hiddenFolders}
            visiblePaths={hiding.visiblePaths}
            onFolderHiddenChange={hiding.setFolderHidden}
            onSelect={path => { setJumpTo({ path, key: Date.now() }); setNavigationOpen(false); }}
          />
        )}
      </div>
      <p className="hidden text-xs text-muted-foreground lg:block">
        <kbd>j</kbd>/<kbd>k</kbd> files{groups && <> · <kbd>]</kbd>/<kbd>[</kbd> groups</>} · <kbd>n</kbd> next
        unviewed · <kbd>v</kbd> viewed
      </p>
    </>
  );

  return (
    <Page
      crumbs={[
        { label: source?.host ?? "…", href: routes.source(sourceId) },
        { label: repo, href: routes.repo(sourceId, repo) },
        { label: `#${number}` },
      ]}
      actions={
        pull.data && (
          <>
            <Button variant="outline" size="sm" onClick={reviewFilters.reset} disabled={!reviewFilters.hasFilters}>
              <RotateCcw /> Reset filters
            </Button>
            <Button variant="outline" size="sm" onClick={() => reviewFilters.setToggle("hideReviewComments", !commentsHidden)} aria-pressed={commentsHidden}>
              {commentsHidden ? <MessageSquareText /> : <MessageSquareOff />}
              {commentsHidden ? "Show" : "Hide"} comments
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={pull.data.url} target="_blank" rel="noreferrer">
                Open <ExternalLink />
              </a>
            </Button>
          </>
        )
      }
    >
      {pull.error ? (
        <QueryError error={pull.error} />
      ) : !pull.data ? (
        <ListSkeleton rows={3} />
      ) : (
        <div className="space-y-4">
          <div>
            <h1 className="text-xl font-semibold [overflow-wrap:anywhere]">
              {pull.data.title} <span className="font-normal text-muted-foreground">#{number}</span>
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">
              <Badge className={stateBadge[pull.data.state]}>{pull.data.state}</Badge>
              {pull.data.draft && <Badge variant="outline">draft</Badge>}
              <span>
                {pull.data.author.name} · <code>{pull.data.sourceBranch}</code> → <code>{pull.data.targetBranch}</code> ·
                opened {timeAgo(pull.data.createdAt)}
              </span>
            </div>
          </div>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="max-w-full flex-wrap group-data-[orientation=horizontal]/tabs:h-auto">
              <TabsTrigger value="conversation">Conversation ({comments.data?.length ?? "…"})</TabsTrigger>
              <TabsTrigger value="files">
                Files (
                {files.data
                  ? `${viewedCount}/${hiding.visible.length} viewed${hiddenCount ? `, ${hiddenCount} hidden` : ""}`
                  : "…"}
                )
              </TabsTrigger>
              <TabsTrigger value="flowmark">Flowmark</TabsTrigger>
            </TabsList>

            <TabsContent value="flowmark">
              <FlowmarkPanel flowmark={flowmark} input={input} baseSha={pull.data.baseSha} headSha={pull.data.headSha} />
            </TabsContent>

            <TabsContent value="conversation" className="max-w-4xl space-y-4">
              <div className="min-w-0 rounded-md border bg-card p-4 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
                {pull.data.body || <span className="text-muted-foreground">No description.</span>}
              </div>
              {commentsHidden && <p role="status" className="text-sm text-muted-foreground">Comments are hidden.</p>}
              {!commentsHidden && comments.error && <QueryError error={comments.error} />}
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
              <CommentForm onSubmit={body => comment(body)} />
            </TabsContent>

            <TabsContent value="files" forceMount hidden={tab !== "files"}>
              {files.error ? (
                <QueryError error={files.error} />
              ) : !files.data ? (
                <ListSkeleton />
              ) : (
                <div className="grid min-w-0 gap-4 pb-16 lg:grid-cols-[24rem_minmax(0,1fr)] lg:pb-0">
                  <Dialog.Root open={navigationOpen} onOpenChange={setNavigationOpen}>
                    <aside aria-label="Files and filters" className="sticky top-16 hidden max-h-[calc(100dvh-5rem)] min-w-0 flex-col gap-2 self-start overflow-y-auto overscroll-contain lg:flex">
                      {navigation}
                    </aside>
                    <Dialog.Trigger asChild>
                      <Button size="icon" aria-label="Files & filters" title="Files & filters" className="fixed right-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-20 size-10 shadow-lg lg:hidden">
                        <ListTree />
                      </Button>
                    </Dialog.Trigger>
                    <Dialog.Portal>
                      <Dialog.Overlay className="fixed inset-0 z-30 bg-black/40 lg:hidden" />
                      <Dialog.Content onCloseAutoFocus={event => {
                        if (openingFind.current) event.preventDefault();
                        openingFind.current = false;
                      }} className="fixed inset-y-0 left-0 z-40 flex max-h-dvh w-[min(24rem,calc(100vw-1.5rem))] flex-col gap-3 bg-background p-3 shadow-xl lg:hidden">
                        <div className="flex items-center justify-between gap-2">
                          <Dialog.Title className="font-semibold">Files &amp; filters</Dialog.Title>
                          <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label="Close files and filters"><X /></Button>
                          </Dialog.Close>
                        </div>
                        <Dialog.Description className="sr-only">Choose a file, contributor, or filter for this pull request.</Dialog.Description>
                        <nav aria-label="Files and filters" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                          <div className="flex flex-col gap-2">{navigation}</div>
                        </nav>
                      </Dialog.Content>
                    </Dialog.Portal>
                  </Dialog.Root>
                  <div className="-mx-3 min-w-0 space-y-4 sm:mx-0">
                    <div className="hidden space-y-4 lg:block">{reviewTools}</div>
                    {hiding.visible.length > 0 ? tab === "files" && (
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
                        onOpenFind={() => {
                          openingFind.current = navigationOpen;
                          setNavigationOpen(false);
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
                    ) : (
                      <p className="text-sm text-muted-foreground">All files in this pull request are hidden.</p>
                    )}
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}
    </Page>
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

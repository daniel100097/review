import { CommentForm, CommentItem } from "@/components/comment";
import { DiffList, type File } from "@/components/diff-list";
import { FilterRulesPanel, useFilterRules } from "@/components/filter-rules";
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
import { queryClient, trpc } from "@/lib/trpc";
import { timeAgo } from "@/lib/utils";
import type { LinePosition } from "@/server/providers/types";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, Eye, EyeOff, MessageSquareOff, MessageSquareText } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "wouter";
import { stateBadge } from "./pulls";

export function PullPage({ sourceId, repo, number }: { sourceId: number; repo: string; number: number }) {
  const source = useSource(sourceId);
  const input = { sourceId, repo, number };
  const pull = useQuery(trpc.pulls.get.queryOptions(input));
  const files = useQuery(trpc.pulls.files.queryOptions(input));
  const comments = useQuery(trpc.pulls.comments.queryOptions(input));
  const [commentsHidden, toggleComments] = useStoredToggle("hideReviewComments");
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
  const [jumpTo, setJumpTo] = useState<{ path?: string; group?: number; key: number }>();
  const byContributor = useContributorFilter(input);
  const repositoryFilterKey = `customFilters:${sourceId}:${repo}`;
  const filterKey = `${repositoryFilterKey}:${number}`;
  const filters = useFilterRules(filterKey, repositoryFilterKey);
  const hiding = useHiddenFiles(sourceId, repo, files.data, byContributor.only, filters.compiled);
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
            <Button variant="outline" size="sm" onClick={toggleComments} aria-pressed={commentsHidden}>
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
            <h1 className="text-xl font-semibold">
              {pull.data.title} <span className="font-normal text-muted-foreground">#{number}</span>
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge className={stateBadge[pull.data.state]}>{pull.data.state}</Badge>
              {pull.data.draft && <Badge variant="outline">draft</Badge>}
              <span>
                {pull.data.author.name} · <code>{pull.data.sourceBranch}</code> → <code>{pull.data.targetBranch}</code> ·
                opened {timeAgo(pull.data.createdAt)}
              </span>
            </div>
          </div>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="conversation">Conversation ({comments.data?.length ?? "…"})</TabsTrigger>
              <TabsTrigger value="files">
                Files (
                {files.data
                  ? `${viewedCount}/${hiding.visible.length} viewed${hiddenCount ? `, ${hiddenCount} hidden` : ""}`
                  : "…"}
                )
              </TabsTrigger>
            </TabsList>

            <TabsContent value="conversation" className="max-w-4xl space-y-4">
              <div className="rounded-md border bg-card p-4 text-sm whitespace-pre-wrap">
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
                <div className="grid grid-cols-[24rem_minmax(0,1fr)] gap-4">
                  <aside className="sticky top-16 flex max-h-[calc(100vh-5rem)] flex-col gap-2 self-start">
                    {(byContributor.contributors.length > 1 || byContributor.selected) && (
                      <ContributorList
                        contributors={byContributor.contributors}
                        selected={byContributor.selected}
                        onSelect={byContributor.select}
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
                    <div className="min-h-0 overflow-y-auto">
                      {groups && sidebar === "groups" ? (
                        <GroupList
                          groups={groups}
                          files={new Map(hiding.visible.map(f => [f.newPath, f]))}
                          onSelectGroup={group => setJumpTo({ group, key: Date.now() })}
                          onSelectFile={path => setJumpTo({ path, key: Date.now() })}
                        />
                      ) : (
                        <FileTree
                          tree={hiding.tree}
                          hiddenFolders={hiding.hiddenFolders}
                          onFolderHiddenChange={hiding.setFolderHidden}
                          onSelect={path => setJumpTo({ path, key: Date.now() })}
                        />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      <kbd>j</kbd>/<kbd>k</kbd> files{groups && <> · <kbd>]</kbd>/<kbd>[</kbd> groups</>} · <kbd>n</kbd> next
                      unviewed · <kbd>v</kbd> viewed
                    </p>
                  </aside>
                  <div className="min-w-0 space-y-4">
                    <FilterRulesPanel key={filterKey} filters={filters} files={files.data} input={input} pull={pull.data} />
                    <WalkthroughPanel
                      walkthrough={walkthrough.latest}
                      headSha={pull.data.headSha}
                      onStart={walkthrough.start}
                      onCancel={walkthrough.cancel}
                    />
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
function useContributorFilter(input: { sourceId: number; repo: string; number: number }) {
  const [params, setParams] = useSearchParams();
  const selected = params.get("by") ?? undefined;
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
    select: (key: string | undefined) =>
      setParams(prev => {
        const next = new URLSearchParams(prev);
        if (key) next.set("by", key);
        else next.delete("by");
        return next;
      }),
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

/** A boolean remembered in this browser. */
function useStoredToggle(key: string) {
  const [value, setValue] = useState(() => localStorage[key] === "true");
  const toggle = () => {
    localStorage[key] = String(!value);
    setValue(!value);
  };
  return [value, toggle] as const;
}

/**
 * Hides test/generated files and comment-only changes (per-browser toggles) and folders hidden for
 * this repo (stored server-side). Returns the tree for the sidebar and the visible files in tree order.
 */
function useHiddenFiles(sourceId: number, repo: string, files: File[] | undefined, only?: (file: File) => boolean, rules?: CompiledFilterRules) {
  const [hideTests, toggleTests] = useStoredToggle("hideTestsAndGenerated");
  const [hideComments, toggleComments] = useStoredToggle("hideCommentOnlyChanges");

  const repoInput = { sourceId, repo };
  const hiddenFolders = useQuery(trpc.repos.hiddenFolders.queryOptions(repoInput));
  const setFolderHidden = useMutation(
    trpc.repos.setFolderHidden.mutationOptions({
      onMutate: ({ path, hidden }) =>
        queryClient.setQueryData(trpc.repos.hiddenFolders.queryKey(repoInput), old =>
          hidden ? [...(old ?? []), path] : old?.filter(p => p !== path),
        ),
      onSettled: () => queryClient.invalidateQueries({ queryKey: trpc.repos.hiddenFolders.queryKey(repoInput) }),
    }),
  );

  const testCount = useMemo(() => files?.filter(isTestOrGenerated).length ?? 0, [files]);
  const tree = useMemo(
    () =>
      buildTree(
        files?.filter(
          f =>
            !(hideTests && isTestOrGenerated(f)) &&
            !rules?.hidesFile(f) &&
            !changeView(parse(f), hideComments, rules).allHidden &&
            (only?.(f) ?? true),
        ) ?? [],
      ),
    [files, hideTests, hideComments, only, rules],
  );
  // Memoized: the diff list rebuilds its rows whenever this array changes.
  const visible = useMemo(
    () => treeOrder(tree).filter(f => !isInHiddenFolder(f, hiddenFolders.data ?? [])),
    [tree, hiddenFolders.data],
  );

  return {
    hideTests,
    toggleTests,
    hideComments,
    toggleComments,
    testCount,
    tree,
    visible,
    hiddenFolders: hiddenFolders.data ?? [],
    setFolderHidden: (path: string, hidden: boolean) => setFolderHidden.mutate({ ...repoInput, path, hidden }),
  };
}

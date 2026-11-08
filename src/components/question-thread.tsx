import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { agentModels, modelLabel, type AgentModel } from "@/lib/agents";
import type { RouterOutputs } from "@/lib/trpc";
import { cn, timeAgo } from "@/lib/utils";
import { LoaderCircle, Sparkles, Square, Trash2 } from "lucide-react";
import { useState } from "react";

export type QuestionThread = RouterOutputs["questions"]["list"][number];

export interface QuestionActions {
  followUp: (threadId: number, question: string) => Promise<unknown>;
  cancel: (messageId: number) => void;
  remove: (threadId: number) => void;
}

const modelKey = (m: Pick<AgentModel, "agent" | "model">) => `${m.agent}:${m.model}`;

/** A model choice remembered in this browser under `storageKey`. */
export function useAgentModel(storageKey: string, fallback: AgentModel["model"]) {
  const defaultModel = agentModels.find(m => m.model === fallback)!;
  const [key, setKey] = useState<string>(() => localStorage[storageKey] ?? modelKey(defaultModel));
  const model = agentModels.find(m => modelKey(m) === key) ?? defaultModel;
  const set = (m: AgentModel) => {
    localStorage[storageKey] = modelKey(m);
    setKey(modelKey(m));
  };
  return [model, set] as const;
}

export function ModelPicker({ value, onChange }: { value: AgentModel; onChange: (m: AgentModel) => void }) {
  return (
    <Select value={modelKey(value)} onValueChange={key => onChange(agentModels.find(m => modelKey(m) === key)!)}>
      <SelectTrigger size="sm" className="w-auto max-w-full min-w-36 pointer-coarse:h-9" aria-label="Model">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(["claude", "codex"] as const).map(agent => (
          <SelectGroup key={agent}>
            <SelectLabel>{agent === "claude" ? "Claude Code" : "Codex"}</SelectLabel>
            {agentModels
              .filter(m => m.agent === agent)
              .map(m => (
                <SelectItem key={modelKey(m)} value={modelKey(m)}>
                  {m.label}
                </SelectItem>
              ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Marks a thread or walkthrough made for an earlier head commit. */
export function EarlierPush({ title }: { title?: string }) {
  return (
    <Badge variant="secondary" title={title} className="font-normal text-muted-foreground">
      earlier push
    </Badge>
  );
}

/**
 * The form under selected diff lines: ask an agent (local, the default for Ctrl+Enter) or post a comment to the
 * forge (only by clicking, so a question never goes public by accident).
 */
export function LineComposer({
  lineCount,
  onAsk,
  onComment,
  onCancel,
}: {
  lineCount: number;
  onAsk: (question: string, model: AgentModel) => Promise<unknown>;
  onComment: (body: string) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [body, setBody] = useState("");
  const [pending, setPending] = useState<"ask" | "comment">();
  const [error, setError] = useState<string>();
  const [model, setModel] = useAgentModel("agentModel", "sonnet");
  const [touch] = useState(() => matchMedia("(pointer: coarse)").matches);
  // Where line numbers are the buttons (touch, narrow windows), tapping or clicking another one extends the
  // selection, as there's no shift-click on touch and no + to shift-click (see DiffList).
  const [lineNumbers] = useState(() => matchMedia("(pointer: coarse), (max-width: 639px)").matches);
  const lines = lineCount === 1 ? "this line" : `these ${lineCount} lines`;

  const submit = async (kind: "ask" | "comment") => {
    if (!body.trim() || pending) return;
    setPending(kind);
    setError(undefined);
    try {
      await (kind === "ask" ? onAsk(body, model) : onComment(body));
      setBody("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(undefined);
    }
  };

  return (
    <form
      className="min-w-0 space-y-2 font-sans [overflow-wrap:anywhere]"
      onSubmit={e => {
        e.preventDefault();
        submit("ask");
      }}
    >
      <Textarea
        className="min-h-20 min-w-0 resize-y"
        value={body}
        onChange={e => setBody(e.target.value)}
        aria-label={`Question or comment about ${lines}`}
        placeholder={`Ask about ${lines}, or write a comment. ${lineNumbers ? "Tap or click another line number" : "Shift-click another line's +"} to select a range.`}
        autoFocus
        onKeyDown={e => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit("ask");
          if (e.key === "Escape") onCancel();
        }}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {/* Cancel sits apart from Comment, the one button here that publishes something. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <span className="mr-auto text-xs text-muted-foreground">{touch ? "Asking stays local" : "Ctrl+Enter asks · stays local"}</span>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ModelPicker value={model} onChange={setModel} />
          {/* Together, so Comment never ends up alone on a row on narrow screens. */}
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={Boolean(pending) || !body.trim()} title="Ask an agent (Ctrl+Enter). Stays local.">
              <Sparkles /> {pending === "ask" ? "Asking…" : "Ask"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-2"
              disabled={Boolean(pending) || !body.trim()}
              onClick={() => submit("comment")}
              title="Post as a comment on the pull request"
            >
              {pending === "comment" ? "Posting…" : "Comment"}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}

export function QuestionThreadView({
  thread,
  stale,
  showExcerpt,
  actions,
}: {
  thread: QuestionThread;
  /** Asked on an earlier head commit. */
  stale: boolean;
  /** Show the asked-about lines, for threads not next to them. */
  showExcerpt?: boolean;
  actions: QuestionActions;
}) {
  const running = thread.messages.some(m => m.status === "running");
  // Announce an answer once it has finished, not while it streams, nor old ones as the diff scrolls them into view.
  const [watched, setWatched] = useState(running);
  if (running && !watched) setWatched(true);
  const finished = watched && !running ? thread.messages.at(-1)?.status : undefined;
  return (
    <div className="flex min-w-0 gap-2 font-sans [overflow-wrap:anywhere]">
      <span role="status" className="sr-only">
        {finished === "done" ? "Answer ready" : finished === "failed" ? "Answer failed" : finished === "cancelled" ? "Answer stopped" : ""}
      </span>
      <span className="flex size-6 shrink-0 items-center justify-center">
        <Sparkles aria-label="Agent" className="size-4 text-ai" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-h-6 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span className="text-sm font-medium text-foreground">{modelLabel(thread.agent, thread.model)}</span>
          <span>
            {timeAgo(new Date(thread.createdAt).toISOString())} · <span title="Only stored in this app, not on the forge">local</span>
          </span>
          {stale && <EarlierPush title={`Asked on ${thread.headSha.slice(0, 8)}`} />}
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto size-6 text-muted-foreground hover:text-foreground pointer-coarse:size-9"
            title="Delete this conversation"
            aria-label="Delete this conversation"
            onClick={() => actions.remove(thread.id)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
        {showExcerpt && (
          <pre className="mt-1 max-w-full overflow-x-auto rounded-md bg-muted px-2 py-1 font-mono text-xs whitespace-pre [overflow-wrap:normal]">{thread.excerpt}</pre>
        )}
        <div className="mt-1 space-y-3">
          {thread.messages.map((m, i) =>
            m.role === "user" ? (
              <p key={m.id} className={cn("text-sm font-medium whitespace-pre-wrap", i > 0 && "border-t pt-3")}>
                {m.body}
              </p>
            ) : (
              <AgentMessage key={m.id} message={m} onCancel={() => actions.cancel(m.id)} />
            ),
          )}
        </div>
        {!running && <FollowUp onSubmit={question => actions.followUp(thread.id, question)} />}
      </div>
    </div>
  );
}

function AgentMessage({ message: m, onCancel }: { message: QuestionThread["messages"][number]; onCancel: () => void }) {
  return (
    <div className="space-y-2">
      {m.notes && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none hover:text-foreground">Agent notes</summary>
          <div className="mt-1 border-l-2 pl-3">
            <Markdown>{m.notes}</Markdown>
          </div>
        </details>
      )}
      {m.body && <Markdown>{m.body}</Markdown>}
      {m.status === "running" && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircle className="size-3.5 shrink-0 animate-spin text-ai" />
          <span className="min-w-0 truncate">{m.activity ?? "Working"}…</span>
          <Button variant="ghost" size="xs" className="ml-auto" onClick={onCancel}>
            <Square /> Stop
          </Button>
        </div>
      )}
      {m.status === "failed" && <p className="text-sm whitespace-pre-wrap text-destructive">{m.error ?? "Failed."}</p>}
      {m.status === "cancelled" && <p className="text-xs text-muted-foreground">Stopped.</p>}
    </div>
  );
}

/** One slim row under a thread; the textarea grows with its content. Enter asks, Shift+Enter adds a line. */
function FollowUp({ onSubmit }: { onSubmit: (question: string) => Promise<unknown> }) {
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async () => {
    if (!body.trim() || pending) return;
    setPending(true);
    setError(undefined);
    try {
      await onSubmit(body);
      setBody("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  return (
    <form
      className="mt-2 flex min-w-0 flex-wrap items-end gap-2"
      onSubmit={e => {
        e.preventDefault();
        submit();
      }}
    >
      <Textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        placeholder="Ask a follow-up"
        aria-label="Ask a follow-up"
        rows={1}
        className="max-h-40 min-h-8 min-w-0 flex-1 resize-none py-1 pointer-coarse:min-h-9 pointer-coarse:py-1.5"
        onKeyDown={e => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <Button type="submit" size="sm" variant="outline" disabled={pending || !body.trim()}>
        {pending ? "Asking…" : "Ask"}
      </Button>
      {error && <p className="w-full text-sm text-destructive">{error}</p>}
    </form>
  );
}

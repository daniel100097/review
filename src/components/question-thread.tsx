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
      <SelectTrigger size="sm" className="w-44" aria-label="Model">
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
      className="space-y-2 font-sans"
      onSubmit={e => {
        e.preventDefault();
        submit("ask");
      }}
    >
      <Textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        placeholder={`Ask about ${lineCount === 1 ? "this line" : `these ${lineCount} lines`}, or write a comment. Shift-click another line's + to select a range.`}
        autoFocus
        onKeyDown={e => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit("ask");
          if (e.key === "Escape") onCancel();
        }}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <ModelPicker value={model} onChange={setModel} />
        <Button type="submit" size="sm" disabled={Boolean(pending) || !body.trim()} title="Ask (Ctrl+Enter). Stays local.">
          <Sparkles /> {pending === "ask" ? "Asking…" : "Ask"}
        </Button>
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={Boolean(pending) || !body.trim()}
            onClick={() => submit("comment")}
            title="Post as a comment on the pull request"
          >
            {pending === "comment" ? "Posting…" : "Comment"}
          </Button>
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
  return (
    <div className="flex gap-3 font-sans">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-violet-600 dark:text-violet-400">
        <Sparkles className="size-4" />
      </div>
      <div className="min-w-0 flex-1 rounded-md border border-violet-500/30 bg-card">
        <div className="flex flex-wrap items-center gap-x-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{modelLabel(thread.agent, thread.model)}</span>
          <span>{timeAgo(new Date(thread.createdAt).toISOString())}</span>
          <span title="Only stored in this app, not on the forge">· local</span>
          {stale && (
            <Badge variant="outline" title={`Asked on ${thread.headSha.slice(0, 8)}`}>
              earlier push
            </Badge>
          )}
          <button
            type="button"
            className="ml-auto rounded p-0.5 hover:bg-muted hover:text-foreground"
            title="Delete this conversation"
            onClick={() => actions.remove(thread.id)}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
        {showExcerpt && (
          <pre className="overflow-x-auto border-b bg-muted/50 px-3 py-1.5 font-mono text-xs">{thread.excerpt}</pre>
        )}
        <div className="space-y-3 px-3 py-2">
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
          <summary className="cursor-pointer select-none">Agent notes</summary>
          <div className="mt-1 border-l-2 pl-3">
            <Markdown>{m.notes}</Markdown>
          </div>
        </details>
      )}
      {m.body && <Markdown>{m.body}</Markdown>}
      {m.status === "running" && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" />
          <span className="min-w-0 truncate">{m.activity ?? "Working"}…</span>
          <Button variant="ghost" size="sm" className="ml-auto h-6 px-2 text-xs" onClick={onCancel}>
            <Square className="size-3" /> Stop
          </Button>
        </div>
      )}
      {m.status === "failed" && <p className="text-sm whitespace-pre-wrap text-destructive">{m.error ?? "Failed."}</p>}
      {m.status === "cancelled" && <p className="text-xs text-muted-foreground">Stopped.</p>}
    </div>
  );
}

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
      className="flex items-start gap-2 border-t px-3 py-2"
      onSubmit={e => {
        e.preventDefault();
        submit();
      }}
    >
      <Textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        placeholder="Ask a follow-up"
        rows={1}
        className={cn("min-h-8 resize-none py-1.5 text-sm", body.includes("\n") && "resize-y")}
        onKeyDown={e => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <Button type="submit" size="sm" variant="secondary" disabled={pending || !body.trim()}>
        Ask
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}

import type { File } from "@/components/diff-list";
import { hiddenFolderOf, isInHiddenFolder } from "@/lib/hidden-files";
import { cn, revealInScrollParent } from "@/lib/utils";
import { ChevronRight, Circle, CircleCheck, Eye, EyeOff, Folder } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface Dir {
  name: string;
  path: string;
  dirs: Dir[];
  files: File[];
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** Builds a folder tree, merging folders that only contain one folder (like `packages/api/src`). */
export function buildTree(files: File[]): Dir {
  const root: Dir = { name: "", path: "", dirs: [], files: [] };
  for (const file of files) {
    let dir = root;
    for (const name of file.newPath.split("/").slice(0, -1)) {
      const path = dir.path ? `${dir.path}/${name}` : name;
      let child = dir.dirs.find(d => d.path === path);
      if (!child) dir.dirs.push((child = { name, path, dirs: [], files: [] }));
      dir = child;
    }
    dir.files.push(file);
  }

  const finish = (dir: Dir): Dir => {
    dir.dirs = dir.dirs
      .map(child => {
        while (child.files.length === 0 && child.dirs.length === 1) {
          const only = child.dirs[0]!;
          child = { ...only, name: `${child.name}/${only.name}` };
        }
        return finish(child);
      })
      .sort(byName);
    dir.files.sort((a, b) => baseName(a.newPath).localeCompare(baseName(b.newPath)));
    return dir;
  };
  return finish(root);
}

/** Files in the order the tree shows them: folders first, then files. */
export function treeOrder(dir: Dir): File[] {
  return [...dir.dirs.flatMap(treeOrder), ...dir.files];
}

export function FileTree({
  tree,
  hiddenFolders,
  visiblePaths,
  current,
  onSelect,
  onFolderHiddenChange,
}: {
  tree: Dir;
  hiddenFolders: readonly string[];
  visiblePaths?: ReadonlySet<string>;
  /** The file being read in the diff; highlighted and kept in view. */
  current?: string;
  onSelect: (path: string) => void;
  onFolderHiddenChange: (path: string, hidden: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(() => new Map<string, boolean>());
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>('[aria-current="true"]');
    if (row) revealInScrollParent(row);
  }, [current]);
  const toggle = (path: string, open: boolean) => setExpanded(prev => new Map(prev).set(path, !open));
  const isHidden = (file: File) =>
    visiblePaths ? !visiblePaths.has(file.newPath) : isInHiddenFolder(file, hiddenFolders);

  const renderDir = (dir: Dir, depth: number) => {
    // A merged row like `a/b` can sit inside a hidden folder `a` without being it.
    const hiddenBy = hiddenFolderOf(dir.path, hiddenFolders);
    const files = treeOrder(dir);
    const hiddenCount = files.filter(isHidden).length;
    const fullyHidden = files.length > 0 && hiddenCount === files.length;
    const open = !hiddenBy && (expanded.get(dir.path) ?? !fullyHidden);
    const filterHidden = fullyHidden && !hiddenBy;
    return (
      <li key={dir.path}>
        <div className="group flex items-center rounded-md hover:bg-accent" style={{ paddingLeft: depth * 12 }}>
          <button
            type="button"
            disabled={!!hiddenBy}
            onClick={() => toggle(dir.path, open)}
            title={dir.path}
            aria-expanded={open}
            aria-label={`${dir.path}${hiddenCount ? ` (${hiddenCount} hidden)` : ""}`}
            className="flex min-h-7 min-w-0 flex-1 items-center gap-1 rounded-md py-1 pl-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default pointer-coarse:min-h-9"
          >
            <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
            <Folder className="size-3.5 shrink-0 text-muted-foreground" />
            {/* Only the count is coloured, so a filter doesn't turn half the tree amber. */}
            <span className={cn("truncate", (fullyHidden || hiddenBy) && "text-muted-foreground line-through")}>
              {dir.name}
            </span>
            {hiddenCount > 0 && (
              <span className="ml-auto shrink-0 pr-1 text-xs text-warning tabular-nums">({hiddenCount} hidden)</span>
            )}
          </button>
          <button
            type="button"
            disabled={filterHidden}
            title={
              hiddenBy
                ? `Show ${hiddenBy} (other filters still apply)`
                : filterHidden
                  ? `Current filters hide ${dir.path}; reset filters to show it`
                  : `Hide ${dir.path}`
            }
            onClick={() => onFolderHiddenChange(hiddenBy ?? dir.path, !hiddenBy)}
            className={cn(
              "mr-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring enabled:hover:bg-background enabled:hover:text-foreground disabled:cursor-default pointer-coarse:size-9",
              // With a mouse, the eye shows on hover; it stays focusable (opacity, not visibility) for keyboards.
              !hiddenBy && !filterHidden && "pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100 focus-visible:opacity-100",
            )}
          >
            {hiddenBy ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
          </button>
        </div>
        {open && (
          <ul>
            {dir.dirs.map(d => renderDir(d, depth + 1))}
            {dir.files.map(f => renderFile(f, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  const renderFile = (file: File, depth: number) => {
    const hidden = isHidden(file);
    const label = `${file.newPath}${hidden ? " (hidden by current filters)" : ""}`;
    const status = file.status === "added" ? "A" : file.status === "deleted" ? "D" : file.status === "renamed" ? "R" : undefined;
    const isCurrent = current === file.newPath;
    return (
      <li key={file.newPath}>
        <button
          type="button"
          title={label}
          aria-label={[file.newPath, file.status !== "modified" && file.status, file.viewed && "viewed", hidden && "hidden by current filters"].filter(Boolean).join(", ")}
          aria-current={isCurrent ? "true" : undefined}
          disabled={hidden}
          onClick={() => onSelect(file.newPath)}
          style={{ paddingLeft: depth * 12 + 4 }}
          className={cn(
            "flex min-h-7 w-full items-center gap-1.5 rounded-md py-1 pr-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring enabled:hover:bg-accent disabled:cursor-default pointer-coarse:min-h-9",
            file.viewed && "text-muted-foreground",
            hidden && "text-muted-foreground/70",
            isCurrent && "bg-accent font-medium text-foreground",
          )}
        >
          {file.viewed ? (
            <CircleCheck className="size-3.5 shrink-0 text-success" />
          ) : (
            <Circle className="size-3.5 shrink-0 text-muted-foreground/60" />
          )}
          <span className={cn("truncate", (hidden || file.status === "deleted") && "line-through")}>
            {baseName(file.newPath)}
          </span>
          {/* Like an editor's source-control view: a quiet letter, so green only ever means "viewed". */}
          {status && (
            <span aria-hidden className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
              {status}
            </span>
          )}
        </button>
      </li>
    );
  };

  return (
    <ul ref={list} className="text-[13px]">
      {tree.dirs.map(d => renderDir(d, 0))}
      {tree.files.map(f => renderFile(f, 0))}
    </ul>
  );
}

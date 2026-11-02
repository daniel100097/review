import type { File } from "@/components/diff-list";
import { hiddenFolderOf, isInHiddenFolder } from "@/lib/hidden-files";
import { cn } from "@/lib/utils";
import { ChevronRight, Circle, CircleCheck, Eye, EyeOff, Folder } from "lucide-react";
import { useState } from "react";

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
  onSelect,
  onFolderHiddenChange,
}: {
  tree: Dir;
  hiddenFolders: readonly string[];
  visiblePaths?: ReadonlySet<string>;
  onSelect: (path: string) => void;
  onFolderHiddenChange: (path: string, hidden: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(() => new Map<string, boolean>());
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
        <div className="group flex items-center rounded hover:bg-muted" style={{ paddingLeft: depth * 12 }}>
          <button
            type="button"
            disabled={!!hiddenBy}
            onClick={() => toggle(dir.path, open)}
            title={dir.path}
            aria-expanded={open}
            aria-label={`${dir.path}${hiddenCount ? ` (${hiddenCount} hidden)` : ""}`}
            className="flex min-h-9 min-w-0 flex-1 items-center gap-1 py-1 pl-1 text-left disabled:cursor-default sm:min-h-0"
          >
            <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
            <Folder
              className={cn(
                "size-3.5 shrink-0",
                files.every(f => f.viewed) && "text-green-600",
                hiddenCount > 0 && "text-amber-700 dark:text-amber-400",
              )}
            />
            <span
              className={cn(
                "truncate",
                hiddenCount > 0 && "text-amber-700 dark:text-amber-400",
                fullyHidden && "line-through",
              )}
            >
              {dir.name}
            </span>
            {hiddenCount > 0 && (
              <span className="shrink-0 text-amber-700 dark:text-amber-400">({hiddenCount} hidden)</span>
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
              "mr-1 flex size-9 shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground enabled:hover:bg-background enabled:hover:text-foreground disabled:cursor-default sm:size-auto",
              !hiddenBy && !filterHidden && "sm:invisible sm:group-hover:visible sm:group-focus-within:visible focus-visible:visible [@media(hover:none)]:visible",
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
    return (
      <li key={file.newPath}>
        <button
          type="button"
          title={label}
          aria-label={label}
          disabled={hidden}
          onClick={() => onSelect(file.newPath)}
          style={{ paddingLeft: depth * 12 + 4 }}
          className={cn(
            "flex min-h-9 w-full items-center gap-1.5 rounded py-1 pr-1 text-left enabled:hover:bg-muted disabled:cursor-default sm:min-h-0",
            file.viewed && "text-muted-foreground",
            hidden && "text-amber-700 dark:text-amber-400",
          )}
        >
          {file.viewed ? (
            <CircleCheck className="size-3.5 shrink-0 text-green-600" />
          ) : (
            <Circle className="size-3.5 shrink-0" />
          )}
          <span
            className={cn(
              "truncate",
              !hidden && file.status === "added" && "text-green-700 dark:text-green-400",
              !hidden && file.status === "deleted" && "text-red-700 dark:text-red-400",
              file.status === "deleted" && "line-through",
            )}
          >
            {baseName(file.newPath)}
          </span>
        </button>
      </li>
    );
  };

  return (
    <ul className="font-mono text-xs">
      {tree.dirs.map(d => renderDir(d, 0))}
      {tree.files.map(f => renderFile(f, 0))}
    </ul>
  );
}

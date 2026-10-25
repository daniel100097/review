import type { FileDiff } from "./types";

const stripPrefix = (p: string) => p.replace(/\t$/, "").replace(/^[ab]\//, "");

/** Splits a full `git diff` into per-file diffs. */
export function splitGitDiff(diff: string): FileDiff[] {
  return diff
    .split(/^diff --git /m)
    .slice(1)
    .map(chunk => {
      const lines = chunk.split("\n");
      const hunkStart = lines.findIndex(l => l.startsWith("@@"));
      const header = hunkStart === -1 ? lines : lines.slice(0, hunkStart);
      const find = (prefix: string) => header.find(l => l.startsWith(prefix))?.slice(prefix.length);

      // `a/x b/y` is ambiguous when paths contain spaces, so prefer the explicit headers.
      const [, gitOld = "", gitNew = ""] = header[0]!.match(/^a\/(.*) b\/(.*)$/) ?? [];
      const minus = find("--- ");
      const plus = find("+++ ");
      const oldPath = find("rename from ") ?? (minus && minus !== "/dev/null" ? stripPrefix(minus) : gitOld);
      const newPath = find("rename to ") ?? (plus && plus !== "/dev/null" ? stripPrefix(plus) : gitNew);

      const status: FileDiff["status"] = find("new file mode")
        ? "added"
        : find("deleted file mode")
          ? "deleted"
          : oldPath !== newPath
            ? "renamed"
            : "modified";

      const patch = hunkStart === -1 ? "" : lines.slice(hunkStart).join("\n").replace(/\n$/, "");
      return { oldPath: status === "added" ? newPath : oldPath, newPath: status === "deleted" ? oldPath : newPath, status, patch };
    });
}

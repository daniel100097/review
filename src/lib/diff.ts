export interface DiffLine {
  kind: "hunk" | "add" | "del" | "context";
  content: string;
  oldLine?: number;
  newLine?: number;
}

/** Parses unified diff hunks into lines with old/new line numbers. */
export function parseHunks(patch: string): DiffLine[] {
  if (!patch) return [];
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const raw of patch.split("\n")) {
    const header = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      lines.push({ kind: "hunk", content: raw });
    } else if (raw.startsWith("\\")) {
      // "\ No newline at end of file"
    } else if (raw.startsWith("+")) {
      lines.push({ kind: "add", content: raw.slice(1), newLine: newLine++ });
    } else if (raw.startsWith("-")) {
      lines.push({ kind: "del", content: raw.slice(1), oldLine: oldLine++ });
    } else {
      lines.push({ kind: "context", content: raw.slice(1), oldLine: oldLine++, newLine: newLine++ });
    }
  }
  return lines;
}

export function findText(text: string, query: string): Array<{ start: number; end: number }> {
  if (!query) return [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  return Array.from(text.matchAll(pattern), match => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

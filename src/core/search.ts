import { isContainer } from "./nodes";
import type { Json, Path } from "./types";

export interface Match {
  path: Path;
  on: "key" | "value";
  value: Json;
}

export interface SearchResult {
  matches: Match[];
  truncated: boolean;
}

/** Case-insensitive substring search over object keys and scalar values, in document order. */
export function search(doc: Json, query: string, limit = 500): SearchResult {
  const needle = query.trim().toLowerCase();
  const matches: Match[] = [];
  if (!needle) return { matches, truncated: false };
  const stack: Array<[Json, Path]> = [[doc, []]];
  while (stack.length) {
    const [value, path] = stack.pop()!;
    const last = path[path.length - 1];
    if (typeof last === "string" && last.toLowerCase().includes(needle)) {
      matches.push({ path, on: "key", value });
    } else if (!isContainer(value) && String(value).toLowerCase().includes(needle)) {
      matches.push({ path, on: "value", value });
    }
    if (matches.length >= limit) return { matches, truncated: stack.length > 0 || isContainer(value) };
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) stack.push([value[i]!, [...path, i]]);
    } else if (isContainer(value)) {
      const names = Object.keys(value);
      for (let i = names.length - 1; i >= 0; i--) {
        stack.push([value[names[i]!]!, [...path, names[i]!]]);
      }
    }
  }
  return { matches, truncated: false };
}

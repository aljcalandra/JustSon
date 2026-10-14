import type { Json, JsonObject, Kind, Segment } from "./types";

export function kindOf(value: Json): Kind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value as Kind;
}

export function isContainer(value: Json | undefined): value is Json[] | JsonObject {
  return value !== null && typeof value === "object";
}

export function size(value: Json): number {
  if (Array.isArray(value)) return value.length;
  return isContainer(value) ? Object.keys(value).length : 0;
}

/** Child keys in document order: indexes for arrays, own keys for objects. */
export function keys(value: Json): Segment[] {
  if (Array.isArray(value)) return value.map((_, i) => i);
  return isContainer(value) ? Object.keys(value) : [];
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** One-line description of a value, e.g. {id, name, tags, …} or [3 items] or "hello". */
export function preview(value: Json, max = 80): string {
  if (Array.isArray(value)) {
    return value.length === 0 ? "[]" : `[${value.length} item${value.length === 1 ? "" : "s"}]`;
  }
  if (isContainer(value)) {
    const names = Object.keys(value);
    if (names.length === 0) return "{}";
    let out = "";
    for (const name of names) {
      const next = out ? `${out}, ${name}` : name;
      if (next.length > max - 4) return `{${out || truncate(name, max - 4)}, …}`;
      out = next;
    }
    return `{${out}}`;
  }
  return truncate(JSON.stringify(value), max);
}

export interface Stats {
  nodes: number;
  maxDepth: number;
  kinds: Record<Kind, number>;
}

export function stats(doc: Json): Stats {
  const kinds: Record<Kind, number> = {
    object: 0,
    array: 0,
    string: 0,
    number: 0,
    boolean: 0,
    null: 0,
  };
  let nodes = 0;
  let maxDepth = 0;
  const stack: Array<[Json, number]> = [[doc, 0]];
  while (stack.length) {
    const [value, depth] = stack.pop()!;
    nodes++;
    kinds[kindOf(value)]++;
    if (depth > maxDepth) maxDepth = depth;
    if (isContainer(value)) {
      for (const v of Object.values(value)) stack.push([v, depth + 1]);
    }
  }
  return { nodes, maxDepth, kinds };
}

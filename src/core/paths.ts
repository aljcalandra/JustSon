import type { Json, Path } from "./types";

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export class PathError extends Error {}

/** JSONPath-style text, e.g. $.store.book[0]["first name"]. */
export function display(path: Path): string {
  let out = "$";
  for (const part of path) {
    if (typeof part === "number") out += `[${part}]`;
    else if (IDENT.test(part)) out += `.${part}`;
    else out += `[${JSON.stringify(part)}]`;
  }
  return out;
}

/** Stable string form of a path, for use as a Map/Set key. */
export function pathKey(path: Path): string {
  return JSON.stringify(path);
}

export function child(value: Json, part: string | number): Json | undefined {
  if (Array.isArray(value)) {
    return typeof part === "number" && part >= 0 && part < value.length ? value[part] : undefined;
  }
  if (value !== null && typeof value === "object" && typeof part === "string") {
    return Object.hasOwn(value, part) ? value[part] : undefined;
  }
  return undefined;
}

export function resolve(doc: Json, path: Path): Json {
  let value = doc;
  for (let i = 0; i < path.length; i++) {
    const next = child(value, path[i]!);
    if (next === undefined) throw new PathError(`${display(path.slice(0, i + 1))} does not exist`);
    value = next;
  }
  return value;
}

export function tryResolve(doc: Json, path: Path): Json | undefined {
  try {
    return resolve(doc, path);
  } catch {
    return undefined;
  }
}

export function isPrefix(prefix: Path, path: Path): boolean {
  return prefix.length <= path.length && prefix.every((p, i) => p === path[i]);
}

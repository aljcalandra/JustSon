import { isContainer, kindOf } from "./nodes";
import { isPrefix, pathKey } from "./paths";
import type { Json, Path } from "./types";

/** "type" = both sides exist but differ in kind (e.g. object vs array); not descended into. */
export type ChangeKind = "added" | "removed" | "changed" | "type";

export interface Change {
  path: Path;
  kind: ChangeKind;
  left?: Json;
  right?: Json;
}

/** Status of one path in a comparison; "contains" = not changed itself but has changes below. */
export type Status = ChangeKind | "same" | "contains";

type Pending = { compare: [Json, Json, Path] } | { emit: Change };

/**
 * Structural diff in document order. Objects compare by key (order-insensitive), arrays by index.
 * Added/removed/retyped subtrees are reported once at their root, not per descendant.
 */
export function diff(left: Json, right: Json): Change[] {
  const changes: Change[] = [];
  const stack: Pending[] = [{ compare: [left, right, []] }];
  while (stack.length) {
    const item = stack.pop()!;
    if ("emit" in item) {
      changes.push(item.emit);
      continue;
    }
    const [a, b, path] = item.compare;
    if (a === b) continue;
    if (kindOf(a) !== kindOf(b)) {
      changes.push({ path, kind: "type", left: a, right: b });
      continue;
    }
    if (!isContainer(a) || !isContainer(b)) {
      changes.push({ path, kind: "changed", left: a, right: b });
      continue;
    }
    const next: Pending[] = [];
    if (Array.isArray(a) && Array.isArray(b)) {
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const p = [...path, i];
        if (i >= b.length) next.push({ emit: { path: p, kind: "removed", left: a[i]! } });
        else if (i >= a.length) next.push({ emit: { path: p, kind: "added", right: b[i]! } });
        else next.push({ compare: [a[i]!, b[i]!, p] });
      }
    } else if (!Array.isArray(a) && !Array.isArray(b)) {
      for (const key of Object.keys(a)) {
        const p = [...path, key];
        next.push(
          Object.hasOwn(b, key)
            ? { compare: [a[key]!, b[key]!, p] }
            : { emit: { path: p, kind: "removed", left: a[key]! } },
        );
      }
      for (const key of Object.keys(b)) {
        if (!Object.hasOwn(a, key)) {
          next.push({ emit: { path: [...path, key], kind: "added", right: b[key]! } });
        }
      }
    }
    for (let i = next.length - 1; i >= 0; i--) stack.push(next[i]!);
  }
  return changes;
}

export interface DiffIndex {
  changes: Change[];
  counts: Record<ChangeKind, number>;
  status(path: Path): Status;
}

export function indexDiff(changes: Change[]): DiffIndex {
  const counts: Record<ChangeKind, number> = { added: 0, removed: 0, changed: 0, type: 0 };
  const exact = new Map<string, ChangeKind>();
  const ancestors = new Set<string>();
  for (const change of changes) {
    counts[change.kind]++;
    exact.set(pathKey(change.path), change.kind);
    for (let i = 0; i < change.path.length; i++) ancestors.add(pathKey(change.path.slice(0, i)));
  }
  return {
    changes,
    counts,
    status(path) {
      const key = pathKey(path);
      const kind = exact.get(key);
      if (kind) return kind;
      if (ancestors.has(key)) return "contains";
      // Below an added/removed/retyped root: inherit its status.
      for (let i = path.length - 1; i >= 0; i--) {
        const inherited = exact.get(pathKey(path.slice(0, i)));
        if (inherited) return inherited;
      }
      return "same";
    },
  };
}

export function changesUnder(changes: Change[], path: Path): Change[] {
  return changes.filter((c) => isPrefix(path, c.path));
}

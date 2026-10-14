import { isContainer, keys, size } from "../core/nodes";
import { child, pathKey, tryResolve } from "../core/paths";
import type { Json, Path, Segment } from "../core/types";

export const CARD_W = 300;
export const HEADER_H = 36;
export const ROW_H = 26;
export const MORE_H = 30;
export const GAP_X = 90;
export const GAP_Y = 28;
export const ROWS = 50;

export interface Row {
  name: Segment;
  path: Path;
  value: Json;
  /** A non-empty object/array: it can open as its own card. */
  opens: boolean;
  open: boolean;
}

export interface Card {
  key: string;
  path: Path;
  /** Key this value sits under in its parent; undefined for the diagram's root card. */
  name?: Segment;
  value: Json;
  rows: Row[];
  hiddenRows: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Edge {
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Layout {
  cards: Card[];
  edges: Edge[];
  width: number;
  height: number;
}

/**
 * Left-to-right tree of cards: the focus value is the root card, and every open row adds a child
 * card one column to the right. Each subtree gets its own vertical band, so cards never overlap.
 */
export function layout(
  doc: Json,
  focus: Path,
  open: ReadonlySet<string>,
  limits: ReadonlyMap<string, number> = new Map(),
): Layout {
  const cards: Card[] = [];
  const edges: Edge[] = [];
  let width = 0;

  const place = (value: Json, path: Path, name: Segment | undefined, depth: number, top: number): number => {
    const names = keys(value);
    const limit = limits.get(pathKey(path)) ?? ROWS;
    const rows: Row[] = names.slice(0, limit).map((n) => {
      const rowPath = [...path, n];
      const rowValue = child(value, n)!;
      const opens = isContainer(rowValue) && size(rowValue) > 0;
      return { name: n, path: rowPath, value: rowValue, opens, open: opens && open.has(pathKey(rowPath)) };
    });
    const hiddenRows = names.length - rows.length;
    const scalar = !isContainer(value);
    const h = HEADER_H + (scalar ? ROW_H : Math.max(rows.length, 1) * ROW_H) + (hiddenRows > 0 ? MORE_H : 0);
    const x = depth * (CARD_W + GAP_X);
    const card: Card = { key: pathKey(path), path, name, value, rows, hiddenRows, x, y: top, w: CARD_W, h };
    cards.push(card);
    width = Math.max(width, x + CARD_W);

    let childTop = top;
    rows.forEach((row, i) => {
      if (!row.open) return;
      const childBottom = place(row.value, row.path, row.name, depth + 1, childTop);
      edges.push({
        from: card.key,
        to: pathKey(row.path),
        x1: x + CARD_W,
        y1: top + HEADER_H + i * ROW_H + ROW_H / 2,
        x2: x + CARD_W + GAP_X,
        y2: childTop + HEADER_H / 2,
      });
      childTop = childBottom + GAP_Y;
    });
    const childrenBottom = childTop > top ? childTop - GAP_Y : top;
    return Math.max(top + h, childrenBottom);
  };

  const root = tryResolve(doc, focus);
  if (root === undefined) return { cards, edges, width: 0, height: 0 };
  const height = place(root, focus, focus[focus.length - 1], 0, 0);
  return { cards, edges, width, height };
}

/** Paths to open (relative to focus) so that `target` becomes visible as a row of some card. */
export function ancestorsToOpen(focus: Path, target: Path): string[] {
  const out: string[] = [];
  for (let i = focus.length + 1; i < target.length; i++) out.push(pathKey(target.slice(0, i)));
  return out;
}

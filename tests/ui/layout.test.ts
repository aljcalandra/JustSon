import { describe, expect, it } from "vitest";
import { pathKey } from "../../src/core/paths";
import type { Json, Path } from "../../src/core/types";
import {
  ancestorsToOpen,
  CARD_W,
  GAP_X,
  GAP_Y,
  HEADER_H,
  type Layout,
  layout,
  MORE_H,
  ROW_H,
  ROWS,
} from "../../src/ui/layout";

const doc: Json = {
  name: "root",
  a: { x: 1, y: { deep: true } },
  b: [{ id: 1 }, { id: 2 }],
  empty: {},
};
const opened = (...paths: Path[]) => new Set(paths.map(pathKey));
const byPath = (l: Layout, path: Path) => l.cards.find((c) => c.key === pathKey(path))!;

function assertNoOverlap(l: Layout) {
  for (const a of l.cards) {
    for (const b of l.cards) {
      if (a === b) continue;
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlap, `${a.key} overlaps ${b.key}`).toBe(false);
    }
  }
}

describe("layout", () => {
  it("starts with just the root card listing every field", () => {
    const l = layout(doc, [], new Set());
    expect(l.cards).toHaveLength(1);
    const root = l.cards[0]!;
    expect(root.rows.map((r) => [r.name, r.opens, r.open])).toEqual([
      ["name", false, false],
      ["a", true, false],
      ["b", true, false],
      ["empty", false, false],
    ]);
    expect(root.h).toBe(HEADER_H + 4 * ROW_H);
    expect(l.edges).toEqual([]);
  });

  it("opens a child card one column right, wired from its row", () => {
    const l = layout(doc, [], opened(["b"]));
    const b = byPath(l, ["b"]);
    expect([b.x, b.y, b.name]).toEqual([CARD_W + GAP_X, 0, "b"]);
    expect(l.cards[0]!.rows[2]!.open).toBe(true);
    expect(l.edges).toEqual([
      {
        from: pathKey([]),
        to: pathKey(["b"]),
        x1: CARD_W,
        y1: HEADER_H + 2 * ROW_H + ROW_H / 2,
        x2: CARD_W + GAP_X,
        y2: HEADER_H / 2,
      },
    ]);
  });

  it("stacks sibling subtrees in their own bands", () => {
    const l = layout(doc, [], opened(["a"], ["a", "y"], ["b"], ["b", 0], ["b", 1]));
    expect(l.cards.map((c) => c.key)).toEqual(
      [[], ["a"], ["a", "y"], ["b"], ["b", 0], ["b", 1]].map(pathKey),
    );
    const a = byPath(l, ["a"]);
    const ay = byPath(l, ["a", "y"]);
    const b = byPath(l, ["b"]);
    expect(ay.x).toBe(2 * (CARD_W + GAP_X));
    expect(b.y).toBe(Math.max(a.y + a.h, ay.y + ay.h) + GAP_Y);
    assertNoOverlap(l);
    expect(l.height).toBe(Math.max(...l.cards.map((c) => c.y + c.h)));
    expect(l.width).toBe(3 * CARD_W + 2 * GAP_X);
  });

  it("ignores open paths whose parent is closed", () => {
    const l = layout(doc, [], opened(["a", "y"]));
    expect(l.cards).toHaveLength(1);
  });

  it("roots the diagram at the focus", () => {
    const l = layout(doc, ["a"], opened(["a", "y"]));
    expect(l.cards.map((c) => c.key)).toEqual([pathKey(["a"]), pathKey(["a", "y"])]);
    expect(l.cards[0]!.x).toBe(0);
  });

  it("pages long cards", () => {
    const wide = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`k${i}`, i]));
    const first = layout(wide, [], new Set()).cards[0]!;
    expect(first.rows).toHaveLength(ROWS);
    expect(first.hiddenRows).toBe(120 - ROWS);
    expect(first.h).toBe(HEADER_H + ROWS * ROW_H + MORE_H);
    const more = layout(wide, [], new Set(), new Map([[pathKey([]), 200]])).cards[0]!;
    expect(more.rows).toHaveLength(120);
    expect(more.h).toBe(HEADER_H + 120 * ROW_H);
  });

  it("handles scalar and missing roots", () => {
    expect(layout(doc, ["name"], new Set()).cards[0]!.h).toBe(HEADER_H + ROW_H);
    expect(layout(doc, ["nope"], new Set()).cards).toEqual([]);
  });
});

describe("ancestorsToOpen", () => {
  it("lists the containers between focus and target", () => {
    expect(ancestorsToOpen([], ["b", 1, "id"])).toEqual([pathKey(["b"]), pathKey(["b", 1])]);
    expect(ancestorsToOpen(["b"], ["b", 1, "id"])).toEqual([pathKey(["b", 1])]);
    expect(ancestorsToOpen([], ["name"])).toEqual([]);
  });
});

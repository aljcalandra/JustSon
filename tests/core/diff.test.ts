import { describe, expect, it } from "vitest";
import { changesUnder, diff, indexDiff } from "../../src/core/diff";
import type { Json } from "../../src/core/types";

describe("diff", () => {
  it("finds nothing in equal documents regardless of key order", () => {
    expect(diff({ a: 1, b: [1, { c: null }] }, { b: [1, { c: null }], a: 1 })).toEqual([]);
  });

  it("reports scalar changes, additions, removals and type changes", () => {
    const left: Json = { name: "a", tags: ["x", "y"], meta: { v: 1 }, gone: true, shape: [1] };
    const right: Json = { name: "b", tags: ["x"], meta: { v: 1, w: 2 }, shape: { 0: 1 } };
    expect(diff(left, right)).toEqual([
      { path: ["name"], kind: "changed", left: "a", right: "b" },
      { path: ["tags", 1], kind: "removed", left: "y" },
      { path: ["meta", "w"], kind: "added", right: 2 },
      { path: ["gone"], kind: "removed", left: true },
      { path: ["shape"], kind: "type", left: [1], right: { 0: 1 } },
    ]);
  });

  it("reports a removed subtree once, at its root", () => {
    expect(diff({ a: { deep: { er: [1, 2, 3] } } }, {})).toEqual([
      { path: ["a"], kind: "removed", left: { deep: { er: [1, 2, 3] } } },
    ]);
  });

  it("keeps document order across nested and sibling changes", () => {
    const changes = diff({ a: { x: 1, y: 2 }, b: 1, c: [0] }, { a: { x: 9, z: 3 }, b: 2, c: [0, 1] });
    expect(changes.map((c) => c.path)).toEqual([["a", "x"], ["a", "y"], ["a", "z"], ["b"], ["c", 1]]);
  });

  it("treats a root type change as a single change", () => {
    expect(diff([1], { a: 1 })).toEqual([{ path: [], kind: "type", left: [1], right: { a: 1 } }]);
  });

  it("distinguishes null, false and 0", () => {
    expect(diff([null, false, 0], [false, 0, null]).map((c) => c.kind)).toEqual(["type", "type", "type"]);
  });
});

describe("indexDiff", () => {
  const index = indexDiff(
    diff(
      { a: { b: 1, c: 2 }, d: { e: 1 }, same: { x: 1 } },
      { a: { b: 9, c: 2 }, f: { g: 1 }, same: { x: 1 } },
    ),
  );

  it("counts by kind", () => {
    expect(index.counts).toEqual({ added: 1, removed: 1, changed: 1, type: 0 });
  });

  it("gives every path a status", () => {
    expect(index.status([])).toBe("contains");
    expect(index.status(["a"])).toBe("contains");
    expect(index.status(["a", "b"])).toBe("changed");
    expect(index.status(["a", "c"])).toBe("same");
    expect(index.status(["d"])).toBe("removed");
    expect(index.status(["d", "e"])).toBe("removed");
    expect(index.status(["f", "g"])).toBe("added");
    expect(index.status(["same", "x"])).toBe("same");
  });

  it("filters changes under a path", () => {
    expect(changesUnder(index.changes, ["a"]).map((c) => c.path)).toEqual([["a", "b"]]);
  });
});

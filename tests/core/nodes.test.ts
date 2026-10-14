import { describe, expect, it } from "vitest";
import { keys, kindOf, preview, size, stats } from "../../src/core/nodes";

describe("kindOf / size / keys", () => {
  it("classifies every JSON kind", () => {
    expect([{}, [], "", 0, false, null].map(kindOf)).toEqual([
      "object",
      "array",
      "string",
      "number",
      "boolean",
      "null",
    ]);
  });

  it("counts and lists children", () => {
    expect(size({ a: 1, b: 2 })).toBe(2);
    expect(size([1, 2, 3])).toBe(3);
    expect(size("abc")).toBe(0);
    expect(keys(["x", "y"])).toEqual([0, 1]);
    expect(keys({ b: 1, a: 2 })).toEqual(["b", "a"]);
  });
});

describe("preview", () => {
  it("summarizes containers and truncates long values", () => {
    expect(preview({})).toBe("{}");
    expect(preview([])).toBe("[]");
    expect(preview([1])).toBe("[1 item]");
    expect(preview({ id: 1, name: "x" })).toBe("{id, name}");
    expect(preview(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`key${i}`, i])), 30)).toMatch(
      /^\{key0, key1, .*, …\}$/,
    );
    expect(preview("x".repeat(200), 10)).toBe(`"${"x".repeat(8)}…`);
    expect(preview(null)).toBe("null");
  });
});

describe("stats", () => {
  it("counts values by kind and measures depth", () => {
    const s = stats({ a: [1, { b: null }], c: "x" });
    expect(s.nodes).toBe(6);
    expect(s.maxDepth).toBe(3);
    expect(s.kinds).toEqual({ object: 2, array: 1, string: 1, number: 1, boolean: 0, null: 1 });
  });

  it("handles nesting deeper than the call stack", () => {
    let deep: unknown = 0;
    for (let i = 0; i < 50_000; i++) deep = [deep];
    expect(stats(deep as never).maxDepth).toBe(50_000);
  });
});

import { describe, expect, it } from "vitest";
import { search } from "../../src/core/search";

const doc = { users: [{ Name: "Ada", city: "London" }, { Name: "Alan", city: "Wilmslow" }], count: 2 };

describe("search", () => {
  it("matches keys and scalar values case-insensitively, in document order", () => {
    const { matches, truncated } = search(doc, "lo");
    expect(truncated).toBe(false);
    expect(matches.map((m) => [m.path, m.on])).toEqual([
      [["users", 0, "city"], "value"],
      [["users", 1, "city"], "value"],
    ]);
    expect(search(doc, "name").matches.map((m) => m.path)).toEqual([
      ["users", 0, "Name"],
      ["users", 1, "Name"],
    ]);
  });

  it("matches numbers and booleans as text", () => {
    expect(search(doc, "2").matches.map((m) => m.path)).toEqual([["count"]]);
  });

  it("returns nothing for a blank query", () => {
    expect(search(doc, "  ").matches).toEqual([]);
  });

  it("stops at the limit and says so", () => {
    const many = Array.from({ length: 50 }, () => "hit");
    const result = search(many, "hit", 10);
    expect(result.matches).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });
});

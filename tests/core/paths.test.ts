import { describe, expect, it } from "vitest";
import { display, isPrefix, PathError, resolve, tryResolve } from "../../src/core/paths";

const doc = { store: { book: [{ title: "A", "first name": "x" }] }, "": 1, __proto__x: 2 };

describe("display", () => {
  it("uses dot notation for identifiers and brackets otherwise", () => {
    expect(display([])).toBe("$");
    expect(display(["store", "book", 0, "title"])).toBe("$.store.book[0].title");
    expect(display(["store", "book", 0, "first name"])).toBe('$.store.book[0]["first name"]');
    expect(display([""])).toBe('$[""]');
    expect(display(["a.b", 'q"uote'])).toBe('$["a.b"]["q\\"uote"]');
  });
});

describe("resolve", () => {
  it("walks objects and arrays", () => {
    expect(resolve(doc, ["store", "book", 0, "title"])).toBe("A");
    expect(resolve(doc, [""])).toBe(1);
    expect(resolve(doc, [])).toBe(doc);
  });

  it("names the first missing segment", () => {
    expect(() => resolve(doc, ["store", "nope", "x"])).toThrow(new PathError("$.store.nope does not exist"));
    expect(() => resolve(doc, ["store", "book", 5])).toThrow(PathError);
    expect(() => resolve(doc, ["store", "book", "0"])).toThrow(PathError);
  });

  it("does not see inherited properties", () => {
    expect(tryResolve(doc, ["toString"])).toBeUndefined();
    expect(tryResolve(doc, ["store", "constructor"])).toBeUndefined();
  });

  it("finds a literal __proto__ key from JSON.parse", () => {
    const parsed = JSON.parse('{"__proto__": {"x": 1}}');
    expect(resolve(parsed, ["__proto__", "x"])).toBe(1);
  });
});

describe("isPrefix", () => {
  it("compares segment by segment", () => {
    expect(isPrefix([], ["a"])).toBe(true);
    expect(isPrefix(["a", 0], ["a", 0, "b"])).toBe(true);
    expect(isPrefix(["a", "0"], ["a", 0])).toBe(false);
    expect(isPrefix(["a", "b"], ["a"])).toBe(false);
  });
});

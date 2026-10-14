import { describe, expect, it } from "vitest";
import { DocStore, ParseError } from "../src/storage";

/** In-memory Storage with a character quota, like a browser's ~5M-char localStorage limit. */
class FakeStorage implements Storage {
  private data = new Map<string, string>();
  constructor(private quota = Number.POSITIVE_INFINITY) {}
  get length() {
    return this.data.size;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    let used = k.length + v.length;
    for (const [key, value] of this.data) if (key !== k) used += key.length + value.length;
    if (used > this.quota) throw new DOMException("full", "QuotaExceededError");
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  clear() {
    this.data.clear();
  }
}

describe("DocStore", () => {
  it("persists documents across instances", () => {
    const storage = new FakeStorage();
    const meta = new DocStore(storage).add("a.json", '{"x": [1, 2]}');
    const reopened = new DocStore(storage);
    expect(reopened.list()).toEqual([meta]);
    expect(reopened.get(meta.id)).toEqual({ x: [1, 2] });
    expect(reopened.text(meta.id)).toBe('{"x": [1, 2]}');
  });

  it("stores the original text and format, and reparses it on load", () => {
    const storage = new FakeStorage();
    const meta = new DocStore(storage).add("config.yml", "a: 1\nb: [x]\n");
    expect(meta.format).toBe("yaml");
    const reopened = new DocStore(storage);
    expect(reopened.text(meta.id)).toBe("a: 1\nb: [x]\n");
    expect(reopened.get(meta.id)).toEqual({ a: 1, b: ["x"] });
  });

  it("loads entries saved before formats existed as JSON", () => {
    const storage = new FakeStorage();
    storage.setItem("justson:index", JSON.stringify([{ id: "old", name: "old.json", chars: 7, addedAt: 0, saved: true }]));
    storage.setItem("justson:doc:old", '{"a":1}');
    expect(new DocStore(storage).get("old")).toEqual({ a: 1 });
  });

  it("rejects invalid JSON without storing anything", () => {
    const storage = new FakeStorage();
    const store = new DocStore(storage);
    expect(() => store.add("bad.json", "{nope")).toThrow(ParseError);
    expect(store.list()).toEqual([]);
    expect(storage.length).toBe(0);
  });

  it("keeps an oversized document for the session only", () => {
    const storage = new FakeStorage(500);
    const store = new DocStore(storage);
    const small = store.add("small.json", "[1]");
    const big = store.add("big.json", JSON.stringify("x".repeat(1000)));
    expect(big.saved).toBe(false);
    expect(store.get(big.id)).toBe("x".repeat(1000));
    expect(store.list().map((m) => m.name)).toEqual(["small.json", "big.json"]);
    expect(new DocStore(storage).list()).toEqual([small]);
  });

  it("renames and removes", () => {
    const storage = new FakeStorage();
    const store = new DocStore(storage);
    const meta = store.add("a.json", "{}");
    store.rename(meta.id, "renamed");
    expect(new DocStore(storage).list()[0]?.name).toBe("renamed");
    store.remove(meta.id);
    expect(new DocStore(storage).list()).toEqual([]);
    expect(storage.length).toBe(1); // just the empty index
  });

  it("drops index rows whose text disappeared", () => {
    const storage = new FakeStorage();
    const meta = new DocStore(storage).add("a.json", "{}");
    storage.removeItem(`justson:doc:${meta.id}`);
    expect(new DocStore(storage).list()).toEqual([]);
  });

  it("round-trips UI state with defaults for missing fields", () => {
    const storage = new FakeStorage();
    const store = new DocStore(storage);
    expect(store.loadState().mode).toBe("explore");
    store.saveState({ ...store.loadState(), mode: "compare", focus: ["a", 0] });
    const state = new DocStore(storage).loadState();
    expect(state.mode).toBe("compare");
    expect(state.focus).toEqual(["a", 0]);
    expect(state.onlyDiffs).toBe(false);
  });

  it("ignores corrupt index and state entries", () => {
    const storage = new FakeStorage();
    storage.setItem("justson:index", "{broken");
    storage.setItem("justson:state", "{broken");
    const store = new DocStore(storage);
    expect(store.list()).toEqual([]);
    expect(store.loadState().mode).toBe("explore");
  });
});

import type { Json, Path } from "./core/types";
import { detectFormat, type Format, parseAs, parseDocument } from "./formats";

export { ParseError } from "./formats";

export interface DocMeta {
  id: string;
  name: string;
  /** Source format; the original text is stored and parsed on load. Absent on older entries (JSON). */
  format?: Format;
  /** Why the text needed lenient parsing, if it did (e.g. XML that isn't well-formed). */
  note?: string;
  /** Length of the original text in UTF-16 code units (what localStorage counts). */
  chars: number;
  addedAt: number;
  /** False when the browser's storage quota was exceeded; the doc lasts only this session. */
  saved: boolean;
}

export interface UiState {
  mode: "explore" | "compare";
  /** How Explore draws a document: linked cards, or the indented list. */
  view: "diagram" | "list";
  docId?: string;
  focus: Path;
  expanded: string[];
  left?: string;
  right?: string;
  compareFocus: Path;
  compareExpanded: string[];
  onlyDiffs: boolean;
}

export const DEFAULT_STATE: UiState = {
  mode: "explore",
  view: "diagram",
  focus: [],
  expanded: [],
  compareFocus: [],
  compareExpanded: [],
  onlyDiffs: false,
};

/** Documents in localStorage: an index entry plus one entry per document's raw text. */
export class DocStore {
  private readonly parsed = new Map<string, Json>();
  private readonly unsaved = new Map<string, string>();
  private index: DocMeta[];

  constructor(
    private readonly storage: Storage,
    private readonly prefix = "justson",
  ) {
    this.index = this.readJson<DocMeta[]>("index") ?? [];
    // Drop index rows whose text was evicted or cleared elsewhere.
    this.index = this.index.filter((m) => this.storage.getItem(this.key(`doc:${m.id}`)) !== null);
  }

  list(): DocMeta[] {
    return [...this.index];
  }

  meta(id: string): DocMeta | undefined {
    return this.index.find((m) => m.id === id);
  }

  add(name: string, text: string, format: Format = detectFormat(name, text)): DocMeta {
    const { value: doc, note } = parseDocument(format, text);
    const meta: DocMeta = { id: newId(), name, format, chars: text.length, addedAt: Date.now(), saved: true };
    if (note) meta.note = note;
    this.parsed.set(meta.id, doc);
    try {
      this.storage.setItem(this.key(`doc:${meta.id}`), text);
      this.index.push(meta);
      this.writeIndex();
    } catch (e) {
      if (!isQuotaError(e)) throw e;
      this.storage.removeItem(this.key(`doc:${meta.id}`));
      this.index = this.index.filter((m) => m.id !== meta.id);
      meta.saved = false;
      this.unsaved.set(meta.id, text);
      this.index.push(meta);
      this.writeIndexQuietly();
    }
    return meta;
  }

  get(id: string): Json | undefined {
    const cached = this.parsed.get(id);
    if (cached !== undefined) return cached;
    const text = this.unsaved.get(id) ?? this.storage.getItem(this.key(`doc:${id}`));
    if (text === null) return undefined;
    const doc = parseAs(this.meta(id)?.format ?? "json", text);
    this.parsed.set(id, doc);
    return doc;
  }

  text(id: string): string | undefined {
    return this.unsaved.get(id) ?? this.storage.getItem(this.key(`doc:${id}`)) ?? undefined;
  }

  rename(id: string, name: string): void {
    const meta = this.meta(id);
    if (!meta) return;
    meta.name = name;
    this.writeIndexQuietly();
  }

  remove(id: string): void {
    this.storage.removeItem(this.key(`doc:${id}`));
    this.parsed.delete(id);
    this.unsaved.delete(id);
    this.index = this.index.filter((m) => m.id !== id);
    this.writeIndexQuietly();
  }

  /** Characters this app holds in storage (each is 2 bytes in most browsers). */
  usage(): number {
    let total = 0;
    for (let i = 0; i < this.storage.length; i++) {
      const k = this.storage.key(i);
      if (k?.startsWith(`${this.prefix}:`)) total += k.length + (this.storage.getItem(k)?.length ?? 0);
    }
    return total;
  }

  loadState(): UiState {
    return { ...DEFAULT_STATE, ...this.readJson<Partial<UiState>>("state") };
  }

  saveState(state: UiState): void {
    try {
      this.storage.setItem(this.key("state"), JSON.stringify(state));
    } catch (e) {
      if (!isQuotaError(e)) throw e;
    }
  }

  private key(name: string): string {
    return `${this.prefix}:${name}`;
  }

  private readJson<T>(name: string): T | undefined {
    const raw = this.storage.getItem(this.key(name));
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  private writeIndex(): void {
    // Unsaved docs are session-only; persisting their rows would leave dangling entries.
    const rows = this.index.filter((m) => m.saved);
    this.storage.setItem(this.key("index"), JSON.stringify(rows));
  }

  private writeIndexQuietly(): void {
    try {
      this.writeIndex();
    } catch (e) {
      if (!isQuotaError(e)) throw e;
    }
  }
}

function isQuotaError(e: unknown): boolean {
  return e instanceof DOMException && (e.name === "QuotaExceededError" || e.code === 22);
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

import "./styles.css";
import { type DiffIndex, diff, indexDiff, type Status } from "./core/diff";
import { isContainer, keys, kindOf, size, stats, truncate } from "./core/nodes";
import { child, display, isPrefix, pathKey, tryResolve } from "./core/paths";
import { search } from "./core/search";
import type { Json, Path } from "./core/types";
import { detectFormat, FORMATS, type Format } from "./formats";
import { DocStore, ParseError, type UiState } from "./storage";
import { append, clear, copyText, formatChars, h } from "./ui/dom";
import { Diagram } from "./ui/diagram";
import { ancestorsToOpen, layout, ROWS } from "./ui/layout";
import { confirmModal, promptModal } from "./ui/modal";
import { compareTree, exploreTree, PAGE, type TreeEvents } from "./ui/tree";

const INSPECT_MAX = 200_000;
const CHANGES_SHOWN = 500;

class App {
  private readonly store = new DocStore(window.localStorage);
  private state: UiState = this.store.loadState();
  private readonly limits = new Map<string, number>();
  private readonly cardLimits = new Map<string, number>();
  /** Card to pan into view after the next render (just opened, or a search hit). */
  private pendingReveal: string | undefined;
  private readonly diagram = new Diagram({
    onToggle: (path) => {
      const open = new Set(this.state.expanded);
      const key = pathKey(path);
      if (open.delete(key)) {
        this.pendingReveal = undefined;
      } else {
        open.add(key);
        this.pendingReveal = key;
      }
      this.selected = path;
      this.update({ expanded: [...open] });
    },
    onSelect: (path) => {
      this.selected = path;
      this.render();
    },
    onFocus: (path) => this.zoom("explore", path),
    onMore: (path) => {
      const key = pathKey(path);
      this.cardLimits.set(key, (this.cardLimits.get(key) ?? ROWS) + ROWS);
      this.render();
    },
  });
  private selected: Path | undefined;
  private query = "";
  private diffs = new Map<string, DiffIndex>();

  private readonly sidebar = document.getElementById("sidebar")!;
  private readonly main = document.getElementById("main")!;
  private readonly toastEl = document.getElementById("toast")!;

  start(): void {
    const ids = new Set(this.store.list().map((m) => m.id));
    if (this.state.docId && !ids.has(this.state.docId)) this.state.docId = undefined;
    if (this.state.left && !ids.has(this.state.left)) this.state.left = undefined;
    if (this.state.right && !ids.has(this.state.right)) this.state.right = undefined;
    this.state.docId ??= this.store.list()[0]?.id;

    for (const tab of document.querySelectorAll<HTMLButtonElement>(".tabs [data-mode]")) {
      tab.addEventListener("click", () => this.setMode(tab.dataset.mode as UiState["mode"]));
    }
    for (const option of document.querySelectorAll<HTMLButtonElement>(".view-switch [data-view]")) {
      option.addEventListener("click", () => {
        const view = option.dataset.view as UiState["view"];
        if (view === this.state.view) return;
        // Both views share the open paths and selection; only paging and the viewport are per-view.
        if (this.selected) this.pendingReveal = pathKey(this.selected.slice(0, -1));
        this.update({ view });
      });
    }
    this.setupDropZone();
    this.renderSidebar();
    this.render();
  }

  // ---- state helpers -------------------------------------------------------------------

  private update(patch: Partial<UiState>): void {
    this.state = { ...this.state, ...patch };
    this.store.saveState(this.state);
    this.render();
  }

  private setMode(mode: UiState["mode"]): void {
    this.selected = undefined;
    this.query = "";
    this.update({ mode });
  }

  private openDoc(id: string): void {
    this.selected = undefined;
    this.query = "";
    this.limits.clear();
    this.cardLimits.clear();
    this.diagram.reset();
    this.update({ mode: "explore", docId: id, focus: [], expanded: [] });
    this.renderSidebar();
  }

  private treeEvents(scope: "explore" | "compare"): TreeEvents {
    const expandedKey = scope === "explore" ? "expanded" : "compareExpanded";
    return {
      onToggle: (path) => {
        const set = new Set(this.state[expandedKey]);
        const key = pathKey(path);
        if (!set.delete(key)) set.add(key);
        this.update({ [expandedKey]: [...set] });
      },
      onZoom: (path) => this.zoom(scope, path),
      onSelect: (path) => {
        this.selected = path;
        this.render();
      },
      onMore: (path) => {
        const key = pathKey(path);
        this.limits.set(key, (this.limits.get(key) ?? PAGE) + PAGE);
        this.render();
      },
    };
  }

  private zoom(scope: "explore" | "compare", path: Path, select?: Path): void {
    const expandedKey = scope === "explore" ? "expanded" : "compareExpanded";
    // Keep expansions inside the new focus; drop the rest so zooming out later starts clean.
    const expanded = this.state[expandedKey].filter((k) => {
      const p = JSON.parse(k) as Path;
      return isPrefix(path, p) && p.length > path.length;
    });
    this.selected = select;
    if (scope === "explore") this.diagram.reset();
    this.update(
      scope === "explore"
        ? { focus: path, expanded }
        : { compareFocus: path, compareExpanded: expanded },
    );
  }

  // ---- sidebar -------------------------------------------------------------------------

  private renderSidebar(): void {
    const docs = this.store.list();
    const fileInput = h("input", {
      type: "file",
      accept: ".json,.yaml,.yml,.xml,application/json,application/yaml,application/xml,text/xml,text/yaml,text/plain",
      multiple: true,
      hidden: true,
      on: {
        change: () => {
          void this.addFiles([...(fileInput.files ?? [])]);
          fileInput.value = "";
        },
      },
    });
    clear(this.sidebar);
    this.sidebar.append(
      h(
        "div",
        {
          class: "drop",
          attrs: { role: "button", tabindex: "0" },
          on: {
            click: () => fileInput.click(),
            keydown: (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInput.click();
              }
            },
          },
        },
        h("strong", null, "Open a file"),
        h("span", null, "JSON, YAML or XML. Drop here or click to choose"),
      ),
      fileInput,
      h("button", { class: "secondary wide", on: { click: () => this.pasteDialog() } }, "Paste text…"),
      h("h2", null, `Documents (${docs.length})`),
      docs.length === 0
        ? h("p", { class: "muted" }, "Nothing yet. Everything you open stays in this browser.")
        : h(
            "ul",
            { class: "docs" },
            ...docs.map((m) =>
              h(
                "li",
                {
                  class: m.id === this.state.docId && this.state.mode === "explore" ? "active" : "",
                },
                h(
                  "button",
                  { class: "doc", title: m.name, on: { click: () => this.openDoc(m.id) } },
                  h("span", { class: "name" }, m.name),
                  h(
                    "span",
                    { class: "meta" },
                    h("span", { class: `badge fmt fmt-${m.format ?? "json"}` }, FORMATS[m.format ?? "json"]),
                    m.note ? h("span", { class: "badge warn", title: m.note }, "lenient") : null,
                    formatChars(m.chars),
                    m.saved ? null : h("span", { class: "badge warn", title: "Too big for browser storage; it will be gone after a reload." }, "not saved"),
                  ),
                ),
                h(
                  "button",
                  {
                    class: "icon",
                    title: `Rename ${m.name}`,
                    on: {
                      click: async () => {
                        const name = await promptModal({
                          title: "Rename document",
                          value: m.name,
                          label: "Name",
                          confirmLabel: "Rename",
                        });
                        if (name) {
                          this.store.rename(m.id, name);
                          this.renderSidebar();
                          this.render();
                        }
                      },
                    },
                  },
                  "✎",
                ),
                h(
                  "button",
                  {
                    class: "icon danger",
                    title: `Delete ${m.name}`,
                    on: { click: () => void this.deleteDoc(m.id) },
                  },
                  "×",
                ),
              ),
            ),
          ),
      h(
        "p",
        { class: "muted usage" },
        `Using ${formatChars(this.store.usage())} of roughly 5 MB browser storage.`,
      ),
    );
  }

  private async deleteDoc(id: string): Promise<void> {
    const meta = this.store.meta(id);
    if (!meta) return;
    const ok = await confirmModal({
      title: "Delete document?",
      message: `"${meta.name}" will be removed from this browser. This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    this.store.remove(id);
    this.diffs = new Map([...this.diffs].filter(([k]) => !k.split("|").includes(id)));
    const first = this.store.list()[0]?.id;
    const patch: Partial<UiState> = {};
    if (this.state.docId === id) Object.assign(patch, { docId: first, focus: [], expanded: [] });
    if (this.state.left === id) patch.left = undefined;
    if (this.state.right === id) patch.right = undefined;
    this.renderSidebar();
    this.update(patch);
  }

  private async addFiles(files: File[]): Promise<void> {
    let last: string | undefined;
    for (const file of files) {
      last = this.addText(file.name, await file.text()) ?? last;
    }
    if (last) this.openDoc(last);
  }

  private addText(name: string, text: string, format: Format = detectFormat(name, text)): string | undefined {
    try {
      const meta = this.store.add(name, text, format);
      if (meta.note) this.toast(`"${name}": ${meta.note}`, "warn");
      if (!meta.saved) {
        this.toast(`"${name}" is too big for browser storage. It's open now but won't survive a reload.`, "warn");
      }
      return meta.id;
    } catch (e) {
      if (e instanceof ParseError) {
        this.toast(`"${name}" isn't valid ${FORMATS[format]}: ${e.message}`, "error");
        return undefined;
      }
      throw e;
    }
  }

  private pasteDialog(): void {
    const name = h("input", { type: "text", value: "Pasted text", attrs: { "aria-label": "Name" } });
    const format = h(
      "select",
      { attrs: { "aria-label": "Format" } },
      h("option", { value: "auto" }, "Detect automatically"),
      ...Object.entries(FORMATS).map(([value, label]) => h("option", { value }, label)),
    );
    const text = h("textarea", {
      rows: 16,
      spellcheck: false,
      placeholder: '{"json": true}\n\nyaml: true\n\n<xml>true</xml>',
      attrs: { "aria-label": "Document text" },
    });
    const dialog = h(
      "dialog",
      { class: "paste" },
      h(
        "form",
        {
          method: "dialog",
          on: {
            submit: (e) => {
              const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
              if (submitter?.value !== "add") return;
              const label = name.value.trim() || "Pasted text";
              const chosen = format.value === "auto" ? detectFormat("", text.value) : (format.value as Format);
              const id = this.addText(label, text.value, chosen);
              if (id === undefined) e.preventDefault();
              else this.openDoc(id);
            },
          },
        },
        h("h2", null, "Paste JSON, YAML or XML"),
        h("div", { class: "paste-fields" }, h("label", null, "Name", name), h("label", null, "Format", format)),
        text,
        h(
          "div",
          { class: "actions" },
          h("button", { class: "secondary", value: "cancel" }, "Cancel"),
          h("button", { value: "add" }, "Open"),
        ),
      ),
    );
    dialog.addEventListener("close", () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
    text.focus();
  }

  private setupDropZone(): void {
    let depth = 0;
    window.addEventListener("dragenter", (e) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      depth++;
      document.body.classList.add("dragging");
    });
    window.addEventListener("dragleave", () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) document.body.classList.remove("dragging");
    });
    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("drop", (e) => {
      e.preventDefault();
      depth = 0;
      document.body.classList.remove("dragging");
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) void this.addFiles(files);
    });
  }

  // ---- main views ----------------------------------------------------------------------

  private render(): void {
    for (const tab of document.querySelectorAll<HTMLButtonElement>(".tabs [data-mode]")) {
      tab.setAttribute("aria-selected", String(tab.dataset.mode === this.state.mode));
    }
    for (const option of document.querySelectorAll<HTMLButtonElement>(".view-switch [data-view]")) {
      option.setAttribute("aria-checked", String(option.dataset.view === this.state.view));
    }
    document.body.dataset.mode = this.state.mode;
    clear(this.main);
    if (this.state.mode === "explore") this.renderExplore();
    else this.renderCompare();
  }

  private renderExplore(): void {
    const id = this.state.docId;
    const doc = id ? this.store.get(id) : undefined;
    if (!id || doc === undefined) {
      this.main.append(
        h(
          "div",
          { class: "welcome" },
          h("h1", null, "Explore and compare structured data"),
          h("p", null, "Open a JSON, YAML or XML file, drop one anywhere on the page, or paste text. Zoom into any nested object, search keys and values, and compare two documents side by side, even across formats."),
          h("p", { class: "muted" }, "Nothing is uploaded: documents are kept only in this browser's storage."),
        ),
      );
      return;
    }
    const meta = this.store.meta(id)!;
    const s = stats(doc);
    const searchBox = h("input", {
      type: "search",
      placeholder: "Search keys and values",
      value: this.query,
      attrs: { "aria-label": "Search" },
      on: {
        keydown: (e) => {
          if (e.key === "Enter") {
            this.query = searchBox.value;
            this.render();
          }
        },
        // The search input's clear (×) button empties it without a keydown.
        input: () => {
          if (!searchBox.value && this.query) {
            this.query = "";
            this.render();
          }
        },
      },
    });

    this.main.append(
      h(
        "div",
        { class: "toolbar" },
        h("h1", { title: meta.name }, meta.name),
        searchBox,
      ),
      h(
        "p",
        { class: "stats muted" },
        `${s.nodes.toLocaleString()} values · depth ${s.maxDepth} · ${s.kinds.object.toLocaleString()} objects · ${s.kinds.array.toLocaleString()} arrays · ${formatChars(meta.chars)}`,
      ),
      this.breadcrumb(this.state.focus, (p) => this.zoom("explore", p)),
    );

    const body = h("div", { class: "workspace" });
    if (this.query.trim()) {
      body.append(this.searchResults(doc));
    } else if (this.state.view === "list") {
      body.append(
        exploreTree(
          doc,
          this.state.focus,
          { expanded: new Set(this.state.expanded), limits: this.limits, selected: this.selected },
          this.treeEvents("explore"),
        ),
      );
    } else {
      this.diagram.render(layout(doc, this.state.focus, new Set(this.state.expanded), this.cardLimits), {
        rootTitle: this.state.focus.length ? crumbLabel(this.state.focus[this.state.focus.length - 1]!) : meta.name,
        selected: this.selected,
      });
      body.append(this.diagram.el);
    }
    body.append(this.inspector({ doc, label: meta.name }));
    this.main.append(body);
    if (this.pendingReveal && !this.query.trim()) {
      if (this.state.view === "diagram") this.diagram.reveal(this.pendingReveal);
      else this.main.querySelector(".row.selected")?.scrollIntoView?.({ block: "center" });
    }
    this.pendingReveal = undefined;
  }

  /** Open everything between the focus and `target`, select it, and bring it into view. */
  private reveal(doc: Json, target: Path): void {
    const inFocus = isPrefix(this.state.focus, target) && target.length > this.state.focus.length;
    const focus = inFocus ? this.state.focus : [];
    const open = new Set(inFocus ? this.state.expanded : []);
    for (const key of ancestorsToOpen(focus, target)) open.add(key);
    // Make sure each level on the way shows the row we need, even past its first page.
    const [limits, page] = this.state.view === "list" ? [this.limits, PAGE] : [this.cardLimits, ROWS];
    let value: Json = tryResolve(doc, focus)!;
    for (let i = focus.length; i < target.length; i++) {
      const parentKey = pathKey(target.slice(0, i));
      const position = keys(value).indexOf(target[i]!);
      const limit = limits.get(parentKey) ?? page;
      if (position >= limit) limits.set(parentKey, Math.ceil((position + 1) / page) * page);
      value = child(value, target[i]!)!;
    }
    this.query = "";
    this.selected = target;
    this.pendingReveal = pathKey(target.slice(0, -1));
    if (!inFocus) this.diagram.reset();
    this.update({ focus, expanded: [...open] });
  }

  private searchResults(doc: Json): HTMLElement {
    const { matches, truncated } = search(doc, this.query);
    return h(
      "div",
      { class: "results" },
      h(
        "p",
        { class: "muted" },
        `${matches.length.toLocaleString()}${truncated ? "+" : ""} match${matches.length === 1 ? "" : "es"} for "${this.query}"`,
        " ",
        h("button", { class: "link", on: { click: () => { this.query = ""; this.render(); } } }, "Clear search"),
      ),
      h(
        "ol",
        null,
        ...matches.map((m) =>
          h(
            "li",
            null,
            h(
              "button",
              {
                class: "result",
                on: {
                  click: () => this.reveal(doc, m.path),
                },
              },
              h("span", { class: "path" }, display(m.path)),
              h("span", { class: `value kind-${kindOf(m.value)}` }, isContainer(m.value) ? `${kindOf(m.value)} (${size(m.value)})` : truncate(JSON.stringify(m.value), 80)),
            ),
          ),
        ),
      ),
    );
  }

  private renderCompare(): void {
    const docs = this.store.list();
    if (docs.length < 2) {
      this.main.append(
        h("div", { class: "welcome" }, h("h1", null, "Compare"), h("p", null, "Open at least two documents to compare them.")),
      );
      return;
    }
    const left = this.state.left ?? docs[0]!.id;
    const right = this.state.right ?? docs.find((d) => d.id !== left)!.id;
    const picker = (value: string, side: "left" | "right") =>
      h(
        "select",
        {
          attrs: { "aria-label": `${side} document` },
          on: {
            change: (e) => {
              this.selected = undefined;
              this.update({ [side]: (e.target as HTMLSelectElement).value, compareFocus: [], compareExpanded: [] });
            },
          },
        },
        ...docs.map((d) => h("option", { value: d.id, selected: d.id === value }, d.name)),
      );

    const a = this.store.get(left)!;
    const b = this.store.get(right)!;
    const index = this.diffIndex(left, right, a, b);
    const { counts } = index;
    const total = counts.added + counts.removed + counts.changed + counts.type;

    this.main.append(
      h(
        "div",
        { class: "toolbar compare-bar" },
        picker(left, "left"),
        h(
          "button",
          {
            class: "icon",
            title: "Swap sides",
            on: { click: () => { this.selected = undefined; this.update({ left: right, right: left }); } },
          },
          "⇄",
        ),
        picker(right, "right"),
        h(
          "label",
          { class: "check" },
          h("input", {
            type: "checkbox",
            checked: this.state.onlyDiffs,
            on: { change: (e) => this.update({ onlyDiffs: (e.target as HTMLInputElement).checked }) },
          }),
          "Only differences",
        ),
      ),
      h(
        "p",
        { class: "chips" },
        total === 0 ? h("span", { class: "chip status-same" }, "Identical") : null,
        chip("added", counts.added, "added"),
        chip("removed", counts.removed, "removed"),
        chip("changed", counts.changed, "changed"),
        chip("type", counts.type, "type changed"),
      ),
      this.breadcrumb(this.state.compareFocus, (p) => this.zoom("compare", p)),
    );

    const body = h("div", { class: "workspace" });
    body.append(
      compareTree(
        a,
        b,
        index,
        this.state.compareFocus,
        {
          expanded: new Set(this.state.compareExpanded),
          limits: this.limits,
          selected: this.selected,
          onlyDiffs: this.state.onlyDiffs,
        },
        this.treeEvents("compare"),
      ),
      this.inspector({ doc: a, label: this.store.meta(left)!.name, other: { doc: b, label: this.store.meta(right)!.name }, status: this.selected && index.status(this.selected) }),
    );
    this.main.append(body);
    if (total > 0) this.main.append(this.changeList(index));
  }

  private diffIndex(left: string, right: string, a: Json, b: Json): DiffIndex {
    const key = `${left}|${right}`;
    let index = this.diffs.get(key);
    if (!index) {
      index = indexDiff(diff(a, b));
      this.diffs.set(key, index);
    }
    return index;
  }

  private changeList(index: DiffIndex): HTMLElement {
    const shown = index.changes.slice(0, CHANGES_SHOWN);
    return h(
      "details",
      { class: "changes", open: index.changes.length <= 50 },
      h(
        "summary",
        null,
        `All changes (${index.changes.length.toLocaleString()}${index.changes.length > CHANGES_SHOWN ? `, first ${CHANGES_SHOWN} shown` : ""})`,
      ),
      h(
        "ol",
        null,
        ...shown.map((c) =>
          h(
            "li",
            null,
            h(
              "button",
              {
                class: `result status-${c.kind}`,
                on: {
                  click: () => {
                    this.zoom("compare", c.path.slice(0, -1), c.path);
                  },
                },
              },
              h("span", { class: "badge" }, c.kind === "type" ? "type" : c.kind),
              h("span", { class: "path" }, display(c.path)),
              h(
                "span",
                { class: "muted" },
                c.kind === "added"
                  ? short(c.right!)
                  : c.kind === "removed"
                    ? short(c.left!)
                    : `${short(c.left!)} → ${short(c.right!)}`,
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ---- shared pieces -------------------------------------------------------------------

  private breadcrumb(focus: Path, go: (path: Path) => void): HTMLElement {
    const nav = h("nav", { class: "crumbs", attrs: { "aria-label": "Zoom path" } });
    if (focus.length) {
      nav.append(h("button", { class: "icon up", title: "Zoom out one level", on: { click: () => go(focus.slice(0, -1)) } }, "↑"));
    }
    const parts: Array<[string, Path]> = [["$", []], ...focus.map((p, i): [string, Path] => [typeof p === "number" ? `[${p}]` : p, focus.slice(0, i + 1)])];
    parts.forEach(([label, path], i) => {
      if (i > 0) nav.append(h("span", { class: "sep" }, "›"));
      nav.append(
        i === parts.length - 1
          ? h("span", { class: "crumb current", attrs: { "aria-current": "location" } }, label)
          : h("button", { class: "crumb", on: { click: () => go(path) } }, label),
      );
    });
    nav.append(h("button", { class: "icon copy", title: "Copy path", on: { click: () => void this.copy(display(focus), "Path copied") } }, "⧉"));
    return nav;
  }

  private inspector(opts: {
    doc: Json;
    label: string;
    other?: { doc: Json; label: string };
    status?: Status;
  }): HTMLElement {
    const panel = h("aside", { class: "inspector", attrs: { "aria-label": "Inspector" } });
    const path = this.selected;
    if (!path) {
      panel.append(h("p", { class: "muted" }, this.state.mode === "explore" && this.state.view === "diagram"
          ? "Click a field to inspect it. Click an object or array to open it as a card; ⤢ on a card makes it the root."
          : "Select a row to inspect it. Double-click (or ⤢) zooms in."));
      return panel;
    }
    const scope = this.state.mode;
    append(panel, [
      h("div", { class: "inspect-path" }, h("code", null, display(path))),
      h(
        "div",
        { class: "actions" },
        h("button", { class: "secondary", on: { click: () => void this.copy(display(path), "Path copied") } }, "Copy path"),
        isContainer(tryResolve(opts.doc, path) ?? null) || (opts.other && isContainer(tryResolve(opts.other.doc, path) ?? null))
          ? h("button", { class: "secondary", on: { click: () => this.zoom(scope, path) } }, "Zoom in")
          : null,
      ),
      opts.status ? h("p", null, h("span", { class: `badge status-${opts.status}` }, statusLabel(opts.status))) : null,
      this.valueBlock(opts.other ? opts.label : null, tryResolve(opts.doc, path)),
      opts.other ? this.valueBlock(opts.other.label, tryResolve(opts.other.doc, path)) : null,
    ]);
    return panel;
  }

  private valueBlock(label: string | null, value: Json | undefined): HTMLElement {
    const block = h("section", { class: "value-block" });
    if (label) block.append(h("h3", { title: label }, label));
    if (value === undefined) {
      block.append(h("p", { class: "muted" }, "Not present."));
      return block;
    }
    const text = JSON.stringify(value, null, 2);
    block.append(
      h(
        "p",
        { class: "muted" },
        `${kindOf(value)}${isContainer(value) ? ` · ${size(value).toLocaleString()} ${Array.isArray(value) ? "items" : "keys"}` : ""} `,
        h("button", { class: "link", on: { click: () => void this.copy(text, "JSON copied") } }, "Copy JSON"),
      ),
      h("pre", null, text.length > INSPECT_MAX ? `${text.slice(0, INSPECT_MAX)}\n… (${(text.length - INSPECT_MAX).toLocaleString()} more characters; use Copy JSON)` : text),
    );
    return block;
  }

  private async copy(text: string, done: string): Promise<void> {
    this.toast((await copyText(text)) ? done : "Couldn't access the clipboard", "info");
  }

  private toast(message: string, tone: "info" | "warn" | "error"): void {
    const el = h("div", { class: `toast ${tone}`, attrs: { role: tone === "error" ? "alert" : "status" } }, message);
    this.toastEl.append(el);
    setTimeout(() => el.remove(), tone === "info" ? 2000 : 6000);
  }
}

function chip(status: Status, count: number, label: string): HTMLElement | null {
  return count ? h("span", { class: `chip status-${status}` }, `${count.toLocaleString()} ${label}`) : null;
}

function statusLabel(status: Status): string {
  return {
    added: "Added on the right",
    removed: "Only on the left",
    changed: "Value changed",
    type: "Type changed",
    contains: "Contains changes",
    same: "Identical",
  }[status];
}

function crumbLabel(part: string | number): string {
  return typeof part === "number" ? `[${part}]` : part;
}

function short(value: Json): string {
  return isContainer(value) ? `${kindOf(value)} (${size(value)})` : truncate(JSON.stringify(value), 40);
}

new App().start();

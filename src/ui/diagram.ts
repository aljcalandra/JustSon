import { isContainer, kindOf, preview, size } from "../core/nodes";
import { display, pathKey } from "../core/paths";
import type { Path } from "../core/types";
import { h } from "./dom";
import { type Card, GAP_X, type Layout, ROW_H, type Row } from "./layout";

export interface DiagramEvents {
  onToggle(path: Path): void;
  onSelect(path: Path): void;
  onFocus(path: Path): void;
  onMore(path: Path): void;
}

interface Viewport {
  x: number;
  y: number;
  scale: number;
}

const SVG = "http://www.w3.org/2000/svg";
const PAD = 24;
const MIN_SCALE = 0.15;
const MAX_SCALE = 2;

/**
 * Pannable, zoomable canvas of cards. One instance lives across renders so the viewport
 * (pan + zoom) is kept while cards open and close.
 */
export class Diagram {
  readonly el: HTMLElement;
  private readonly world: HTMLElement;
  private readonly zoomLabel: HTMLElement;
  private view: Viewport = { x: PAD, y: PAD, scale: 1 };
  private current: Layout = { cards: [], edges: [], width: 0, height: 0 };

  constructor(private readonly events: DiagramEvents) {
    this.world = h("div", { class: "world" });
    this.zoomLabel = h("span", { class: "zoom-level" });
    const control = (label: string, title: string, action: () => void) =>
      h("button", { class: "secondary", title, on: { click: action } }, label);
    this.el = h(
      "div",
      { class: "canvas", attrs: { "aria-label": "Diagram" } },
      this.world,
      h(
        "div",
        { class: "canvas-controls" },
        control("−", "Zoom out", () => this.zoomAround(1 / 1.25)),
        this.zoomLabel,
        control("+", "Zoom in", () => this.zoomAround(1.25)),
        control("Fit", "Fit everything in view", () => this.fit()),
        control("1:1", "Reset zoom", () => this.reset()),
      ),
    );
    this.listen();
    this.apply();
  }

  render(layout: Layout, opts: { rootTitle: string; selected?: Path }): void {
    this.current = layout;
    const selectedKey = opts.selected ? pathKey(opts.selected) : undefined;
    const edges = document.createElementNS(SVG, "svg");
    edges.classList.add("edges");
    edges.setAttribute("width", String(Math.max(layout.width, 1)));
    edges.setAttribute("height", String(Math.max(layout.height, 1)));
    for (const e of layout.edges) {
      const path = document.createElementNS(SVG, "path");
      const bend = GAP_X / 2;
      path.setAttribute("d", `M${e.x1},${e.y1} C${e.x1 + bend},${e.y1} ${e.x2 - bend},${e.y2} ${e.x2},${e.y2}`);
      edges.append(path);
    }
    this.world.replaceChildren(
      edges,
      ...layout.cards.map((card, i) => this.card(card, i === 0 ? opts.rootTitle : undefined, selectedKey)),
    );
  }

  reset(): void {
    this.view = { x: PAD, y: PAD, scale: 1 };
    this.apply();
  }

  fit(): void {
    const { clientWidth: w, clientHeight: hgt } = this.el;
    if (!w || !hgt || !this.current.width) return this.reset();
    const scale = clamp(
      Math.min(1, (w - 2 * PAD) / this.current.width, (hgt - 2 * PAD) / this.current.height),
      MIN_SCALE,
      MAX_SCALE,
    );
    this.view = { x: PAD, y: PAD, scale };
    this.apply();
  }

  /** Pan the least amount needed to bring a card into view (top-left wins if it's too big). */
  reveal(cardKey: string): void {
    const card = this.current.cards.find((c) => c.key === cardKey);
    const { clientWidth: w, clientHeight: hgt } = this.el;
    if (!card || !w || !hgt) return;
    const { x, y, scale } = this.view;
    const left = x + card.x * scale;
    const top = y + card.y * scale;
    const right = left + card.w * scale;
    const bottom = top + card.h * scale;
    let dx = 0;
    let dy = 0;
    if (right > w - PAD) dx = w - PAD - right;
    if (left + dx < PAD) dx = PAD - left;
    if (bottom > hgt - PAD) dy = hgt - PAD - bottom;
    if (top + dy < PAD) dy = PAD - top;
    if (dx || dy) {
      this.view = { ...this.view, x: x + dx, y: y + dy };
      this.apply(true);
    }
  }

  private card(card: Card, rootTitle: string | undefined, selectedKey: string | undefined): HTMLElement {
    const kind = kindOf(card.value);
    const title = rootTitle ?? (typeof card.name === "number" ? `[${card.name}]` : String(card.name));
    const el = h(
      "div",
      {
        class: `card card-${kind}${card.key === selectedKey ? " selected" : ""}`,
        dataset: { key: card.key },
        attrs: { style: `left:${card.x}px;top:${card.y}px;width:${card.w}px;height:${card.h}px` },
      },
      h(
        "div",
        {
          class: "card-head",
          title: display(card.path),
          on: { click: () => this.events.onSelect(card.path) },
        },
        h("span", { class: "card-title" }, title),
        h(
          "span",
          { class: "card-kind" },
          isContainer(card.value) ? `${kind} · ${size(card.value).toLocaleString()}` : kind,
        ),
        card.path.length && rootTitle === undefined
          ? h(
              "button",
              {
                class: "refocus",
                title: `Make ${display(card.path)} the root`,
                on: {
                  click: (e) => {
                    e.stopPropagation();
                    this.events.onFocus(card.path);
                  },
                },
              },
              "⤢",
            )
          : null,
      ),
    );
    if (!isContainer(card.value)) {
      el.append(h("div", { class: "card-row scalar-only" }, h("span", { class: `v kind-${kind}` }, preview(card.value, 200))));
    } else if (card.rows.length === 0) {
      el.append(h("div", { class: "card-row empty-row" }, kind === "array" ? "empty array" : "empty object"));
    }
    for (const row of card.rows) el.append(this.row(row, selectedKey));
    if (card.hiddenRows > 0) {
      el.append(
        h(
          "button",
          { class: "card-more", on: { click: () => this.events.onMore(card.path) } },
          `Show more (${card.hiddenRows.toLocaleString()} hidden)`,
        ),
      );
    }
    return el;
  }

  private row(row: Row, selectedKey: string | undefined): HTMLElement {
    const kind = kindOf(row.value);
    const classes = ["card-row", row.opens && "opens", row.open && "open", pathKey(row.path) === selectedKey && "selected"];
    return h(
      "div",
      {
        class: classes.filter(Boolean).join(" "),
        title: display(row.path),
        attrs: { style: `height:${ROW_H}px` },
        on: {
          // Opening/closing a nested value also selects it.
          click: () => (row.opens ? this.events.onToggle(row.path) : this.events.onSelect(row.path)),
        },
      },
      h("span", { class: typeof row.name === "number" ? "k index" : "k" }, typeof row.name === "number" ? `[${row.name}]` : row.name),
      h(
        "span",
        { class: `v kind-${kind}` },
        isContainer(row.value) ? (Array.isArray(row.value) ? `[ ${size(row.value)} ]` : `{ ${size(row.value)} }`) : preview(row.value, 120),
      ),
      row.opens ? h("span", { class: "port", attrs: { "aria-hidden": "true" } }) : null,
    );
  }

  // ---- pan & zoom ----------------------------------------------------------------------

  private listen(): void {
    let drag: { id: number; x: number; y: number } | null = null;
    this.el.addEventListener("pointerdown", (e) => {
      if ((e.target as Element).closest(".card, .canvas-controls")) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.el.setPointerCapture?.(e.pointerId);
      this.el.classList.add("panning");
    });
    this.el.addEventListener("pointermove", (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      this.view = { ...this.view, x: this.view.x + e.clientX - drag.x, y: this.view.y + e.clientY - drag.y };
      drag = { ...drag, x: e.clientX, y: e.clientY };
      this.apply();
    });
    const end = (e: PointerEvent) => {
      if (drag?.id !== e.pointerId) return;
      drag = null;
      this.el.classList.remove("panning");
    };
    this.el.addEventListener("pointerup", end);
    this.el.addEventListener("pointercancel", end);
    this.el.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        // Pinch on a trackpad arrives as ctrl+wheel; plain wheel/two-finger scroll pans.
        if (e.ctrlKey || e.metaKey) {
          const rect = this.el.getBoundingClientRect();
          this.zoomAround(Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top);
        } else {
          this.view = { ...this.view, x: this.view.x - e.deltaX, y: this.view.y - e.deltaY };
          this.apply();
        }
      },
      { passive: false },
    );
  }

  private zoomAround(factor: number, cx = this.el.clientWidth / 2, cy = this.el.clientHeight / 2): void {
    const scale = clamp(this.view.scale * factor, MIN_SCALE, MAX_SCALE);
    const ratio = scale / this.view.scale;
    this.view = { scale, x: cx - (cx - this.view.x) * ratio, y: cy - (cy - this.view.y) * ratio };
    this.apply();
  }

  private apply(animate = false): void {
    this.world.classList.toggle("animate", animate);
    this.world.style.transform = `translate(${this.view.x}px, ${this.view.y}px) scale(${this.view.scale})`;
    // The dot grid moves and scales with the content so panning feels physical.
    this.el.style.backgroundPosition = `${this.view.x}px ${this.view.y}px`;
    this.el.style.backgroundSize = `${20 * this.view.scale}px ${20 * this.view.scale}px`;
    this.zoomLabel.textContent = `${Math.round(this.view.scale * 100)}%`;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

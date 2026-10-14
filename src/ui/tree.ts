import type { DiffIndex, Status } from "../core/diff";
import { isContainer, keys, kindOf, preview, size } from "../core/nodes";
import { child, display, pathKey, tryResolve } from "../core/paths";
import type { Json, Path, Segment } from "../core/types";
import { h } from "./dom";

export const PAGE = 200;

export interface TreeEvents {
  onToggle(path: Path): void;
  onZoom(path: Path): void;
  onSelect(path: Path): void;
  onMore(path: Path): void;
}

interface TreeView {
  expanded: Set<string>;
  limits: Map<string, number>;
  selected?: Path;
}

export function exploreTree(
  doc: Json,
  focus: Path,
  view: TreeView,
  events: TreeEvents,
): HTMLElement {
  const list = h("div", { class: "tree", attrs: { role: "tree" } });
  const selectedKey = view.selected ? pathKey(view.selected) : undefined;

  const addRows = (value: Json, path: Path, depth: number) => {
    const names = keys(value);
    const limit = view.limits.get(pathKey(path)) ?? PAGE;
    for (const name of names.slice(0, limit)) {
      const childPath = [...path, name];
      const childValue = child(value, name)!;
      const key = pathKey(childPath);
      const open = isContainer(childValue) && view.expanded.has(key);
      list.append(
        row({
          path: childPath,
          name,
          depth,
          open,
          expandable: isContainer(childValue) && size(childValue) > 0,
          selected: key === selectedKey,
          cells: [valueCell(childValue)],
          events,
        }),
      );
      if (open) addRows(childValue, childPath, depth + 1);
    }
    if (names.length > limit) list.append(moreRow(path, depth, names.length - limit, events));
  };

  const root = tryResolve(doc, focus);
  if (root === undefined) {
    list.append(h("p", { class: "empty" }, `${display(focus)} no longer exists in this document.`));
  } else if (!isContainer(root)) {
    list.append(h("div", { class: "row scalar-root" }, valueCell(root)));
  } else if (size(root) === 0) {
    list.append(h("p", { class: "empty" }, `Empty ${kindOf(root)}`));
  } else {
    addRows(root, focus, 0);
  }
  return list;
}

const MISSING = Symbol("missing");
type Side = Json | typeof MISSING;

export function compareTree(
  left: Json,
  right: Json,
  index: DiffIndex,
  focus: Path,
  view: TreeView & { onlyDiffs: boolean },
  events: TreeEvents,
): HTMLElement {
  const list = h("div", { class: "tree compare", attrs: { role: "tree" } });
  const selectedKey = view.selected ? pathKey(view.selected) : undefined;
  list.append(
    h(
      "div",
      { class: "row header" },
      h("span", { class: "key-col" }, "Key"),
      h("span", { class: "side" }, "Left"),
      h("span", { class: "side" }, "Right"),
    ),
  );

  const addRows = (a: Side, b: Side, path: Path, depth: number) => {
    let names = unionKeys(a, b);
    if (view.onlyDiffs) names = names.filter((n) => index.status([...path, n]) !== "same");
    const limit = view.limits.get(pathKey(path)) ?? PAGE;
    for (const name of names.slice(0, limit)) {
      const childPath = [...path, name];
      const ca = childOf(a, name);
      const cb = childOf(b, name);
      const key = pathKey(childPath);
      const expandable = hasChildren(ca) || hasChildren(cb);
      const open = expandable && view.expanded.has(key);
      const status = index.status(childPath);
      list.append(
        row({
          path: childPath,
          name,
          depth,
          open,
          expandable,
          selected: key === selectedKey,
          status,
          cells: [sideCell(ca), sideCell(cb)],
          events,
        }),
      );
      if (open) addRows(ca, cb, childPath, depth + 1);
    }
    if (names.length > limit) list.append(moreRow(path, depth, names.length - limit, events));
    if (names.length === 0 && depth === 0) {
      list.append(h("p", { class: "empty" }, view.onlyDiffs ? "No differences here." : "Empty."));
    }
  };

  const a = tryResolve(left, focus) ?? MISSING;
  const b = tryResolve(right, focus) ?? MISSING;
  if (!hasChildren(a) && !hasChildren(b)) {
    list.append(
      row({
        path: focus,
        name: focus[focus.length - 1] ?? "$",
        depth: 0,
        open: false,
        expandable: false,
        selected: false,
        status: index.status(focus),
        cells: [sideCell(a), sideCell(b)],
        events,
      }),
    );
  } else {
    addRows(a, b, focus, 0);
  }
  return list;
}

interface RowSpec {
  path: Path;
  name: Segment;
  depth: number;
  open: boolean;
  expandable: boolean;
  selected: boolean;
  status?: Status;
  cells: HTMLElement[];
  events: TreeEvents;
}

function row(spec: RowSpec): HTMLElement {
  const { path, events } = spec;
  const el = h(
    "div",
    {
      class: ["row", spec.selected && "selected", spec.status && `status-${spec.status}`]
        .filter(Boolean)
        .join(" "),
      title: display(path),
      attrs: {
        role: "treeitem",
        style: `--depth:${spec.depth}`,
        ...(spec.expandable ? { "aria-expanded": String(spec.open) } : {}),
      },
      on: { click: () => events.onSelect(path) },
    },
    spec.expandable
      ? h(
          "button",
          {
            class: "toggle",
            title: spec.open ? "Collapse" : "Expand",
            on: {
              click: (e) => {
                e.stopPropagation();
                events.onToggle(path);
              },
            },
          },
          spec.open ? "▾" : "▸",
        )
      : h("span", { class: "toggle spacer" }),
    h("span", { class: typeof spec.name === "number" ? "key index" : "key" }, String(spec.name)),
    ...spec.cells,
    spec.expandable
      ? h(
          "button",
          {
            class: "zoom",
            title: `Zoom into ${display(path)}`,
            on: {
              click: (e) => {
                e.stopPropagation();
                events.onZoom(path);
              },
            },
          },
          "⤢",
        )
      : h("span", { class: "zoom spacer" }),
  );
  if (spec.expandable) {
    el.addEventListener("dblclick", (e) => {
      e.preventDefault();
      events.onZoom(path);
    });
  }
  return el;
}

function moreRow(path: Path, depth: number, remaining: number, events: TreeEvents): HTMLElement {
  return h(
    "div",
    { class: "row more", attrs: { style: `--depth:${depth}` } },
    h(
      "button",
      { on: { click: () => events.onMore(path) } },
      `Show ${Math.min(PAGE, remaining)} more (${remaining.toLocaleString()} hidden)`,
    ),
  );
}

function valueCell(value: Json): HTMLElement {
  const kind = kindOf(value);
  return h(
    "span",
    { class: `value kind-${kind}` },
    preview(value),
    isContainer(value) && size(value) > 0
      ? h("span", { class: "count" }, size(value).toLocaleString())
      : null,
  );
}

function sideCell(value: Side): HTMLElement {
  if (value === MISSING) return h("span", { class: "side missing" }, "—");
  const cell = valueCell(value);
  cell.classList.add("side");
  return cell;
}

// Ordered union: left's keys first, then right-only keys. Indexes and names never collide.
function unionKeys(a: Side, b: Side): Segment[] {
  return [...new Set([...(a === MISSING ? [] : keys(a)), ...(b === MISSING ? [] : keys(b))])];
}

function childOf(value: Side, name: Segment): Side {
  if (value === MISSING) return MISSING;
  return child(value, name) ?? MISSING;
}

function hasChildren(value: Side): boolean {
  return value !== MISSING && isContainer(value) && size(value) > 0;
}


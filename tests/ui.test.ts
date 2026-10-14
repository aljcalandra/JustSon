// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import html from "../index.html?raw";
import { DocStore } from "../src/storage";

const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>")).replace(/<script[\s\S]*?<\/script>/, "");

const LEFT = {
  users: [
    { id: 1, name: "Ada", roles: ["admin"] },
    { id: 2, name: "Alan", roles: [] },
  ],
  "<img src=x onerror=alert(1)>": "<b>not bold</b>",
  big: Array.from({ length: 450 }, (_, i) => i),
};
const RIGHT = {
  users: [
    { id: 1, name: "Ada L.", roles: ["admin"] },
    { id: 2, name: "Alan", roles: [], team: "x" },
  ],
  big: [],
};

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const rowFor = (title: string) => $$(".row").find((r) => r.title === title)!;

async function boot(docs: Array<[string, unknown]>) {
  localStorage.clear();
  document.body.innerHTML = body;
  const store = new DocStore(localStorage);
  const ids = docs.map(([name, doc]) => store.add(name, JSON.stringify(doc)).id);
  vi.resetModules();
  await import("../src/main");
  return ids;
}

const cardTitles = () => $$(".card .card-title").map((t) => t.textContent);
const card = (title: string) => $$(".card").find((c) => c.querySelector<HTMLElement>(".card-head")!.title === title)!;
const cardRow = (title: string) => $$(".card-row").find((r) => r.title === title)!;

describe("explore diagram", () => {
  beforeEach(async () => {
    await boot([["left.json", LEFT]]);
  });

  it("lists the document and shows its top level as one card", () => {
    expect($$(".docs .name").map((n) => n.textContent)).toEqual(["left.json"]);
    expect(cardTitles()).toEqual(["left.json"]);
    expect($$(".card-row .k").map((k) => k.textContent)).toEqual(["users", "<img src=x onerror=alert(1)>", "big"]);
    expect(cardRow("$.users").querySelector(".v")!.textContent).toBe("[ 2 ]");
    expect($(".stats").textContent).toContain("depth 4");
  });

  it("renders document text as text, never markup", () => {
    expect(document.querySelector(".card img, .card b")).toBeNull();
    expect(cardRow('$["<img src=x onerror=alert(1)>"]').textContent).toContain('"<b>not bold</b>"');
  });

  it("opens nested values as linked cards and closes them again", () => {
    cardRow("$.users").click();
    cardRow("$.users[0]").click();
    expect(cardTitles()).toEqual(["left.json", "users", "[0]"]);
    expect($$(".edges path")).toHaveLength(2);
    expect(cardRow("$.users").className).toContain("open");
    expect($(".inspect-path").textContent).toBe("$.users[0]");
    expect(JSON.parse(localStorage.getItem("justson:state")!).expanded).toHaveLength(2);

    cardRow("$.users").click();
    expect(cardTitles()).toEqual(["left.json"]);
  });

  it("selects scalar fields into the inspector", () => {
    cardRow("$.users").click();
    cardRow("$.users[1]").click();
    cardRow("$.users[1].name").click();
    expect($(".card-row.selected").title).toBe("$.users[1].name");
    expect($(".value-block pre").textContent).toBe('"Alan"');
  });

  it("re-roots the diagram on a card and zooms back out with the breadcrumb", () => {
    cardRow("$.users").click();
    cardRow("$.users[0]").click();
    card("$.users[0]").querySelector<HTMLButtonElement>(".refocus")!.click();
    expect(cardTitles()).toEqual(["[0]"]);
    expect($$(".crumbs .crumb").map((c) => c.textContent)).toEqual(["$", "users", "[0]"]);
    expect(JSON.parse(localStorage.getItem("justson:state")!).focus).toEqual(["users", 0]);

    $$(".crumbs .crumb")[0]!.click();
    expect(cardTitles()).toEqual(["left.json"]);
  });

  it("pages long cards", () => {
    cardRow("$.big").click();
    const big = () => card("$.big");
    expect(big().querySelectorAll(".card-row")).toHaveLength(50);
    big().querySelector<HTMLButtonElement>(".card-more")!.click();
    expect(big().querySelectorAll(".card-row")).toHaveLength(100);
  });

  it("searches and reveals a match deep in the diagram", () => {
    const box = $<HTMLInputElement>("input[type=search]");
    box.value = "alan";
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    const results = $$(".results .result");
    expect(results.map((r) => r.querySelector(".path")!.textContent)).toEqual(["$.users[1].name"]);

    results[0]!.click();
    expect(cardTitles()).toEqual(["left.json", "users", "[1]"]);
    expect($(".card-row.selected").title).toBe("$.users[1].name");
    expect($(".value-block pre").textContent).toBe('"Alan"');
  });

  it("reveals matches past a card's first page", () => {
    const box = $<HTMLInputElement>("input[type=search]");
    box.value = "449";
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    $$(".results .result")[0]!.click();
    expect($(".card-row.selected").title).toBe("$.big[449]");
  });
});

describe("view switch", () => {
  beforeEach(async () => {
    await boot([["left.json", LEFT]]);
  });

  const option = (view: string) => $<HTMLButtonElement>(`[data-view="${view}"]`);
  const listKeys = () => $$(".tree .row > .key").map((k) => k.textContent);

  it("defaults to the diagram and switches to the list", () => {
    expect(option("diagram").getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector(".canvas")).not.toBeNull();

    option("list").click();
    expect(option("list").getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector(".canvas")).toBeNull();
    expect(listKeys()).toEqual(["users", "<img src=x onerror=alert(1)>", "big"]);
    expect(JSON.parse(localStorage.getItem("justson:state")!).view).toBe("list");
  });

  it("keeps open paths and the selection across views", () => {
    cardRow("$.users").click();
    cardRow("$.users[0]").click();
    option("list").click();
    expect(listKeys()).toEqual(["users", "0", "id", "name", "roles", "1", "<img src=x onerror=alert(1)>", "big"]);
    expect($(".row.selected").title).toBe("$.users[0]");

    option("diagram").click();
    expect(cardTitles()).toEqual(["left.json", "users", "[0]"]);
  });

  it("reveals search matches in the list, past its first page", () => {
    option("list").click();
    const box = $<HTMLInputElement>("input[type=search]");
    box.value = "449";
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    $$(".results .result")[0]!.click();
    expect($(".row.selected").title).toBe("$.big[449]");
  });

  it("is hidden in compare mode", () => {
    $<HTMLButtonElement>('[data-mode="compare"]').click();
    expect(document.body.dataset.mode).toBe("compare");
  });
});

describe("formats", () => {
  it("opens YAML and XML documents alongside JSON", async () => {
    localStorage.clear();
    document.body.innerHTML = body;
    const store = new DocStore(localStorage);
    store.add("config.yaml", "server:\n  port: 8080\n");
    store.add("feed.xml", '<feed><entry id="1">Hi</entry></feed>');
    vi.resetModules();
    await import("../src/main");
    expect($$(".docs .fmt").map((b) => b.textContent)).toEqual(["YAML", "XML"]);
    expect(cardRow("$.server").querySelector(".v")!.textContent).toBe("{ 1 }");

    expect(document.querySelector(".docs .badge.warn")).toBeNull();
    $$(".docs .doc")[1]!.click();
    cardRow("$.feed").click();
    expect(cardRow("$.feed.entry").querySelector(".v")!.textContent).toBe("{ 2 }");
  });
});

describe("lenient XML in the UI", () => {
  it("marks documents that needed lenient parsing", async () => {
    localStorage.clear();
    document.body.innerHTML = body;
    new DocStore(localStorage).add("sgml.xml", "<r><a x='1'><b>t</b></r>");
    vi.resetModules();
    await import("../src/main");
    const badge = $(".docs .badge.warn");
    expect(badge.textContent).toBe("lenient");
    expect(badge.title).toMatch(/^Not well-formed XML/);
    cardRow("$.r").click();
    // <a> is never closed, so it's read as empty and <b> becomes its sibling.
    expect(cardRow("$.r.a").querySelector(".v")!.textContent).toBe("{ 1 }");
    expect(cardRow("$.r.b").querySelector(".v")!.textContent).toBe('"t"');
  });
});

describe("document dialogs", () => {
  beforeEach(async () => {
    await boot([
      ["a.json", { x: 1 }],
      ["b.json", { y: 2 }],
    ]);
  });

  const dialog = () => $<HTMLDialogElement>("dialog.modal");
  const press = (value: string) =>
    dialog().querySelector<HTMLButtonElement>(`button[value="${value}"]`)!.click();

  it("renames in an in-page dialog", async () => {
    $<HTMLButtonElement>('button[title="Rename a.json"]').click();
    expect(dialog().open).toBe(true);
    dialog().querySelector("input")!.value = "renamed.json";
    press("ok");
    await vi.waitFor(() => expect($$(".docs .name").map((n) => n.textContent)).toEqual(["renamed.json", "b.json"]));
    expect(document.querySelector("dialog.modal")).toBeNull();
  });

  it("cancelling a delete keeps the document", async () => {
    $<HTMLButtonElement>('button[title="Delete a.json"]').click();
    press("cancel");
    await vi.waitFor(() => expect(document.querySelector("dialog.modal")).toBeNull());
    expect($$(".docs .name")).toHaveLength(2);
  });

  it("confirming a delete removes it", async () => {
    $<HTMLButtonElement>('button[title="Delete a.json"]').click();
    expect(dialog().textContent).toContain('"a.json" will be removed');
    press("ok");
    await vi.waitFor(() => expect($$(".docs .name").map((n) => n.textContent)).toEqual(["b.json"]));
  });
});

describe("compare", () => {
  beforeEach(async () => {
    await boot([
      ["left.json", LEFT],
      ["right.json", RIGHT],
    ]);
    $<HTMLButtonElement>('[data-mode="compare"]').click();
  });

  it("summarizes differences", () => {
    expect($$(".chips .chip").map((c) => c.textContent)).toEqual(["1 added", "451 removed", "1 changed"]);
  });

  it("marks rows by status and filters to differences", () => {
    expect(rowFor("$.users").className).toContain("status-contains");
    expect(rowFor("$.big").className).toContain("status-contains");
    expect(rowFor('$["<img src=x onerror=alert(1)>"]').className).toContain("status-removed");

    rowFor("$.users").querySelector<HTMLButtonElement>(".toggle")!.click();
    rowFor("$.users[0]").querySelector<HTMLButtonElement>(".toggle")!.click();
    expect(rowFor("$.users[0].name").className).toContain("status-changed");
    expect(rowFor("$.users[0].id").className).toContain("status-same");

    $<HTMLInputElement>(".check input").click();
    expect(document.querySelector('[title="$.users[0].id"]')).toBeNull();
    expect(rowFor("$.users[0].name")).toBeTruthy();
  });

  it("jumps from the change list to a change", () => {
    const item = $$(".changes .result").find((r) => r.textContent?.includes("$.users[1].team"))!;
    item.click();
    expect($$(".crumbs .crumb").map((c) => c.textContent)).toEqual(["$", "users", "[1]"]);
    expect($(".row.selected").title).toBe("$.users[1].team");
    const blocks = $$(".value-block");
    expect(blocks[0]!.textContent).toContain("Not present.");
    expect(blocks[1]!.querySelector("pre")!.textContent).toBe('"x"');
  });

  it("swaps sides", () => {
    $<HTMLButtonElement>('.compare-bar button[title="Swap sides"]').click();
    expect($$(".chips .chip").map((c) => c.textContent)).toEqual(["451 added", "1 removed", "1 changed"]);
  });
});

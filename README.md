# JustSon

Explore deeply nested JSON, YAML and XML and compare documents, entirely in the browser. Nothing is
uploaded: documents and UI state live in `localStorage`.

- **Explore:** a diagram of linked cards (each object lists its fields; click a nested value to open
  it as a new card) or an indented list, switchable at the top right. Re-root on any subtree
  (breadcrumb to zoom back out), search keys and values, inspect and copy any value or its path
  (`$.users[0]["first name"]`).
- **Compare:** one merged tree with left/right columns and per-row status (added, removed,
  changed, type changed, contains changes), an "only differences" filter, and a change list.

## Formats

Format comes from the file extension (`.json`, `.yaml`/`.yml`, `.xml`); pasted text is sniffed.
Everything is converted to the JSON data model, so any two documents can be compared.

- **YAML** ([`yaml`](https://eemeli.org/yaml/), YAML 1.2 plus `<<` merge keys): anchors and aliases are
  resolved; several `---` documents become an array; `.inf`/`.nan` become strings.
- **XML** (the browser's `DOMParser`): `<root>` becomes `{"root": …}`, attributes become `"@name"`
  keys, repeated child elements become arrays, text-only elements become strings, and text next to
  attributes or children goes under `"#text"`. All values stay strings; comments are dropped.
  Text that isn't well-formed XML (e.g. SGML-style unclosed empty tags, or a DOCTYPE with no system ID)
  is re-read leniently: unclosed tags count as empty, stray end tags are ignored. The document is then
  marked "lenient" in the sidebar, and the strict parser's reason shows on hover.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # vitest: core logic, storage, and UI smoke tests (happy-dom)
npm run build      # typecheck + static build in dist/ (relative paths: host it anywhere)
```

## Layout

```
src/core/      pure logic, no DOM: paths, node summaries, diff, search
src/formats.ts format detection; JSON/YAML/XML -> JSON data model
src/storage.ts localStorage document store (original text + format) + UI state
src/ui/        DOM helper (text-only, never innerHTML), card layout + diagram, list/compare trees, modals
src/main.ts    app shell: sidebar, explore, compare, inspector
tests/
```

## Limits

- `localStorage` holds roughly 5 MB per site (about 2.5M characters). A larger document still opens,
  but only for the current session; it's marked "not saved".
- Numbers go through `JSON.parse`, so integers beyond 2^53 lose precision.
- XML: sibling elements with different names lose their relative order when one name repeats (they
  are grouped into arrays by name).
- Arrays are compared by index. Inserting an item near the start shows every later item as changed.

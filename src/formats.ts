import { parseAllDocuments } from "yaml";
import type { Json, JsonObject } from "./core/types";

export type Format = "json" | "yaml" | "xml";

export const FORMATS: Record<Format, string> = { json: "JSON", yaml: "YAML", xml: "XML" };

export class ParseError extends Error {}

/** Format from the file extension; without one, sniff the text (YAML is the fallback, being a JSON superset). */
export function detectFormat(name: string, text: string): Format {
  const ext = name.toLowerCase().match(/\.([a-z]+)$/)?.[1];
  if (ext === "json") return "json";
  if (ext === "yaml" || ext === "yml") return "yaml";
  if (ext === "xml") return "xml";
  const start = text.trimStart();
  if (start.startsWith("<")) return "xml";
  try {
    JSON.parse(text);
    return "json";
  } catch {
    return "yaml";
  }
}

export interface Parsed {
  value: Json;
  /** Set when the text was only readable by bending the rules (e.g. XML that isn't well-formed). */
  note?: string;
}

export function parseDocument(format: Format, text: string): Parsed {
  if (format === "yaml") return { value: parseYaml(text) };
  if (format === "xml") return parseXml(text);
  try {
    return { value: JSON.parse(text) as Json };
  } catch (e) {
    throw new ParseError(e instanceof Error ? e.message : String(e));
  }
}

export function parseAs(format: Format, text: string): Json {
  return parseDocument(format, text).value;
}

function parseYaml(text: string): Json {
  // Merge keys (<<: *base) are YAML 1.1 but common in real configs (compose files, CI).
  const docs = parseAllDocuments(text, { merge: true });
  const values = docs.map((doc) => {
    const error = doc.errors[0];
    if (error) throw new ParseError(error.message);
    // toJS resolves anchors/aliases; maxAliasCount guards against alias-expansion bombs.
    return toJson(doc.toJS({ maxAliasCount: 1000 }));
  });
  if (values.length === 0) return null;
  return values.length === 1 ? values[0]! : values;
}

/** Coerce a YAML value into the JSON model: non-finite numbers, dates, bigints and Maps have no JSON form. */
function toJson(value: unknown): Json {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJson);
  if (value instanceof Map) {
    const out: JsonObject = {};
    for (const [k, v] of value) set(out, String(k), toJson(v));
    return out;
  }
  if (value instanceof Set) return [...value].map(toJson);
  if (typeof value === "object") {
    const out: JsonObject = {};
    for (const [k, v] of Object.entries(value)) set(out, k, toJson(v));
    return out;
  }
  return String(value);
}

const ELEMENT = 1;
const TEXT = 3;
const CDATA = 4;

/** Parser-neutral element tree, so the strict and lenient parsers share one JSON mapping. */
interface XNode {
  name: string;
  attrs: Array<[string, string]>;
  children: Array<XNode | string>;
}

/**
 * XML -> JSON: `{root: …}`; attributes as "@name"; repeated child tags become arrays; an element with
 * only text becomes that string; text alongside attributes/children goes under "#text". Values stay
 * strings (XML has no types). Comments, DOCTYPEs and processing instructions are dropped.
 *
 * Strict (DOMParser) first; if the text isn't well-formed, fall back to `parseXmlLenient`.
 */
function parseXml(text: string): Parsed {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const error = doc.getElementsByTagName("parsererror")[0];
  if (!error) return { value: xmlToJson(document_([fromDom(doc.documentElement)])) };
  const reason = parserMessage(error.textContent ?? "") || "Invalid XML";
  try {
    return {
      value: parseXmlLenient(text),
      note: `Not well-formed XML (${reason}). Read leniently: unclosed tags were treated as empty.`,
    };
  } catch {
    throw new ParseError(reason);
  }
}

// Browsers wrap the parser's message in page-rendering boilerplate.
function parserMessage(raw: string): string {
  return raw
    .replace(/This page contains the following errors:/i, "")
    .replace(/Below is a rendering of the page up to the first error\.?/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fromDom(el: Element): XNode {
  const children: Array<XNode | string> = [];
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === ELEMENT) children.push(fromDom(node as Element));
    else if (node.nodeType === TEXT || node.nodeType === CDATA) children.push(node.nodeValue ?? "");
  }
  return { name: el.nodeName, attrs: Array.from(el.attributes, (a) => [a.name, a.value]), children };
}

const TOKEN = new RegExp(
  [
    /<!--[\s\S]*?(?:-->|$)/.source, // comment
    /<!\[CDATA\[([\s\S]*?)(?:\]\]>|$)/.source, // 1: CDATA text
    /<!DOCTYPE[^[>]*(?:\[[\s\S]*?\][^>]*)?>/.source, // DOCTYPE, with optional internal subset
    /<![^>]*>/.source, // other declarations
    /<\?[\s\S]*?(?:\?>|$)/.source, // processing instruction
    /<\/\s*([^\s>]+)\s*>/.source, // 2: end tag
    /<([^\s/>!?][^\s/>]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/.source, // 3-5: start tag
    /[^<]+/.source, // text
    /</.source, // stray "<"
  ].join("|"),
  "giy",
);
const ATTR = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

/**
 * Forgiving XML/SGML-style reader for text DOMParser rejects. A start tag that is never closed is
 * treated as empty (SGML-style): when an outer end tag closes it implicitly, whatever followed it moves
 * up to be its siblings. Unmatched end tags are ignored; elements still open at the end are closed there.
 */
export function parseXmlLenient(text: string): Json {
  const doc: XNode = { name: "#document", attrs: [], children: [] };
  const stack: XNode[] = [doc];
  const top = () => stack[stack.length - 1]!;
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(text); m; m = TOKEN.exec(text)) {
    const [token, cdata, endName, startName, rawAttrs, selfClose] = m;
    if (cdata !== undefined) {
      top().children.push(cdata);
    } else if (endName !== undefined) {
      const at = stack.findLastIndex((n, i) => i > 0 && n.name === endName);
      if (at < 0) continue;
      while (stack.length - 1 > at) {
        const unclosed = stack.pop()!;
        const siblings = top().children;
        siblings.push(...unclosed.children);
        unclosed.children = [];
      }
      stack.pop();
    } else if (startName !== undefined) {
      const node: XNode = { name: startName, attrs: attributes(rawAttrs ?? ""), children: [] };
      top().children.push(node);
      if (!selfClose) stack.push(node);
    } else if (!token.startsWith("<") || token === "<") {
      top().children.push(decodeEntities(token));
    }
  }
  if (!doc.children.some((c) => typeof c !== "string")) throw new ParseError("No XML elements found");
  return xmlToJson(doc);
}

function attributes(raw: string): Array<[string, string]> {
  return Array.from(raw.matchAll(ATTR), (a) => [a[1]!, decodeEntities(a[2] ?? a[3] ?? a[4] ?? "")]);
}

const NAMED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** The five XML entities and numeric references; unknown (DTD-defined) entities are left as written. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (whole, ref: string) => {
    if (ref[0] !== "#") return NAMED[ref] ?? whole;
    const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

function document_(children: XNode[]): XNode {
  return { name: "#document", attrs: [], children };
}

function xmlToJson(node: XNode): Json {
  const out: JsonObject = {};
  const repeated = new Set<string>();
  let text = "";
  let hasChildren = false;
  for (const [name, value] of node.attrs) set(out, `@${name}`, value);
  for (const c of node.children) {
    if (typeof c === "string") {
      text += c;
      continue;
    }
    hasChildren = true;
    const value = xmlToJson(c);
    if (!Object.hasOwn(out, c.name)) set(out, c.name, value);
    else if (repeated.has(c.name)) (out[c.name] as Json[]).push(value);
    else {
      set(out, c.name, [out[c.name]!, value]);
      repeated.add(c.name);
    }
  }
  const trimmed = text.trim();
  if (!hasChildren && node.attrs.length === 0) return trimmed;
  // Whitespace and stray text around the root element isn't part of the document's data.
  if (trimmed && node.name !== "#document") set(out, "#text", trimmed);
  return out;
}

// Plain assignment of "__proto__" would set the prototype instead of creating a key.
function set(obj: JsonObject, key: string, value: Json): void {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

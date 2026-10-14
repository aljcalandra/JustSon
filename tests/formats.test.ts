// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { detectFormat, ParseError, parseAs, parseDocument, parseXmlLenient } from "../src/formats";

describe("detectFormat", () => {
  it("trusts the file extension", () => {
    expect(detectFormat("a.JSON", "x: 1")).toBe("json");
    expect(detectFormat("a.yml", "{}")).toBe("yaml");
    expect(detectFormat("config.yaml", "")).toBe("yaml");
    expect(detectFormat("feed.xml", "{}")).toBe("xml");
  });

  it("sniffs text without a known extension", () => {
    expect(detectFormat("", '  {"a": 1}')).toBe("json");
    expect(detectFormat("", "[1, 2]")).toBe("json");
    expect(detectFormat("notes.txt", "\n  <?xml version='1.0'?><a/>")).toBe("xml");
    expect(detectFormat("", "a: 1\nb: [2, 3]")).toBe("yaml");
  });
});

describe("YAML", () => {
  it("parses mappings, sequences and scalars with YAML 1.2 types", () => {
    const doc = parseAs(
      "yaml",
      "name: app\nport: 8080\nratio: 0.5\non: true\nnothing: ~\nversion: '1.0'\ntags:\n  - a\n  - b\n",
    );
    expect(doc).toEqual({
      name: "app",
      port: 8080,
      ratio: 0.5,
      on: true,
      nothing: null,
      version: "1.0",
      tags: ["a", "b"],
    });
  });

  it("resolves anchors and merges", () => {
    const doc = parseAs("yaml", "base: &b {x: 1, y: 2}\nchild:\n  <<: *b\n  y: 3\n");
    expect(doc).toEqual({ base: { x: 1, y: 2 }, child: { x: 1, y: 3 } });
  });

  it("turns multiple documents into an array, and an empty file into null", () => {
    expect(parseAs("yaml", "a: 1\n---\nb: 2\n")).toEqual([{ a: 1 }, { b: 2 }]);
    expect(parseAs("yaml", "")).toBeNull();
  });

  it("maps values JSON can't hold onto strings", () => {
    expect(parseAs("yaml", "a: .inf\nb: -.inf\nc: .nan\n")).toEqual({
      a: "Infinity",
      b: "-Infinity",
      c: "NaN",
    });
  });

  it("stringifies non-string keys", () => {
    expect(parseAs("yaml", "1: one\ntrue: yes\n")).toEqual({ "1": "one", true: "yes" });
  });

  it("keeps a __proto__ key as data", () => {
    const doc = parseAs("yaml", "__proto__:\n  polluted: 1\n") as Record<string, unknown>;
    expect(Object.keys(doc)).toEqual(["__proto__"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("reports syntax errors with a position", () => {
    expect(() => parseAs("yaml", "a: [1, 2\nb: 3")).toThrow(ParseError);
    expect(() => parseAs("yaml", "a: 1\n a: 2")).toThrow(/line/);
  });

  it("refuses alias-expansion bombs", () => {
    const bomb = [
      "a: &a [x, x, x, x, x, x, x, x, x, x]",
      ..."bcdefghi".split("").map((n, i) => `${n}: &${n} [${Array(10).fill(`*${"abcdefghi"[i]}`).join(", ")}]`),
    ].join("\n");
    expect(() => parseAs("yaml", bomb)).toThrow();
  });
});

describe("XML", () => {
  it("maps elements, attributes, repeats and text", () => {
    const doc = parseAs(
      "xml",
      `<?xml version="1.0"?>
      <order id="7" status="open">
        <customer>Ada</customer>
        <item sku="A1" qty="2">Widget</item>
        <item sku="B2" qty="1">Gadget</item>
        <note/>
        <!-- dropped -->
        trailing text
      </order>`,
    );
    expect(doc).toEqual({
      order: {
        "@id": "7",
        "@status": "open",
        customer: "Ada",
        item: [
          { "@sku": "A1", "@qty": "2", "#text": "Widget" },
          { "@sku": "B2", "@qty": "1", "#text": "Gadget" },
        ],
        note: "",
        "#text": "trailing text",
      },
    });
  });

  it("keeps namespace prefixes in names", () => {
    expect(parseAs("xml", '<a:root xmlns:a="urn:x"><a:v>1</a:v></a:root>')).toEqual({
      "a:root": { "@xmlns:a": "urn:x", "a:v": "1" },
    });
  });

  it("keeps a __proto__ element as data", () => {
    const doc = parseAs("xml", "<r><__proto__>x</__proto__></r>") as { r: Record<string, unknown> };
    expect(Object.keys(doc.r)).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(doc.r)).toBe(Object.prototype);
  });

  it("keeps the strict parser's reason, without browser boilerplate, when falling back", () => {
    const { value, note } = parseDocument("xml", "<a><b></a>");
    expect(value).toEqual({ a: { b: "" } });
    expect(note).toMatch(/^Not well-formed XML \(.+\)/);
    expect(note).not.toMatch(/rendering of the page/);
  });
});

// The json.org glossary sample: an SGML-style DOCTYPE and empty elements that are never closed.
const GLOSSARY = `<!DOCTYPE glossary PUBLIC "-//OASIS//DTD DocBook V3.1//EN">
 <glossary><title>example glossary</title>
  <GlossDiv><title>S</title>
   <GlossList>
    <GlossEntry ID="SGML" SortAs="SGML">
     <GlossTerm>Standard Generalized Markup Language</GlossTerm>
     <Acronym>SGML</Acronym>
     <Abbrev>ISO 8879:1986</Abbrev>
     <GlossDef>
      <para>A meta-markup language, used to create markup
languages such as DocBook.</para>
      <GlossSeeAlso OtherTerm="GML">
      <GlossSeeAlso OtherTerm="XML">
     </GlossDef>
     <GlossSee OtherTerm="markup">
    </GlossEntry>
   </GlossList>
  </GlossDiv>
 </glossary>`;

describe("lenient XML", () => {
  it("reads the json.org glossary sample, treating unclosed tags as empty", () => {
    const { value, note } = parseDocument("xml", GLOSSARY);
    expect(note).toMatch(/^Not well-formed XML \(.+\)\. Read leniently/);
    expect(value).toEqual({
      glossary: {
        title: "example glossary",
        GlossDiv: {
          title: "S",
          GlossList: {
            GlossEntry: {
              "@ID": "SGML",
              "@SortAs": "SGML",
              GlossTerm: "Standard Generalized Markup Language",
              Acronym: "SGML",
              Abbrev: "ISO 8879:1986",
              GlossDef: {
                para: "A meta-markup language, used to create markup\nlanguages such as DocBook.",
                GlossSeeAlso: [{ "@OtherTerm": "GML" }, { "@OtherTerm": "XML" }],
              },
              GlossSee: { "@OtherTerm": "markup" },
            },
          },
        },
      },
    });
  });

  it("matches the strict parser on well-formed XML", () => {
    const xml = '<?xml version="1.0"?><!-- c --><r a="1"><x>&lt;b&gt; &amp; &#65;&#x42;</x><x/><y k=\'v\'>t</y></r>';
    expect(parseDocument("xml", xml).note).toBeUndefined();
    expect(parseXmlLenient(xml)).toEqual(parseAs("xml", xml));
  });

  it("handles DOCTYPE internal subsets, CDATA, unquoted and bare attributes", () => {
    const xml = `<!DOCTYPE r [ <!ENTITY e "x"> <!ELEMENT r ANY> ]>
      <r flag size=3><![CDATA[a < b]]><v>&e; &unknown;</v></r>`;
    expect(parseXmlLenient(xml)).toEqual({
      r: { "@flag": "", "@size": "3", v: "&e; &unknown;", "#text": "a < b" },
    });
  });

  it("ignores stray end tags and closes what is left open at the end", () => {
    expect(parseXmlLenient("<r><a>1</b></a><c>2")).toEqual({ r: { a: "1", c: "2" } });
  });

  it("still rejects text with no elements", () => {
    expect(() => parseAs("xml", "just some text")).toThrow(ParseError);
  });
});

describe("JSON", () => {
  it("parses and reports errors", () => {
    expect(parseAs("json", '{"a": [1]}')).toEqual({ a: [1] });
    expect(() => parseAs("json", "{a: 1}")).toThrow(ParseError);
  });
});

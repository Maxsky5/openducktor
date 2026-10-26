import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as markdownParser from "mdast-util-from-markdown";
import { parseMarkdownDocument, readMarkdownDocument } from "./markdown-document";

/** Records the text of each parser call. The spy calls the real parser. */
const parsedTexts = () => {
  const spy = spyOn(markdownParser, "fromMarkdown");
  return {
    texts: () => spy.mock.calls.map((call) => String(call[0])),
    restore: () => spy.mockRestore(),
  };
};

let restoreSpy: (() => void) | null = null;
afterEach(() => {
  restoreSpy?.();
  restoreSpy = null;
});

const types = (markdown: string): string[] =>
  parseMarkdownDocument(markdown, null).blocks.map((block) => block.node.type);

describe("parseMarkdownDocument", () => {
  test("splits the text into top-level blocks with their source", () => {
    const document = parseMarkdownDocument("# Title\n\nSome *text*.\n\n- a\n- b\n", null);
    expect(document.blocks.map((block) => [block.node.type, block.source, block.start])).toEqual([
      ["heading", "# Title", 0],
      ["paragraph", "Some *text*.", 9],
      ["list", "- a\n- b", 23],
    ]);
    expect(document.blocks.map((block) => block.key)).toEqual(["0", "9", "23"]);
  });

  test("parses only the last block again while text streams", () => {
    const first = parseMarkdownDocument("Intro paragraph.\n\nSecond one.\n\nThird", null);
    const spy = parsedTexts();
    restoreSpy = spy.restore;
    const next = parseMarkdownDocument(`${first.markdown} grows`, first);
    expect(spy.texts()).toEqual(["Third grows"]);
    expect(next.blocks[0]).toBe(first.blocks[0]);
    expect(next.blocks[1]).toBe(first.blocks[1]);
    expect(next.blocks[2]?.source).toBe("Third grows");
    expect(next.blocks[2]?.start).toBe(first.blocks[2]?.start);
  });

  test("keeps the block object when streamed whitespace leaves it unchanged", () => {
    const first = parseMarkdownDocument("One.\n\nTwo.", null);
    const next = parseMarkdownDocument("One.\n\nTwo.\n\n", first);
    expect(next.blocks).toEqual(first.blocks);
    expect(next.blocks[1]).toBe(first.blocks[1]);
  });

  test("parses the block before the last when no blank line separates them", () => {
    // `#` alone is a heading that interrupts the paragraph; `#a` joins the paragraph again.
    const first = parseMarkdownDocument("Intro.\n\nfoo\n#", null);
    expect(first.blocks.map((block) => block.node.type)).toEqual([
      "paragraph",
      "paragraph",
      "heading",
    ]);
    const spy = parsedTexts();
    restoreSpy = spy.restore;
    const next = parseMarkdownDocument("Intro.\n\nfoo\n#a", first);
    expect(spy.texts()).toEqual(["foo\n#a"]);
    expect(next.blocks.map((block) => block.source)).toEqual(["Intro.", "foo\n#a"]);
    expect(next.blocks[0]).toBe(first.blocks[0]);
  });

  test("lets a streamed list item join the list before it", () => {
    const first = parseMarkdownDocument("1. one\n\n2", null);
    expect(first.blocks.map((block) => block.node.type)).toEqual(["list", "paragraph"]);
    const next = parseMarkdownDocument("1. one\n\n2. two", first);
    expect(next).toEqual(parseMarkdownDocument("1. one\n\n2. two", null));
    expect(next.blocks.map((block) => block.node.type)).toEqual(["list"]);
  });

  test("parses in full when the text changes before its end", () => {
    const first = parseMarkdownDocument("One.\n\nTwo.", null);
    const spy = parsedTexts();
    restoreSpy = spy.restore;
    parseMarkdownDocument("Uno.\n\nTwo.", first);
    expect(spy.texts()).toEqual(["Uno.\n\nTwo."]);
  });

  test("parses in full when a definition exists, so references resolve", () => {
    const first = parseMarkdownDocument("See [docs].\n\n[docs]: https://example.com", null);
    expect(first.definitions.get("docs")).toEqual({ url: "https://example.com", title: null });
    const next = parseMarkdownDocument(`${first.markdown}\n\nMore [docs].`, first);
    expect(next.blocks.at(-1)?.node).toMatchObject({
      type: "paragraph",
      children: [
        { type: "text", value: "More " },
        { type: "linkReference", identifier: "docs" },
        { type: "text", value: "." },
      ],
    });
    const late = parseMarkdownDocument(
      "Use [x].\n\n[x]: https://x.dev",
      parseMarkdownDocument("Use [x].", null),
    );
    expect(late.blocks[0]?.node).toMatchObject({ children: [{}, { type: "linkReference" }, {}] });
    expect(late.definitions.get("x")?.url).toBe("https://x.dev");
  });

  test("reads GFM tables, task lists, strikethrough, and autolinks", () => {
    const document = parseMarkdownDocument(
      "| a | b |\n| :- | -: |\n| 1 | 2 |\n\n- [x] done\n- [ ] open\n\n~~old~~ www.example.com",
      null,
    );
    const [table, list, paragraph] = document.blocks.map((block) => block.node);
    expect(table).toMatchObject({ type: "table", align: ["left", "right"] });
    expect(list).toMatchObject({ type: "list", children: [{ checked: true }, { checked: false }] });
    expect(paragraph).toMatchObject({
      type: "paragraph",
      children: [
        { type: "delete", children: [{ type: "text", value: "old" }] },
        { type: "text", value: " " },
        { type: "link", url: "http://www.example.com" },
      ],
    });
    expect(document.blocks.every((block) => block.route === "native")).toBe(true);
  });

  test("keeps raw HTML as an html node with its text", () => {
    expect(parseMarkdownDocument("<script>alert(1)</script>", null).blocks[0]?.node).toEqual(
      expect.objectContaining({ type: "html", value: "<script>alert(1)</script>" }),
    );
    expect(types("Hi <b>there</b>")).toEqual(["paragraph"]);
  });

  test("routes math and Mermaid blocks to the isolated page", () => {
    const document = parseMarkdownDocument(
      "Plain text.\n\nInline $x^2$ math.\n\n$$\n\\frac{1}{2}\n$$\n\n```mermaid\ngraph TD\n  A-->B\n```\n\n```ts\nconst a = 1;\n```\n\n- nested $y$",
      null,
    );
    expect(document.blocks.map((block) => block.route)).toEqual([
      "native",
      "math",
      "math",
      "diagram",
      "native",
      "math",
    ]);
  });

  test("shows a streamed Mermaid or math fence as code until it closes", () => {
    const open = parseMarkdownDocument("Text.\n\n```mermaid\ngraph TD\n  A-->", null);
    expect(open.blocks.at(-1)?.route).toBe("native");
    const closed = parseMarkdownDocument(`${open.markdown}B\n\`\`\``, open);
    expect(closed.blocks.at(-1)?.route).toBe("diagram");
    expect(parseMarkdownDocument("$$\n\\alpha", null).blocks[0]?.route).toBe("native");
    expect(parseMarkdownDocument("$$\n\\alpha\n$$", null).blocks[0]?.route).toBe("math");
  });

  test("keeps a list or quote that ends in an open fence native until the fence closes", () => {
    const facts = (markdown: string) =>
      parseMarkdownDocument(markdown, null).blocks.map((block) => [block.route, block.streaming]);
    expect(facts("1. Plan:\n\n   ```mermaid\n   graph TD\n   A-->")).toEqual([["native", true]]);
    expect(facts("1. Plan:\n\n   ```mermaid\n   A-->B\n   ```")).toEqual([["diagram", false]]);
    expect(facts("> ```mermaid\n> graph TD\n> A-->")).toEqual([["native", true]]);
    expect(facts("> ```mermaid\n> A-->B\n> ```")).toEqual([["diagram", false]]);
    expect(facts("- Uses $x$.\n- $$\n  \\alpha")).toEqual([["native", true]]);
    // In a top-level fence, a quote marker is code text, so the line does not close the fence.
    expect(facts("```md\n> ```")).toEqual([["native", true]]);
  });

  test("marks only an open fence at the end of the text as streaming", () => {
    const open = parseMarkdownDocument("Text.\n\n```ts\nconst a = 1;", null);
    expect(open.blocks.map((block) => block.streaming)).toEqual([false, true]);
    const closed = parseMarkdownDocument(`${open.markdown}\n\`\`\``, open);
    expect(closed.blocks.map((block) => block.streaming)).toEqual([false, false]);
    expect(closed.blocks[0]).toBe(open.blocks[0]);
  });
});

describe("readMarkdownDocument", () => {
  test("returns the cached parse for the same revision and text", () => {
    const first = readMarkdownDocument("Cached *text*.", "message-1:1", null);
    expect(readMarkdownDocument("Cached *text*.", "message-1:1", null)).toBe(first);
  });

  test("parses the next text of a revision from its cached document", () => {
    const first = readMarkdownDocument("Alpha.\n\nBeta", "message-2", null);
    const next = readMarkdownDocument("Alpha.\n\nBeta gamma", "message-2", null);
    expect(next.blocks[0]).toBe(first.blocks[0]);
    expect(next.blocks[1]?.source).toBe("Beta gamma");
  });

  test("keys a text without a revision by its content", () => {
    const first = readMarkdownDocument("No revision.", undefined, null);
    expect(readMarkdownDocument("No revision.", undefined, null)).toBe(first);
    expect(readMarkdownDocument("Other text.", undefined, null)).not.toBe(first);
  });
});

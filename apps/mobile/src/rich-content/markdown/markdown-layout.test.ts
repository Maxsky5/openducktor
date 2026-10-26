import { describe, expect, test } from "bun:test";
import type { Paragraph, Table } from "mdast";
import { parseMarkdownDocument } from "./markdown-document";
import { listItemMarker, paragraphSegments, plainText, tableColumnWidths } from "./markdown-layout";

const firstNode = (markdown: string) => {
  const document = parseMarkdownDocument(markdown, null);
  const node = document.blocks[0]?.node;
  if (node === undefined) throw new Error("The test Markdown has no block.");
  return { node, definitions: document.definitions };
};

const table = (markdown: string): Table => {
  const { node } = firstNode(markdown);
  if (node.type !== "table") throw new Error("The test Markdown is not a table.");
  return node;
};

const paragraph = (markdown: string) => {
  const { node, definitions } = firstNode(markdown);
  if (node.type !== "paragraph") throw new Error("The test Markdown is not a paragraph.");
  return { node: node satisfies Paragraph, definitions };
};

const list = (markdown: string) => {
  const { node } = firstNode(markdown);
  if (node.type !== "list") throw new Error("The test Markdown is not a list.");
  return node;
};

describe("listItemMarker", () => {
  test("shows only the checkbox of a task item", () => {
    const items = list("- [ ] Open\n- [x] Done\n- Plain").children;

    expect(items.map((item) => listItemMarker(item, false, 1))).toEqual([
      { kind: "checkbox", checked: false },
      { kind: "checkbox", checked: true },
      { kind: "text", text: "•" },
    ]);
  });

  test("numbers an ordered item that is not a task", () => {
    const [first, second] = list("3. [x] Shipped\n4. Next").children;
    if (!first || !second) throw new Error("The test list has two items.");

    expect(listItemMarker(first, true, 3)).toEqual({ kind: "checkbox", checked: true });
    expect(listItemMarker(second, true, 4)).toEqual({ kind: "text", text: "4." });
  });
});

describe("plainText", () => {
  test("joins the text of inline nodes", () => {
    expect(plainText(paragraph("A **bold** `code` [link](x) ![alt](y)").node)).toBe(
      "A bold code link alt",
    );
  });
});

describe("tableColumnWidths", () => {
  test("fits each column to its longest cell within limits", () => {
    const widths = tableColumnWidths(
      table(`| a | ${"long ".repeat(40)} |\n| - | - |\n| bb | x |`),
      8,
    );
    expect(widths).toEqual([72, 260]);
    expect(
      tableColumnWidths(table("| name | value |\n| - | - |\n| twelve chars | 1 |"), 8),
    ).toEqual([Math.ceil(12 * 8) + 16, 72]);
  });
});

describe("paragraphSegments", () => {
  test("splits a paragraph at its images", () => {
    const { node, definitions } = paragraph(
      "Before ![one](https://a.dev/1.png) after\n![two][ref]\n\n[ref]: odt-asset:x",
    );
    expect(
      paragraphSegments(node.children, definitions).map((segment) =>
        segment.kind === "image"
          ? segment
          : plainText({ type: "paragraph", children: [...segment.nodes] }),
      ),
    ).toEqual([
      "Before ",
      { kind: "image", url: "https://a.dev/1.png", alt: "one" },
      " after\n",
      { kind: "image", url: "odt-asset:x", alt: "two" },
    ]);
  });

  test("keeps a paragraph without images as one text segment", () => {
    const { node, definitions } = paragraph("Just *text*.");
    expect(paragraphSegments(node.children, definitions)).toEqual([
      { kind: "text", nodes: node.children },
    ]);
  });
});

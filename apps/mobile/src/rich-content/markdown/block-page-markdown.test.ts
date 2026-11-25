import { describe, expect, test } from "bun:test";
import { createHtmlRenderer } from "@pierre/words/html";
import { MAX_BLOCK_MARKDOWN_LENGTH } from "../isolated-page/block-page-messages";
import { blockPageMarkdown } from "./block-page-markdown";
import { parseMarkdownDocument } from "./markdown-document";

/** The page text of the first block of `markdown`. */
const pageMarkdown = (markdown: string): string | null => {
  const document = parseMarkdownDocument(markdown, null);
  const block = document.blocks[0];
  if (block === undefined) throw new Error("The text has no block.");
  return blockPageMarkdown(block.source, block.node, document.definitions);
};

describe("blockPageMarkdown", () => {
  test("keeps a block without references as it is", () => {
    expect(pageMarkdown("Area $a^2$ of [a link](https://a.dev).")).toBe(
      "Area $a^2$ of [a link](https://a.dev).",
    );
  });

  test("adds the definitions that other blocks hold, so the page resolves the references", () => {
    const markdown = pageMarkdown(
      'See [the spec][Spec] and ![chart][c] for $O(n)$.\n\n[spec]: https://x.dev/a<b> "The \\"spec\\""\n\n[c]: /c.png\n\n[unused]: /u',
    );
    expect(markdown).toBe(
      'See [the spec][Spec] and ![chart][c] for $O(n)$.\n\n[Spec]: <https://x.dev/a\\<b\\>> "The \\"spec\\""\n[c]: </c.png>',
    );
    // The page renders the text with Words.
    const html = createHtmlRenderer().render(markdown ?? "", false).html;
    expect(html).toContain(
      'href="https://x.dev/a%3Cb%3E" title="The &quot;spec&quot;">the spec</a>',
    );
    expect(html).toContain('src="/c.png" alt="chart"');
  });

  test("returns null for a text longer than a page renders", () => {
    const atLimit = `$x$ ${"a".repeat(MAX_BLOCK_MARKDOWN_LENGTH - 4)}`;
    const definitions = new Map();
    expect(blockPageMarkdown(atLimit, { type: "text", value: atLimit }, definitions)).toBe(atLimit);
    const tooLong = `${atLimit}a`;
    expect(blockPageMarkdown(tooLong, { type: "text", value: tooLong }, definitions)).toBeNull();
  });
});

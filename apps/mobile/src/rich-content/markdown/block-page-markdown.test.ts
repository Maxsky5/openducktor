import { describe, expect, test } from "bun:test";
import { micromark } from "micromark";
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
    expect(micromark(markdown ?? "")).toBe(
      '<p>See <a href="https://x.dev/a%3Cb%3E" title="The &quot;spec&quot;">the spec</a> and <img src="/c.png" alt="chart" /> for $O(n)$.</p>\n',
    );
  });

  test("returns null for a text longer than a page renders", () => {
    expect(pageMarkdown(`$x$ ${"a".repeat(MAX_BLOCK_MARKDOWN_LENGTH)}`)).toBeNull();
    expect(pageMarkdown(`$x$ ${"a".repeat(MAX_BLOCK_MARKDOWN_LENGTH - 4)}`)).not.toBeNull();
  });
});

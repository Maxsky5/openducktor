import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import {
  type DescribedMarkdown,
  describeCompleteMarkdown,
  describeMarkdown,
  type MarkdownBlockContent,
} from "./markdown-stream-content";
import { drawMath } from "./markdown-stream-math";
import { renderMarkdownBlock } from "./markdown-stream-tree";
import { MATH_REMARK_PLUGINS } from "./markdown-math-plugins";
import { RICH_MARKDOWN_URL_TRANSFORM } from "./markdown-renderer-context";

const describeWhileStreaming = (markdown: string, step: number): DescribedMarkdown[] => {
  const described: DescribedMarkdown[] = [];
  let previous: DescribedMarkdown | null = null;
  for (let end = step; end < markdown.length + step; end += step) {
    previous = describeMarkdown(markdown.slice(0, end).trim(), previous);
    described.push(previous);
  }
  return described;
};

const normalizeHtml = (html: string): string =>
  html
    // The server renderer hoists image preload links to the start of each render.
    .replace(/<link rel="preload"[^>]*>/g, "")
    .replace(/>\s+</g, "><")
    .trim();

// The whole text renders with the plugins and URL rule of the other Markdown views that show math.
const renderWholeText = (markdown: string): string =>
  normalizeHtml(
    renderToStaticMarkup(
      <Markdown
        remarkPlugins={MATH_REMARK_PLUGINS}
        rehypePlugins={[rehypeKatex]}
        skipHtml
        urlTransform={RICH_MARKDOWN_URL_TRANSFORM}
      >
        {markdown}
      </Markdown>,
    ),
  );

// The block renders as the stream renderer renders it, with KaTeX for a block that shows math.
const renderBlock = (content: MarkdownBlockContent): string =>
  normalizeHtml(
    renderToStaticMarkup(
      renderMarkdownBlock(
        content,
        {},
        RICH_MARKDOWN_URL_TRANSFORM,
        content.hasMath ? drawMath : undefined,
      ),
    ),
  );

const renderBlocks = ({ blocks, footnotes }: DescribedMarkdown): string =>
  [...blocks, ...(footnotes ? [footnotes] : [])]
    .map(({ content }) => renderBlock(content))
    .join("");

describe("describeMarkdown", () => {
  test("keeps the content object of a block whose input does not change", () => {
    const text = "Text[^1] and [docs].\n\n[^1]: A note.\n\n[docs]: /docs\n\nTail";
    const first = describeMarkdown(text, null);
    const second = describeMarkdown(`${text} grows`, first);

    expect(first.footnotes).not.toBeNull();
    expect(second.blocks[0]?.content).toBe(first.blocks[0]?.content);
    expect(second.footnotes?.content).toBe(first.footnotes?.content);
    expect(second.blocks.at(-1)?.content).not.toBe(first.blocks.at(-1)?.content);
  });

  test("keeps the content object of each block when blocks have the same text", () => {
    const first = describeMarkdown("Same.\n\nSame.\n\nTail", null);
    const second = describeMarkdown("Same.\n\nSame.\n\nTail grows", first);

    expect(second.blocks[0]?.content).toBe(first.blocks[0]?.content);
    expect(second.blocks[1]?.content).toBe(first.blocks[1]?.content);
    expect(second.blocks[0]?.content).not.toBe(second.blocks[1]?.content);
  });

  test("links a reference to a definition in the same task-list math item", () => {
    const { blocks } = describeMarkdown(
      "- [ ] $$\n  x = 1\n  $$\n\n  > [a]: /x\n\n  See [a].",
      null,
    );
    const [item] = blocks;
    if (!item) {
      throw new Error("Expected a block");
    }

    expect(renderBlock(item.content)).toContain('href="/x"');
  });

  test("gives the link definitions only to the blocks that use them", () => {
    const { blocks } = describeMarkdown(
      "See [the docs][docs].\n\nMore text.\n\n> [docs]:\n>   https://example.com",
      null,
    );

    expect(blocks[0]?.content.definitions).toMatchObject([
      { type: "definition", identifier: "docs", url: "https://example.com" },
    ]);
    expect(blocks[1]?.content.definitions).toEqual([]);
  });

  test("describes a complete text once", () => {
    const markdown = "Cached reply with [docs].\n\n[docs]: /docs";

    expect(describeCompleteMarkdown(markdown)).toBe(describeCompleteMarkdown(markdown));
  });

  test("keeps the 200 most recent complete texts", () => {
    const oldest = describeCompleteMarkdown("Recent text 0");
    for (let index = 1; index < 200; index += 1) {
      describeCompleteMarkdown(`Recent text ${index}`);
    }
    const newest = describeCompleteMarkdown("Recent text 200");

    expect(describeCompleteMarkdown("Recent text 200")).toBe(newest);
    expect(describeCompleteMarkdown("Recent text 0")).not.toBe(oldest);
  });

  test("does not keep a complete text longer than 50,000 characters", () => {
    const markdown = "a".repeat(50_001);

    expect(describeCompleteMarkdown(markdown)).not.toBe(describeCompleteMarkdown(markdown));
  });

  test.each([
    "Intro with **bold**.\n\n```mermaid\ngraph TD\n  A --> B\n```\n\n1. one\n2. two\n\n3. three\n\nEnd",
    "- item\n\n  ```ts\n  code\n\n```\n\n> quote\nlazy\n\nfoo\n===\n\n    indented\n\n    code\n\npara",
    "| a | b |\n| - | - |\n| 1 | 2 |\nrow\n\n<!--\ncomment\n\nstill comment\n-->\n\nvisible",
    "Math:\n\n$$\na = b\n\nc = d\n$$\n\nAfter $x$ inline.\n\n- [ ] task\n- [x] $$\n  y = 2\n  $$",
    'Text [ref][r] and [r].\n\n> [i]:\n>   https://example.com/i.png\n>   "A\n>   title"\n\n![img][i] and [R][].\n\n[r]: https://example.com',
    "Intro[^1] and[^2].\n\n- item[^1]\n\n[^1]: Note with [link][l] and $x$.\n\n> [^2]: Quoted\n> note[^1].\n\n    code\n\n[l]: /x\n\nTail[^2].",
    "$z$\n\nIntro[^a].\n\n[^a]: - [ ] $$\n    x = 1\n    $$\n\nTail",
    "- [ ] $$\n  x = 1\n  $$\n\n  > [a]: /x\n\nSee [a].",
    "- [ ] $$\n  x = 1\n  $$\n\n  > [^n]: note\n\nSee[^n].",
    "- [ ] $$\n  x = 1\n  $$\n  - [b]: /y",
    "- [ ] $$\n  x = 1\n  $$\n\n  > [a]: /x\n\n  See [a] and[^n].\n\n  [^n]: A note.\n\nAfter [a].",
  ])("renders each streamed prefix of %j as the whole text renders", (markdown) => {
    for (const described of describeWhileStreaming(markdown, 3)) {
      expect(renderBlocks(described)).toBe(renderWholeText(described.markdown));
    }
  });
});

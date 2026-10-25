import { describe, expect, test } from "bun:test";
import { type MarkdownChunks, splitMarkdownChunks } from "./markdown-chunks";
import { parseMarkdownDocument } from "./markdown-document";

/** The parsed blocks of a text as JSON without source positions, which differ between chunks. */
const blocksOf = (markdown: string): string[] =>
  parseMarkdownDocument(markdown, null).blocks.map((block) =>
    JSON.stringify(block.node, (key, value) => (key === "position" ? undefined : value)),
  );

const expectSameBlocks = (markdown: string, chunks: MarkdownChunks): void => {
  expect(chunks.chunks.map((chunk) => chunk.text).join("")).toBe(markdown);
  for (const chunk of chunks.chunks) {
    expect(markdown.slice(chunk.start, chunk.start + chunk.text.length)).toBe(chunk.text);
  }
  expect(chunks.chunks.flatMap((chunk) => blocksOf(chunk.text))).toEqual(blocksOf(markdown));
};

const SNIPPETS = [
  "# Heading one",
  "## Heading two\n\nText under it.",
  "A plain paragraph with **bold**, `code`, and a [link](https://example.com).",
  "Setext heading\n==============",
  "- tight\n- list",
  "- loose\n\n- list\n\n  with a second paragraph",
  "1. one\n\n2. two\n\n3. three",
  "10. wide\n\n    indented continuation",
  "* star item\n\n+ plus item",
  "> quote line\n> second line",
  "> first quote\n\n> second quote",
  "```ts\nconst a = 1;\n\nconst b = 2;\n```",
  "~~~\nfence with ``` inside\n\nstill fence\n~~~",
  "```\nunclosed fence at the end",
  "$$\nx^2\n\ny^2\n$$",
  "    indented code\n\n    more indented code",
  "| a | b |\n| --- | --- |\n| 1 | 2 |",
  "---",
  "* * *",
  "<div>\nhtml block\n</div>",
  "Text with $inline$ math.",
  "- [ ] open task\n- [x] done task",
  "Line one\nline two of the same paragraph",
  "2",
  "#",
];

/** A seeded generator, so a failure always shows the same text. */
const random = (seed: number) => () => {
  seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
  return seed / 2_147_483_648;
};

describe("splitMarkdownChunks", () => {
  test("keeps a short text whole", () => {
    const text = "One.\n\nTwo.\n";
    expect(splitMarkdownChunks(text, 100).chunks).toEqual([{ start: 0, text }]);
  });

  test("starts chunks at blank lines once a chunk reaches its size", () => {
    const text = "One.\n\nTwo.\n\nThree.\n\nFour.\n";
    expect(splitMarkdownChunks(text, 6).chunks.map((chunk) => chunk.text)).toEqual([
      "One.\n\n",
      "Two.\n\n",
      "Three.\n\n",
      "Four.\n",
    ]);
  });

  test.each([
    ["an indented line", "Intro.\n\n- item\n\n  continued\n", "  continued"],
    ["a list item", "Intro.\n\n1. one\n\n2. two\n", "2. two"],
    ["a quote", "Intro.\n\n> one\n\n> two\n", "> two"],
    ["a line in a fence", "Intro.\n\n```\na\n\nb\n```\n", "b\n"],
  ])("starts no chunk at %s", (_label: string, text: string, line: string) => {
    const chunks = splitMarkdownChunks(text, 1);
    expect(chunks.chunks.map((chunk) => chunk.start)).not.toContain(text.indexOf(line));
    expectSameBlocks(text, chunks);
  });

  test("keeps a text with a definition or raw HTML that can hold blank lines whole", () => {
    for (const text of [
      "Intro.\n\nSee [the docs][docs].\n\n[docs]: https://example.com\n",
      "Intro.\n\nA note[^1].\n\n[^1]: The note.\n",
      "Intro.\n\n<!-- a\n\nb -->\n\nAfter.\n",
      "Intro.\n\n<pre>\na\n\nb\n</pre>\n\nAfter.\n",
    ]) {
      expect(splitMarkdownChunks(text, 1).chunks).toEqual([{ start: 0, text }]);
    }
  });

  test("starts no chunk on the last line, which can still grow", () => {
    const text = "One.\n\nTwo.\n\n2";
    expect(splitMarkdownChunks(text, 1).chunks.at(-1)?.text).toBe("Two.\n\n2");
  });

  test("parses each chunk to the same blocks as the whole text", () => {
    for (let run = 0; run < 300; run += 1) {
      const next = random(run + 1);
      const parts = Array.from(
        { length: 4 + Math.floor(next() * 10) },
        () => SNIPPETS[Math.floor(next() * SNIPPETS.length)] ?? "",
      );
      const text = `${parts.join("\n\n")}\n`;
      for (const size of [1, 40]) expectSameBlocks(text, splitMarkdownChunks(text, size));
    }
  });

  test("keeps the earlier chunks of a text that grows at its end", () => {
    const first = splitMarkdownChunks("One.\n\nTwo.\n\nThr", 6);
    const next = splitMarkdownChunks("One.\n\nTwo.\n\nThree.\n\nFour.\n", 6, first);
    expect(next.chunks[0]).toBe(first.chunks[0]);
    expect(next).toEqual(splitMarkdownChunks("One.\n\nTwo.\n\nThree.\n\nFour.\n", 6));
  });

  test("splits a streamed text as a full split would, at each step", () => {
    const parts = Array.from({ length: 40 }, (_, index) => SNIPPETS[index % SNIPPETS.length]);
    const text = `${parts.join("\n\n")}\n`;
    let chunks: MarkdownChunks | null = null;
    for (let end = 1; end <= text.length; end += 7) {
      chunks = splitMarkdownChunks(text.slice(0, end), 30, chunks);
      expect(chunks).toEqual(splitMarkdownChunks(text.slice(0, end), 30));
    }
  });
});

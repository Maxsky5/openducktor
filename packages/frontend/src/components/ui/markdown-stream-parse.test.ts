import { describe, expect, test } from "bun:test";
import { type ParsedMarkdown, parseMarkdown } from "./markdown-stream-parse";

const parseWhileStreaming = (markdown: string, step: number): ParsedMarkdown[] => {
  const parses: ParsedMarkdown[] = [];
  let previous: ParsedMarkdown | null = null;
  for (let end = step; end < markdown.length + step; end += step) {
    previous = parseMarkdown(markdown.slice(0, end).trim(), previous);
    parses.push(previous);
  }
  return parses;
};

// Nodes keep the positions of the parse that made them, so compare what the blocks render from.
const blockFacts = ({ blocks, definitions }: ParsedMarkdown) => ({
  blocks: blocks.map(({ text, start, linkIds, footnoteIds, hasMath, openFenceCode, node }) => ({
    text,
    start,
    linkIds,
    footnoteIds,
    hasMath,
    openFenceCode,
    type: node.type,
  })),
  definitions: definitions.map(({ start, source }) => ({ start, source })),
});

describe("parseMarkdown", () => {
  test("splits top-level blocks without the blank lines between them", () => {
    const markdown =
      "# Title\n\nIntro text.\n\n```mermaid\ngraph TD\n\n  A --> B\n```\n\n- one\n- two";

    expect(parseMarkdown(markdown, null).blocks.map(({ text }) => text)).toEqual([
      "# Title",
      "Intro text.",
      "```mermaid\ngraph TD\n\n  A --> B\n```",
      "- one\n- two",
    ]);
  });

  test("parses the last two blocks again because new text can join them", () => {
    const first = parseMarkdown("Intro\n\n1. one\n2. two\n\n3", null);
    const second = parseMarkdown("Intro\n\n1. one\n2. two\n\n3. three", first);

    expect(first.blocks.map(({ text }) => text)).toEqual(["Intro", "1. one\n2. two", "3"]);
    expect(second.blocks.map(({ text }) => text)).toEqual(["Intro", "1. one\n2. two\n\n3. three"]);
    expect(second.blocks[0]?.node).toBe(first.blocks[0]?.node);
  });

  test("keeps a display equation with blank lines in one block", () => {
    const parsed = parseMarkdown("Intro\n\n$$\na = b\n\nc = d\n$$\n\nAfter", null);

    expect(parsed.blocks.map(({ text, hasMath }) => [text, hasMath])).toEqual([
      ["Intro", false],
      ["$$\na = b\n\nc = d\n$$", true],
      ["After", false],
    ]);
  });

  test("resolves references to definitions in complete blocks and in later text", () => {
    const parsed = parseMarkdown("See [docs] and[^1].\n\n> [docs]: /docs\n\n[^1]: A note.", null);

    expect(parsed.blocks[0]).toMatchObject({ linkIds: ["docs"], footnoteIds: ["1"] });
    expect(parsed.definitions.map(({ source }) => source)).toEqual([
      "[docs]: /docs",
      "[^1]: A note.",
    ]);
  });

  test("turns a task item that holds display math into a math block", () => {
    const [item] = parseMarkdown("- [ ] $$\n  x = 1\n  $$", null).blocks;

    expect(item?.hasMath).toBe(true);
    expect(item?.node).toMatchObject({
      type: "list",
      children: [
        { type: "listItem", checked: false, children: [{ type: "math", value: "x = 1" }] },
      ],
    });
  });

  test.each([
    ["a fence without a closing line", "Intro\n\n```mermaid\ngraph TD", "graph TD"],
    ["a closed fence", "Intro\n\n```mermaid\ngraph TD\n```", null],
    ["a fence in a list item", "1. Draw:\n\n   ```mermaid\n   graph TD", "graph TD"],
    ["a closed fence in a list item", "1. Draw:\n\n   ```mermaid\n   graph TD\n   ```", null],
    ["a fence in a quote", "> ```mermaid\n> graph TD", "graph TD"],
    ["a closed fence in a quote", "> ```mermaid\n> graph TD\n> ```", null],
    ["a fence with a shorter closing line", "````mermaid\ngraph TD\n```", "graph TD\n```"],
    ["a tilde fence with a backtick line", "~~~mermaid\ngraph TD\n```", "graph TD\n```"],
    ["a closed tilde fence", "~~~mermaid\ngraph TD\n~~~", null],
    ["a paragraph after a fence", "```mermaid\ngraph TD\n```\n\nAfter", null],
  ])("finds the code of %s at the end of the text", (_, markdown, code) => {
    const { blocks } = parseMarkdown(markdown, null);

    expect(blocks.map(({ openFenceCode }) => openFenceCode)).toEqual([
      ...blocks.slice(0, -1).map(() => null),
      code,
    ]);
  });

  test.each([
    "Intro with **bold**.\n\n```mermaid\ngraph TD\n  A --> B\n```\n\n1. one\n2. two\n\n3. three\n\nEnd",
    "- item\n\n  ```ts\n  code\n\n```\n\n> quote\nlazy\n\nfoo\n===\n\n    indented\n\n    code\n\npara",
    "| a | b |\n| - | - |\n| 1 | 2 |\nrow\n\n<!--\ncomment\n\nstill comment\n-->\n\nvisible",
    "Math:\n\n$$\na = b\n\nc = d\n$$\n\nAfter $x$ inline.\n\n- [ ] $$\n  y = 2\n  $$",
    'Text [ref][r] and [r].\n\n> [i]:\n>   https://example.com/i.png\n>   "A\n>   title"\n\n![img][i] and [R][].\n\n[r]: https://example.com',
    "Intro[^1] and[^2].\n\n- item[^1]\n\n[^1]: Note with [link][l].\n\n> [^2]: Quoted\n> note[^1].\n\n    code\n\n[l]: /x\n\nTail[^2].",
    "- [ ] $$\n  x = 1\n  $$\n\n  > [a]: /x\n\nSee [a].",
    "- [ ] $$\n  x = 1\n  $$\n\n  > [^n]: note\n\nSee[^n].",
    "- [ ] $$\n  x = 1\n  $$\n  - [b]: /y",
    "- [ ] $$\n  x = 1\n  $$\n\n  > [a]: /x\n\n  See [a] and[^n].\n\n  [^n]: A note.\n\nAfter [a].",
  ])("parses each streamed prefix of %j as a full parse does", (markdown) => {
    for (const parsed of parseWhileStreaming(markdown, 3)) {
      expect(blockFacts(parsed)).toEqual(blockFacts(parseMarkdown(parsed.markdown, null)));
    }
  });
});

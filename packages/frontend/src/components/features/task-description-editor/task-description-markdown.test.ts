import { describe, expect, test } from "bun:test";
import { hasMarkdownMath } from "@/components/ui/markdown-math-detection";
import {
  assessVisualMarkdownCompatibility,
  canonicalizeTaskDescriptionMarkdown,
  splitTaskDescriptionFrontMatter,
} from "./task-description-markdown";

const supportedFixtures = [
  {
    name: "common formatting",
    markdown:
      "# Heading\n\nParagraph with **bold**, *italic*, ~~strike~~, `code`, and [a link](https://example.com).\n\n> Quote\n\n---\n\n```ts\nconst value = 1\n```",
  },
  {
    name: "lists and task lists",
    markdown: "1. first\n2. second\n\n- bullet\n- [x] done\n- [ ] next",
  },
  {
    name: "simple and aligned GFM tables",
    markdown: "| Left | Center | Right |\n| :--- | :----: | ----: |\n| a | b | c |",
  },
  {
    name: "asset image metadata",
    markdown: '![Architecture](odt-asset:550e8400-e29b-41d4-a716-446655440000 "System diagram")',
  },
  {
    name: "inline and block math",
    markdown: "Euler wrote $e^{i\\pi}+1=0$.\n\n$$\n\\int_0^1 x^2 dx\n$$",
  },
  {
    name: "valid and invalid Mermaid source remains fenced Markdown",
    markdown: "```mermaid\ngraph TD\n  A --> B\n```\n\n```mermaid\nthis is invalid\n```",
  },
] as const;

describe("task description Markdown dialect", () => {
  for (const fixture of supportedFixtures) {
    test(`semantically round-trips ${fixture.name}`, () => {
      const result = assessVisualMarkdownCompatibility(fixture.markdown);

      expect(result).toEqual({ compatible: true });
      expect(
        assessVisualMarkdownCompatibility(canonicalizeTaskDescriptionMarkdown(fixture.markdown)),
      ).toEqual({ compatible: true });
    });
  }

  test("preserves YAML front matter exactly while canonicalizing only the body", () => {
    const markdown =
      "---\r\ntitle: 'Exact'\r\n# keep this comment\r\nsummary: |\r\n  many lines\r\n---\r\n# Body\r\n\r\nText";
    const split = splitTaskDescriptionFrontMatter(markdown);

    expect(split).toEqual({
      kind: "valid",
      raw: "---\r\ntitle: 'Exact'\r\n# keep this comment\r\nsummary: |\r\n  many lines\r\n---\r\n",
      body: "# Body\r\n\r\nText",
    });
    expect(
      canonicalizeTaskDescriptionMarkdown(markdown).startsWith(
        split.kind === "valid" ? split.raw : "",
      ),
    ).toBe(true);
  });

  test("preserves TOML front matter exactly", () => {
    const markdown = '+++\nname = "task"\n+++\nBody';
    expect(splitTaskDescriptionFrontMatter(markdown)).toEqual({
      kind: "valid",
      raw: '+++\nname = "task"\n+++\n',
      body: "Body",
    });
  });

  test("does not treat a byte-order mark or leading content as front matter", () => {
    expect(splitTaskDescriptionFrontMatter("\uFEFF---\ntitle: no\n---\nBody")).toEqual({
      kind: "none",
      raw: "",
      body: "\uFEFF---\ntitle: no\n---\nBody",
    });
  });

  test("blocks unterminated leading front matter", () => {
    expect(assessVisualMarkdownCompatibility("---\ntitle: broken\nBody")).toEqual({
      compatible: false,
      reason: "Close the leading YAML front matter with a --- line before using Visual mode.",
    });
    expect(assessVisualMarkdownCompatibility("+++\ntitle = 'broken'\nBody")).toEqual({
      compatible: false,
      reason: "Close the leading TOML front matter with a +++ line before using Visual mode.",
    });
  });

  test.each([
    ["raw HTML", "Before\n\n<div>unsafe</div>"],
    ["reference links", "Read [the docs][docs].\n\n[docs]: https://example.com"],
    ["reference images", "![Diagram][diagram]\n\n[diagram]: https://example.com/a.png"],
  ])("blocks unsupported %s", (_name, markdown) => {
    const result = assessVisualMarkdownCompatibility(markdown);
    expect(result.compatible).toBe(false);
    if (!result.compatible) {
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  test("does not mistake lookalike syntax in code for unsupported source", () => {
    const markdown =
      "`<span>code</span>`\n\n```md\n<div>still code</div>\n[ref][id]\n![x](odt-asset:not-an-id)\n```";
    expect(assessVisualMarkdownCompatibility(markdown)).toEqual({ compatible: true });
  });

  test("blocks escaped pipes inside GFM table cells before Visual mode can change their meaning", () => {
    const markdown = "| Value | Meaning |\n| :---- | ------: |\n| a\\|b | literal pipe |";

    const result = assessVisualMarkdownCompatibility(markdown);

    expect(result.compatible).toBe(false);
    if (!result.compatible) {
      expect(result.reason).toContain("escaped pipe");
    }
  });

  test("blocks inline links that the Visual codec cannot preserve semantically", () => {
    const markdown = "[a](<https://x.test/a b>)";

    const result = assessVisualMarkdownCompatibility(markdown);

    expect(result.compatible).toBe(false);
    if (!result.compatible) {
      expect(result.reason).toContain("cannot be preserved");
    }
  });

  test.each([
    ["absolute destinations", "[Docs](https://example.com/a?b=c&d=e)"],
    ["relative destinations", "[Guide](../docs/guide.md#setup)"],
    ["escaped link labels", String.raw`[A \[bracket\]](https://example.com)`],
  ])("keeps supported %s in Visual mode", (_name, markdown) => {
    expect(assessVisualMarkdownCompatibility(markdown)).toEqual({ compatible: true });
  });

  test("preserves supported escapes inside aligned GFM table cells", () => {
    const markdown = "| Value |\n| :---- |\n| \\*literal\\* |";

    expect(assessVisualMarkdownCompatibility(markdown)).toEqual({ compatible: true });
    expect(canonicalizeTaskDescriptionMarkdown(markdown)).toContain("\\*literal\\*");
  });

  test.each([
    ["currency with spaced dollars", "Cash $ 5 $"],
    ["shell variables", "Use $HOME and $PATH"],
    ["an escaped currency dollar", String.raw`Escaped \$5`],
    ["an unmatched adjacent dollar", "Price: $5"],
  ])("keeps literal dollar text in Markdown mode for %s", (_name, markdown) => {
    const result = assessVisualMarkdownCompatibility(markdown);

    expect(result.compatible).toBe(false);
    if (!result.compatible) {
      expect(result.reason.toLowerCase()).toContain("dollar");
    }
  });

  test.each([
    ["inline math", "Euler wrote $e^{i\\pi}+1=0$."],
    ["block math", "$$\n\\int_0^1 x^2 dx\n$$"],
    ["adjacent inline math", "Values $x$ and $y$ are valid."],
  ])("keeps valid %s available in Visual mode", (_name, markdown) => {
    expect(assessVisualMarkdownCompatibility(markdown)).toEqual({ compatible: true });
  });

  test.each([
    ["a bullet item", "- $$\n  x\n  $$"],
    ["an ordered item", "1. $$\n   x\n   $$"],
    ["a task item", "- [ ] $$\n  x\n  $$"],
  ])("semantically round-trips block math as the first child of %s", (_name, markdown) => {
    expect(assessVisualMarkdownCompatibility(markdown)).toEqual({ compatible: true });

    const canonical = canonicalizeTaskDescriptionMarkdown(markdown);

    expect(canonical).toBe(markdown);
    expect(hasMarkdownMath(canonical)).toBe(true);
    expect(assessVisualMarkdownCompatibility(canonical)).toEqual({ compatible: true });
  });

  test.each([
    ["ordered prose before math", "1. Before\n\n   $$\n   x\n   $$"],
    ["task-item prose after math", "- [ ] $$\n  x\n  $$\n\n  After"],
    ["two math blocks in one bullet", "- $$\n  x\n  $$\n\n  $$\n  y\n  $$"],
    [
      "two task-item math blocks before prose",
      "- [ ] $$\n  x\n  $$\n\n  $$\n  y\n  $$\n\n  After **bold**",
    ],
    ["math before a nested list", "- $$\n  x\n  $$\n\n  - nested"],
  ])("semantically round-trips compound list math with %s", (_name, markdown) => {
    expect(assessVisualMarkdownCompatibility(markdown)).toEqual({ compatible: true });

    const canonical = canonicalizeTaskDescriptionMarkdown(markdown);

    expect(hasMarkdownMath(canonical)).toBe(true);
    expect(assessVisualMarkdownCompatibility(canonical)).toEqual({ compatible: true });
  });

  test.each([
    ["1. with trailing prose", "1. $$\n   x\n   $$\n\n   After"],
    ["10. with trailing prose", "10. $$\n    x\n    $$\n\n    After"],
    ["99. with trailing prose", "99. $$\n    x\n    $$\n\n    After"],
    ["repeated math before prose", "1. $$\n   x\n   $$\n\n   $$\n   y\n   $$\n\n   After"],
    ["math before a nested list", "1. $$\n   x\n   $$\n\n   - nested"],
  ])("semantically round-trips ordered-list block math for %s", (_name, markdown) => {
    expect(assessVisualMarkdownCompatibility(markdown)).toEqual({ compatible: true });

    const canonical = canonicalizeTaskDescriptionMarkdown(markdown);

    expect(hasMarkdownMath(canonical)).toBe(true);
    expect(assessVisualMarkdownCompatibility(canonical)).toEqual({ compatible: true });
  });

  test.each([
    ["a leading blockquote", "- > quote"],
    ["a leading fenced code block", "- ```ts\n  const value = 1\n  ```"],
    ["a leading Mermaid block", "- ```mermaid\n  graph TD\n    A --> B\n  ```"],
    ["a leading heading", "- # Heading"],
    ["a leading nested list", "- - nested"],
    ["a blockquote followed by prose", "- > quote\n\n  After"],
  ])("semantically round-trips list items with %s", (_name, markdown) => {
    expect(assessVisualMarkdownCompatibility(markdown)).toEqual({ compatible: true });

    const canonical = canonicalizeTaskDescriptionMarkdown(markdown);

    expect(assessVisualMarkdownCompatibility(canonical)).toEqual({ compatible: true });
  });

  test.each([
    ["a 1. blockquote", "1. > quote"],
    ["a 10. blockquote", "10. > quote"],
    ["a leading fenced code block", "1. ```ts\n   const value = 1\n   ```"],
    ["a leading Mermaid block", "1. ```mermaid\n   graph TD\n     A --> B\n   ```"],
    ["a blockquote followed by prose", "1. > quote\n\n   After"],
    ["a nested ordered blockquote", "1. Parent\n   1. > nested quote"],
    ["a leading heading", "1. # Heading"],
    ["a leading nested ordered list", "1. 1. nested"],
    ["a nested ordered list followed by parent prose", "1. Before\n   1. Nested\n\n   After"],
    ["a nested ordered list followed by a parent quote", "1. Before\n   1. Nested\n\n   > quote"],
    ["a nested ordered list followed by a parent bullet", "1. Before\n   1. Nested\n\n   - bullet"],
    [
      "a nested ordered list followed by parent block math",
      "1. Before\n   1. Nested\n\n   $$\n   x\n   $$",
    ],
    [
      "a nested ordered list followed by a parent fence",
      "1. Before\n   1. Nested\n\n   ```ts\n   value\n   ```",
    ],
    ["an ordered fence containing a list lookalike", "1. ```md\n   1. fake\n   ```"],
    [
      "an ordered Mermaid fence containing a list lookalike",
      "1. ```mermaid\n   1. invalid\n   ```",
    ],
    ["a zero-start dot marker", "0. > quote"],
    ["a zero-start parenthesis marker", "0) > quote"],
    [
      "block math followed by fenced code",
      "1. $$\n   x\n   $$\n\n   ```ts\n   const value = 1\n   ```",
    ],
    [
      "block math followed by Mermaid",
      "1. $$\n   x\n   $$\n\n   ```mermaid\n   graph TD\n     A --> B\n   ```",
    ],
    [
      "block math followed by an image",
      "1. $$\n   x\n   $$\n\n   ![Diagram](https://example.com/diagram.png)",
    ],
    ["block math followed by a thematic rule", "1. $$\n   x\n   $$\n\n   ---"],
  ])("semantically round-trips ordered list items with %s", (_name, markdown) => {
    expect(assessVisualMarkdownCompatibility(markdown)).toEqual({ compatible: true });

    const canonical = canonicalizeTaskDescriptionMarkdown(markdown);

    expect(assessVisualMarkdownCompatibility(canonical)).toEqual({ compatible: true });
  });

  test.each([
    ["spaces before LF and a following paragraph", "$$\nx\n$$   \n\nAfter"],
    ["a tab before CRLF and a following paragraph", "$$\r\nx\r\n$$\t\r\n\r\nAfter"],
    ["spaces at EOF", "$$\nx\n$$   "],
  ])("keeps renderer semantics stable for block math with %s", (_name, markdown) => {
    const canonical = canonicalizeTaskDescriptionMarkdown(markdown);

    expect(hasMarkdownMath(markdown)).toBe(true);
    expect(assessVisualMarkdownCompatibility(markdown)).toEqual({ compatible: true });
    expect(hasMarkdownMath(canonical)).toBe(true);
  });

  test.each([
    ["block math in a blockquote", "> $$\n> x\n> $$"],
    ["block math in a nested blockquote", "> > $$\n> > x\n> > $$"],
    ["inline math between unmatched backticks", "before `\n\n$x$\n\nafter `"],
  ])("keeps parser-aligned %s available in Visual mode", (_name, markdown) => {
    expect(hasMarkdownMath(markdown)).toBe(true);
    expect(assessVisualMarkdownCompatibility(markdown)).toEqual({ compatible: true });
  });

  test.each([
    ["open-only block", "$$\nx"],
    ["open block that absorbs later inline math", "$$\nx\n\nThen $y$"],
    ["close-only block after inline math", "Before $y$\n\nx\n$$"],
    ["CRLF open-only block", "$$\r\nx\r\n\r\nAfter"],
  ])("keeps malformed %s in Markdown mode", (_name, markdown) => {
    const result = assessVisualMarkdownCompatibility(markdown);

    expect(result.compatible).toBe(false);
    if (!result.compatible) {
      expect(result.reason).toContain("Block math delimiters");
    }
  });

  test.each([["fenced code", "````md\n$$\nx\n$$\n````"]])(
    "does not gate block-math lookalikes in %s",
    (_name, markdown) => {
      expect(assessVisualMarkdownCompatibility(markdown)).toEqual({ compatible: true });
    },
  );

  test("uses neutral guidance for a non-math renderer mismatch", () => {
    expect(assessVisualMarkdownCompatibility("a &copy; b")).toEqual({
      compatible: false,
      reason:
        "This Markdown changes meaning in the canonical renderer after Visual editing. Keep it in Markdown mode or simplify the source form.",
    });
  });

  test.each([
    ["one formula", "$$x$$"],
    ["surrounding text", "Before $$x$$ after"],
    ["adjacent formulas", "$$x$$ and $$y$$"],
  ])(
    "keeps same-line double-dollar math in Markdown mode for %s when Visual serialization changes renderer meaning",
    (_name, markdown) => {
      const result = assessVisualMarkdownCompatibility(markdown);

      expect(result.compatible).toBe(false);
      if (!result.compatible) {
        expect(result.reason).toContain("Block math delimiters");
      }
    },
  );

  test("no-edit compatibility checks do not rewrite CRLF or unusual markers", () => {
    const markdown = "# Heading\r\n\r\n+ first\r\n+ second\r\n";
    const original = markdown;

    expect(assessVisualMarkdownCompatibility(markdown)).toEqual({ compatible: true });
    expect(markdown).toBe(original);
  });
});

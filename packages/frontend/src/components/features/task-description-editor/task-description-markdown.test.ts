import { describe, expect, test } from "bun:test";
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

  test("no-edit compatibility checks do not rewrite CRLF or unusual markers", () => {
    const markdown = "# Heading\r\n\r\n+ first\r\n+ second\r\n";
    const original = markdown;

    expect(assessVisualMarkdownCompatibility(markdown)).toEqual({ compatible: true });
    expect(markdown).toBe(original);
  });
});

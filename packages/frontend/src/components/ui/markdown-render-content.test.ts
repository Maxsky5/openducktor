import { describe, expect, test } from "bun:test";
import { prepareMarkdownRenderContent } from "./markdown-render-content";

describe("prepareMarkdownRenderContent", () => {
  test("strips a valid front matter block", () => {
    const markdown = ["---", "priority: high", "---", "", "Body text."].join("\n");

    expect(prepareMarkdownRenderContent(markdown, true)).toBe("Body text.");
  });

  test("strips a valid front matter block with CRLF line endings", () => {
    const markdown = "---\r\npriority: high\r\n---\r\n\r\nBody text.";

    expect(prepareMarkdownRenderContent(markdown, true)).toBe("Body text.");
  });

  test("keeps a malformed front matter block", () => {
    const markdown = ["---", "priority: high", "", "Body text."].join("\n");

    expect(prepareMarkdownRenderContent(markdown, true)).toBe(markdown);
  });

  test("keeps the front matter block when stripping is off", () => {
    const markdown = ["---", "priority: high", "---", "", "Body text."].join("\n");

    expect(prepareMarkdownRenderContent(markdown, false)).toBe(markdown);
  });

  test("trims surrounding whitespace", () => {
    expect(prepareMarkdownRenderContent("\n  Body text.  \n\n", false)).toBe("Body text.");
    expect(prepareMarkdownRenderContent("\n  Body text.  \n\n", true)).toBe("Body text.");
  });
});

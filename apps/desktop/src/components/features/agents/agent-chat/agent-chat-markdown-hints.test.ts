import { describe, expect, test } from "bun:test";
import { hasMarkdownSyntaxHint } from "./agent-chat-markdown-hints";

describe("agent-chat-markdown-hints", () => {
  test("detects common inline markdown emphasis", () => {
    expect(hasMarkdownSyntaxHint("Use **bold** and *italic* text.")).toBe(true);
    expect(hasMarkdownSyntaxHint("Use __bold__ and _italic_ text.")).toBe(true);
  });

  test("detects bare autolink urls", () => {
    expect(hasMarkdownSyntaxHint("See https://example.com/docs for details.")).toBe(true);
  });

  test("detects horizontal rules", () => {
    expect(hasMarkdownSyntaxHint("Before\n---\nAfter")).toBe(true);
    expect(hasMarkdownSyntaxHint("Before\n***\nAfter")).toBe(true);
    expect(hasMarkdownSyntaxHint("Before\n___\nAfter")).toBe(true);
  });

  test("detects existing block markdown syntax", () => {
    expect(hasMarkdownSyntaxHint("# Heading")).toBe(true);
    expect(hasMarkdownSyntaxHint("| col |\n| --- |")).toBe(true);
  });

  test("does not mark plain text without markdown hints", () => {
    expect(hasMarkdownSyntaxHint("This is plain text with no markdown semantics.")).toBe(false);
  });
});

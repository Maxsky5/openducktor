import { describe, expect, test } from "bun:test";
import { isMarkdownFile } from "./markdown-file";

describe("isMarkdownFile", () => {
  test("accepts the Markdown extensions in any case", () => {
    expect(isMarkdownFile("README.md")).toBe(true);
    expect(isMarkdownFile("docs/guide.MARKDOWN")).toBe(true);
    expect(isMarkdownFile("notes.mdown")).toBe(true);
    expect(isMarkdownFile("notes.mkd")).toBe(true);
  });

  test("rejects other files", () => {
    expect(isMarkdownFile("src/index.ts")).toBe(false);
    expect(isMarkdownFile("README.md.bak")).toBe(false);
    expect(isMarkdownFile("mdfile")).toBe(false);
  });
});

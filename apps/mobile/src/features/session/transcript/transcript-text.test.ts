import { describe, expect, test } from "bun:test";
import { inlineDiffPreview, MAX_INLINE_DIFF_ROWS, previewLines } from "./transcript-text";

describe("inlineDiffPreview", () => {
  test("keeps a 5,000-line diff to the preview rows and counts the rest", () => {
    const rows = Array.from({ length: 5_000 }, (_, index) => index);
    const { previewRows, hidden } = inlineDiffPreview(rows);
    expect(previewRows).toHaveLength(MAX_INLINE_DIFF_ROWS);
    expect(previewRows[0]).toBe(0);
    expect(hidden).toBe(5_000 - MAX_INLINE_DIFF_ROWS);
  });

  test("shows a short diff in full", () => {
    expect(inlineDiffPreview([1, 2, 3])).toEqual({ previewRows: [1, 2, 3], hidden: 0 });
  });
});

describe("previewLines", () => {
  test("keeps the first lines of a long text and counts the rest", () => {
    const text = Array.from({ length: 30 }, (_, index) => `line ${index}`).join("\n");
    const { preview, hiddenLines } = previewLines(text);
    expect(preview.split("\n")).toHaveLength(MAX_INLINE_DIFF_ROWS);
    expect(hiddenLines).toBe(30 - MAX_INLINE_DIFF_ROWS);
  });

  test("shows a short text in full", () => {
    expect(previewLines("a\nb")).toEqual({ preview: "a\nb", hiddenLines: 0 });
  });
});

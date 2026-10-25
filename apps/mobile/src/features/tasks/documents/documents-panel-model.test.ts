import { describe, expect, test } from "bun:test";
import { parseMarkdownDocument } from "@/rich-content/markdown/markdown-document";
import type { DocumentSource } from "./document-rows";
import { documentPanelState, formatDocumentUpdatedAt } from "./documents-panel-model";

const MARKDOWN = "# Plan\n\nFirst step.\n\n- one\n- two";

const source = (overrides: Partial<DocumentSource>): DocumentSource => {
  const document = parseMarkdownDocument(MARKDOWN, null);
  return {
    key: "plan",
    title: "Implementation Plan",
    empty: "No implementation plan yet.",
    updatedAt: "2026-10-01T10:00:00.000Z",
    exists: true,
    isLoading: false,
    error: null,
    blocks: document.blocks,
    definitions: document.definitions,
    imageContext: null,
    badge: null,
    ...overrides,
  };
};

describe("documentPanelState", () => {
  test("lists the blocks with the desktop prose margins between them", () => {
    const state = documentPanelState(source({}));
    if (state.kind !== "ready") throw new Error("The document must be ready.");
    // The first block has no space above it; a paragraph after a heading 1 keeps its margin.
    expect(state.rows.map((row) => row.gap)).toEqual([0, 30, 8]);
    expect(state.markdown).toBe(MARKDOWN);
  });

  test("shows the loading, error, and empty states before any block", () => {
    expect(documentPanelState(source({ blocks: null }))).toEqual({ kind: "loading" });
    expect(documentPanelState(source({ error: "Host read failed." }))).toEqual({
      kind: "error",
      message: "Host read failed.",
    });
    expect(documentPanelState(source({ exists: false }))).toEqual({ kind: "empty" });
    expect(documentPanelState(source({ blocks: [] }))).toEqual({ kind: "empty" });
  });
});

describe("formatDocumentUpdatedAt", () => {
  test("formats a date as the desktop panel and has no text for a missing date", () => {
    expect(formatDocumentUpdatedAt("2026-09-19T16:59:00")).toBe("Sep 19, 04:59 PM");
    expect(formatDocumentUpdatedAt("2026-01-02T00:05:00")).toBe("Jan 02, 12:05 AM");
    expect(formatDocumentUpdatedAt(null)).toBeNull();
    expect(formatDocumentUpdatedAt("not a date")).toBeNull();
  });
});

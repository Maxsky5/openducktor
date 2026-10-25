import { describe, expect, test } from "bun:test";
import { parseMarkdownDocument } from "@/rich-content/markdown/markdown-document";
import { buildDocumentRows, type DocumentSource } from "./document-rows";

const source = (overrides: Partial<DocumentSource>): DocumentSource => {
  const document = parseMarkdownDocument("# Plan\n\nFirst step.\n\n- one\n- two", null);
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

describe("buildDocumentRows", () => {
  test("lists the blocks of a document after its header", () => {
    const rows = buildDocumentRows([source({})]);
    expect(rows.map((row) => row.kind)).toEqual([
      "doc_header",
      "doc_block",
      "doc_block",
      "doc_block",
    ]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  });

  test("marks the first and last block, so a surface can round its corners", () => {
    const positions = buildDocumentRows([source({})]).flatMap((row) =>
      row.kind === "doc_block" ? [[row.first, row.last]] : [],
    );
    expect(positions).toEqual([
      [true, false],
      [false, false],
      [false, true],
    ]);
  });

  test("shows the empty, loading, and error states", () => {
    const states = (overrides: Partial<DocumentSource>) =>
      buildDocumentRows([source(overrides)])[1];
    expect(states({ exists: false })).toMatchObject({
      state: "empty",
      message: "No implementation plan yet.",
    });
    expect(states({ blocks: [] })).toMatchObject({ state: "empty" });
    expect(states({ blocks: null })).toMatchObject({
      state: "loading",
      message: "Loading the implementation plan.",
    });
    expect(states({ error: "Host read failed." })).toMatchObject({
      document: "plan",
      title: "Implementation Plan",
      state: "error",
      message: "Host read failed.",
    });
  });
});

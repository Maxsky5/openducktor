import { describe, expect, test } from "bun:test";
import { parseMarkdownDocument } from "@/rich-content/markdown/markdown-document";
import { buildDocumentRows } from "../documents/document-rows";
import { buildTaskDetailsRows, type DetailsSectionKey } from "./task-details-rows";

const descriptionRows = buildDocumentRows([
  {
    key: "description",
    title: "Description",
    empty: "No description yet.",
    updatedAt: null,
    exists: true,
    isLoading: false,
    error: null,
    ...(() => {
      const document = parseMarkdownDocument("First line.\n\n- one\n- two", null);
      return { blocks: document.blocks, definitions: document.definitions };
    })(),
    imageContext: null,
    badge: null,
  },
]);

const kinds = (
  options: Partial<{
    summaryInList: boolean;
    collapsed: ReadonlySet<DetailsSectionKey>;
  }> = {},
) =>
  buildTaskDetailsRows({
    summaryInList: true,
    descriptionRows,
    collapsed: new Set(),
    ...options,
  }).map((row) => row.kind);

describe("buildTaskDetailsRows", () => {
  test("ends with the metadata, after the description, sessions, and work views", () => {
    expect(kinds()).toEqual([
      "summary",
      "notices",
      "doc_header",
      "doc_block",
      "doc_block",
      "sessions",
      "work",
      "metadata",
    ]);
  });

  test("shows the summary only in the list", () => {
    expect(kinds({ summaryInList: false })).toEqual([
      "notices",
      "doc_header",
      "doc_block",
      "doc_block",
      "sessions",
      "work",
      "metadata",
    ]);
  });

  test("keeps only the header of a closed description", () => {
    expect(kinds({ collapsed: new Set(["description", "sessions"]) })).toEqual([
      "summary",
      "notices",
      "doc_header",
      "sessions",
      "work",
      "metadata",
    ]);
  });
});

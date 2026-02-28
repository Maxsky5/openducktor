import { describe, expect, test } from "bun:test";
import { parseMarkdownEntries, parseQaEntries } from "./task-mapping";

describe("task mapping entry parsers", () => {
  test("parseMarkdownEntries returns only valid markdown metadata entries", () => {
    const parsed = parseMarkdownEntries([
      {
        markdown: "# Spec",
        updatedAt: "2026-02-28T00:00:00Z",
        updatedBy: "agent",
        sourceTool: "odt_set_spec",
        revision: 1,
        ignoredField: "ignored",
      },
      {
        markdown: "# Missing revision",
        updatedAt: "2026-02-28T00:00:00Z",
        updatedBy: "agent",
        sourceTool: "odt_set_spec",
      },
      null,
      "invalid",
    ]);

    expect(parsed).toEqual([
      {
        markdown: "# Spec",
        updatedAt: "2026-02-28T00:00:00Z",
        updatedBy: "agent",
        sourceTool: "odt_set_spec",
        revision: 1,
      },
    ]);
  });

  test("parseQaEntries enforces verdict and required fields", () => {
    const parsed = parseQaEntries([
      {
        markdown: "QA report",
        verdict: "approved",
        updatedAt: "2026-02-28T00:00:00Z",
        updatedBy: "qa-agent",
        sourceTool: "odt_qa_approved",
        revision: 2,
      },
      {
        markdown: "Invalid verdict",
        verdict: "not_reviewed",
        updatedAt: "2026-02-28T00:00:00Z",
        updatedBy: "qa-agent",
        sourceTool: "odt_qa_approved",
        revision: 3,
      },
      {
        markdown: "Missing source tool",
        verdict: "rejected",
        updatedAt: "2026-02-28T00:00:00Z",
        updatedBy: "qa-agent",
        revision: 4,
      },
    ]);

    expect(parsed).toEqual([
      {
        markdown: "QA report",
        verdict: "approved",
        updatedAt: "2026-02-28T00:00:00Z",
        updatedBy: "qa-agent",
        sourceTool: "odt_qa_approved",
        revision: 2,
      },
    ]);
  });

  test("returns an empty array for non-array metadata values", () => {
    expect(parseMarkdownEntries(undefined)).toEqual([]);
    expect(parseMarkdownEntries({})).toEqual([]);
    expect(parseQaEntries(null)).toEqual([]);
    expect(parseQaEntries("invalid")).toEqual([]);
  });
});

import { describe, expect, test } from "bun:test";
import type { RawIssue } from "./contracts";
import { issueToTaskCard, parseMarkdownEntries, parseQaEntries } from "./task-mapping";

describe("task mapping entry parsers", () => {
  test("issueToTaskCard rejects invalid Beads issue types with task context", () => {
    const issue: RawIssue = {
      id: "task-42",
      title: "Broken issue type",
      status: "open",
      issue_type: "decision",
    };

    expect(() => issueToTaskCard(issue, "openducktor")).toThrow(
      'Invalid Beads issue type for task task-42: received "decision".',
    );
  });

  test("issueToTaskCard rejects invalid Beads statuses with task context", () => {
    const issue: RawIssue = {
      id: "task-99",
      title: "Broken status",
      status: 42,
      issue_type: "task",
    };

    expect(() => issueToTaskCard(issue, "openducktor")).toThrow(
      "Invalid Beads status for task task-99: received 42.",
    );
  });

  test("issueToTaskCard preserves task descriptions from Beads issues", () => {
    const issue: RawIssue = {
      id: "task-7",
      title: "Read task description",
      description: "Return the task description to MCP clients.",
      status: "open",
      issue_type: "task",
    };

    expect(issueToTaskCard(issue, "openducktor")).toMatchObject({
      id: "task-7",
      title: "Read task description",
      description: "Return the task description to MCP clients.",
      status: "open",
      issueType: "task",
      aiReviewEnabled: true,
    });
  });

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

  test("rejects invalid revision values", () => {
    const parsedMarkdown = parseMarkdownEntries([
      {
        markdown: "valid",
        updatedAt: "2026-02-28T00:00:00Z",
        updatedBy: "agent",
        sourceTool: "odt_set_spec",
        revision: 1,
      },
      {
        markdown: "nan",
        updatedAt: "2026-02-28T00:00:00Z",
        updatedBy: "agent",
        sourceTool: "odt_set_spec",
        revision: Number.NaN,
      },
      {
        markdown: "infinity",
        updatedAt: "2026-02-28T00:00:00Z",
        updatedBy: "agent",
        sourceTool: "odt_set_spec",
        revision: Infinity,
      },
      {
        markdown: "float",
        updatedAt: "2026-02-28T00:00:00Z",
        updatedBy: "agent",
        sourceTool: "odt_set_spec",
        revision: 1.5,
      },
      {
        markdown: "negative",
        updatedAt: "2026-02-28T00:00:00Z",
        updatedBy: "agent",
        sourceTool: "odt_set_spec",
        revision: -1,
      },
      {
        markdown: "zero",
        updatedAt: "2026-02-28T00:00:00Z",
        updatedBy: "agent",
        sourceTool: "odt_set_spec",
        revision: 0,
      },
    ]);

    const parsedQa = parseQaEntries([
      {
        markdown: "valid qa",
        verdict: "approved",
        updatedAt: "2026-02-28T00:00:00Z",
        updatedBy: "qa-agent",
        sourceTool: "odt_qa_approved",
        revision: 2,
      },
      {
        markdown: "bad revision qa",
        verdict: "rejected",
        updatedAt: "2026-02-28T00:00:00Z",
        updatedBy: "qa-agent",
        sourceTool: "odt_qa_rejected",
        revision: Number.NaN,
      },
    ]);

    expect(parsedMarkdown).toEqual([
      {
        markdown: "valid",
        updatedAt: "2026-02-28T00:00:00Z",
        updatedBy: "agent",
        sourceTool: "odt_set_spec",
        revision: 1,
      },
    ]);
    expect(parsedQa).toEqual([
      {
        markdown: "valid qa",
        verdict: "approved",
        updatedAt: "2026-02-28T00:00:00Z",
        updatedBy: "qa-agent",
        sourceTool: "odt_qa_approved",
        revision: 2,
      },
    ]);
  });

  test("rejects invalid updatedAt values", () => {
    const parsedMarkdown = parseMarkdownEntries([
      {
        markdown: "valid zulu",
        updatedAt: "2026-02-28T00:00:00Z",
        updatedBy: "agent",
        sourceTool: "odt_set_spec",
        revision: 1,
      },
      {
        markdown: "valid offset",
        updatedAt: "2026-02-28T00:00:00+01:00",
        updatedBy: "agent",
        sourceTool: "odt_set_spec",
        revision: 2,
      },
      {
        markdown: "date only",
        updatedAt: "2026-02-28",
        updatedBy: "agent",
        sourceTool: "odt_set_spec",
        revision: 3,
      },
      {
        markdown: "invalid date",
        updatedAt: "not-a-date",
        updatedBy: "agent",
        sourceTool: "odt_set_spec",
        revision: 4,
      },
    ]);

    const parsedQa = parseQaEntries([
      {
        markdown: "valid qa",
        verdict: "approved",
        updatedAt: "2026-02-28T00:00:00Z",
        updatedBy: "qa-agent",
        sourceTool: "odt_qa_approved",
        revision: 1,
      },
      {
        markdown: "invalid qa date",
        verdict: "rejected",
        updatedAt: "2026-02-28",
        updatedBy: "qa-agent",
        sourceTool: "odt_qa_rejected",
        revision: 2,
      },
    ]);

    expect(parsedMarkdown).toEqual([
      {
        markdown: "valid zulu",
        updatedAt: "2026-02-28T00:00:00Z",
        updatedBy: "agent",
        sourceTool: "odt_set_spec",
        revision: 1,
      },
      {
        markdown: "valid offset",
        updatedAt: "2026-02-28T00:00:00+01:00",
        updatedBy: "agent",
        sourceTool: "odt_set_spec",
        revision: 2,
      },
    ]);
    expect(parsedQa).toEqual([
      {
        markdown: "valid qa",
        verdict: "approved",
        updatedAt: "2026-02-28T00:00:00Z",
        updatedBy: "qa-agent",
        sourceTool: "odt_qa_approved",
        revision: 1,
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

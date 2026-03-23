import { describe, expect, test } from "bun:test";
import type { RawIssue } from "./contracts";
import {
  issueToPublicTask,
  issueToTaskCard,
  parseMarkdownEntries,
  parseQaEntries,
} from "./task-mapping";

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

  test("issueToTaskCard maps document summary with latest QA rejected verdict", () => {
    const issue: RawIssue = {
      id: "task-qa-rejected",
      title: "Carry QA summary",
      status: "ai_review",
      issue_type: "task",
      metadata: {
        openducktor: {
          documents: {
            spec: [
              {
                markdown: "# Spec",
                updatedAt: "2026-02-28T00:00:00Z",
                updatedBy: "planner",
                sourceTool: "odt_set_spec",
                revision: 1,
              },
            ],
            implementationPlan: [
              {
                markdown: "# Plan",
                updatedAt: "2026-02-28T01:00:00Z",
                updatedBy: "planner",
                sourceTool: "odt_set_plan",
                revision: 1,
              },
            ],
            qaReports: [
              {
                markdown: "",
                verdict: "approved",
                updatedAt: "2026-02-28T02:00:00Z",
                updatedBy: "qa",
                sourceTool: "odt_qa_approved",
                revision: 1,
              },
              {
                markdown: "Needs changes",
                verdict: "rejected",
                updatedAt: "2026-02-28T03:00:00Z",
                updatedBy: "qa",
                sourceTool: "odt_qa_rejected",
                revision: 2,
              },
            ],
          },
        },
      },
    };

    expect(issueToTaskCard(issue, "openducktor")).toMatchObject({
      id: "task-qa-rejected",
      documentSummary: {
        spec: {
          has: true,
          updatedAt: "2026-02-28T00:00:00Z",
        },
        plan: {
          has: true,
          updatedAt: "2026-02-28T01:00:00Z",
        },
        qaReport: {
          has: true,
          updatedAt: "2026-02-28T03:00:00Z",
          verdict: "rejected",
        },
      },
    });
  });

  test("issueToTaskCard maps document summary with latest QA approved verdict", () => {
    const issue: RawIssue = {
      id: "task-qa-approved",
      title: "Carry QA approved summary",
      status: "ai_review",
      issue_type: "task",
      metadata: {
        openducktor: {
          documents: {
            qaReports: [
              {
                markdown: "Needs fixes first",
                verdict: "rejected",
                updatedAt: "2026-02-28T04:00:00Z",
                updatedBy: "qa",
                sourceTool: "odt_qa_rejected",
                revision: 1,
              },
              {
                markdown: "Looks good now",
                verdict: "approved",
                updatedAt: "2026-02-28T05:00:00Z",
                updatedBy: "qa",
                sourceTool: "odt_qa_approved",
                revision: 2,
              },
            ],
          },
        },
      },
    };

    expect(issueToTaskCard(issue, "openducktor")).toMatchObject({
      id: "task-qa-approved",
      documentSummary: {
        spec: {
          has: false,
        },
        plan: {
          has: false,
        },
        qaReport: {
          has: true,
          updatedAt: "2026-02-28T05:00:00Z",
          verdict: "approved",
        },
      },
    });
  });

  test("issueToTaskCard defaults QA summary to not_reviewed when no QA metadata exists", () => {
    const issue: RawIssue = {
      id: "task-qa-missing",
      title: "No QA yet",
      status: "ready_for_dev",
      issue_type: "task",
      metadata: {
        openducktor: {
          documents: {
            spec: [
              {
                markdown: "",
                updatedAt: "2026-02-28T00:00:00Z",
                updatedBy: "planner",
                sourceTool: "odt_set_spec",
                revision: 1,
              },
            ],
          },
        },
      },
    };

    expect(issueToTaskCard(issue, "openducktor")).toMatchObject({
      id: "task-qa-missing",
      documentSummary: {
        spec: {
          has: false,
          updatedAt: "2026-02-28T00:00:00Z",
        },
        plan: {
          has: false,
        },
        qaReport: {
          has: false,
          verdict: "not_reviewed",
        },
      },
    });
  });

  test("issueToPublicTask rejects invalid Beads created_at timestamps", () => {
    const issue: RawIssue = {
      id: "task-11",
      title: "Broken created_at",
      status: "open",
      issue_type: "task",
      priority: 2,
      labels: [],
      created_at: "not-a-timestamp",
      updated_at: "2026-02-28T00:00:00Z",
      metadata: {},
    };

    expect(() => issueToPublicTask(issue, "openducktor")).toThrow(
      "Invalid Beads created_at for task task-11: expected a valid ISO-8601 timestamp string.",
    );
  });

  test("issueToPublicTask rejects invalid Beads updated_at timestamps", () => {
    const issue: RawIssue = {
      id: "task-12",
      title: "Broken updated_at",
      status: "open",
      issue_type: "task",
      priority: 2,
      labels: [],
      created_at: "2026-02-28T00:00:00Z",
      updated_at: "2026-02-28",
      metadata: {},
    };

    expect(() => issueToPublicTask(issue, "openducktor")).toThrow(
      "Invalid Beads updated_at for task task-12: expected a valid ISO-8601 timestamp string.",
    );
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

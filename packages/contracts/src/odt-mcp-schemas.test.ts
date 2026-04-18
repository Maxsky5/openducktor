import { describe, expect, test } from "bun:test";
import {
  ODT_WORKSPACE_SCOPED_TOOL_NAMES,
  publicTaskSchema,
  taskSummarySchema,
} from "./odt-mcp-schemas";

describe("odt mcp public task schemas", () => {
  test("public task schema parses optional target branches", () => {
    const parsed = publicTaskSchema.parse({
      id: "task-1",
      title: "Bridge task",
      description: "",
      status: "open",
      priority: 2,
      issueType: "task",
      aiReviewEnabled: true,
      labels: [],
      targetBranch: {
        remote: "origin",
        branch: "release/2026.04",
      },
      createdAt: "2026-04-09T00:00:00.000Z",
      updatedAt: "2026-04-09T00:00:00.000Z",
    });

    expect(parsed.targetBranch).toEqual({
      remote: "origin",
      branch: "release/2026.04",
    });
  });

  test("task summary schema keeps targetBranch in the public payload", () => {
    const parsed = taskSummarySchema.parse({
      task: {
        id: "task-1",
        title: "Bridge task",
        description: "",
        status: "open",
        priority: 2,
        issueType: "task",
        aiReviewEnabled: true,
        labels: [],
        targetBranch: {
          remote: "origin",
          branch: "main",
        },
        createdAt: "2026-04-09T00:00:00.000Z",
        updatedAt: "2026-04-09T00:00:00.000Z",
        qaVerdict: "not_reviewed",
        documents: {
          hasSpec: false,
          hasPlan: false,
          hasQaReport: false,
        },
      },
    });

    expect(parsed.task.targetBranch).toEqual({
      remote: "origin",
      branch: "main",
    });
  });

  test("workspace-scoped tool names stay explicit and exclude get_workspaces", () => {
    expect(ODT_WORKSPACE_SCOPED_TOOL_NAMES).toContain("odt_read_task");
    expect(ODT_WORKSPACE_SCOPED_TOOL_NAMES).toContain("odt_create_task");
    expect(ODT_WORKSPACE_SCOPED_TOOL_NAMES).toContain("odt_search_tasks");
    expect(ODT_WORKSPACE_SCOPED_TOOL_NAMES).not.toContain("get_workspaces");
  });
});

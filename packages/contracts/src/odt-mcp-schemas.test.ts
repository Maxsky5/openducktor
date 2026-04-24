import { describe, expect, test } from "bun:test";
import {
  getWorkspacesResultSchema,
  ODT_TOOL_SCHEMAS,
  ODT_WORKSPACE_SCOPED_TOOL_NAMES,
  publicTaskSchema,
  ReadTaskInputSchema,
  taskSummarySchema,
} from "./odt-mcp-schemas";
import {
  ODT_MCP_TOOL_NAMES,
  ODT_WORKFLOW_AGENT_BLOCKED_TOOL_NAMES,
  ODT_WORKFLOW_AGENT_TOOL_NAMES,
} from "./odt-tool-names";

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

  test("workspace-scoped tool names stay explicit and exclude odt_get_workspaces", () => {
    expect([...ODT_WORKSPACE_SCOPED_TOOL_NAMES].sort()).toEqual(
      [
        "odt_build_blocked",
        "odt_build_completed",
        "odt_build_resumed",
        "odt_create_task",
        "odt_qa_approved",
        "odt_qa_rejected",
        "odt_read_task",
        "odt_read_task_documents",
        "odt_search_tasks",
        "odt_set_plan",
        "odt_set_pull_request",
        "odt_set_spec",
      ].sort(),
    );
  });

  test("mcp tool policy lists partition global tools for workflow agents", () => {
    const allTools = new Set(ODT_MCP_TOOL_NAMES);
    const workflowTools = new Set(ODT_WORKFLOW_AGENT_TOOL_NAMES);
    const blockedTools = new Set(ODT_WORKFLOW_AGENT_BLOCKED_TOOL_NAMES);

    expect(ODT_WORKFLOW_AGENT_BLOCKED_TOOL_NAMES).toEqual([
      "odt_get_workspaces",
      "odt_create_task",
      "odt_search_tasks",
    ]);
    expect(allTools).toEqual(new Set([...workflowTools, ...blockedTools]));
    expect(allTools).toEqual(new Set(Object.keys(ODT_TOOL_SCHEMAS)));
    for (const toolName of workflowTools) {
      expect(blockedTools.has(toolName)).toBe(false);
    }
  });

  test("workspace-scoped tool workspaceId description distinguishes ids from paths", () => {
    const description = ReadTaskInputSchema.shape.workspaceId.description ?? "";

    expect(description).toBe(
      "Optional workspaceId. Overrides startup workspace; workflow agents omit.",
    );
  });

  test("get workspaces result keeps workspace records in an object payload", () => {
    const parsed = getWorkspacesResultSchema.parse({
      workspaces: [
        {
          workspaceId: "repo",
          workspaceName: "Repo",
          repoPath: "/repo",
          isActive: true,
          hasConfig: true,
          configuredWorktreeBasePath: null,
          defaultWorktreeBasePath: null,
          effectiveWorktreeBasePath: null,
        },
      ],
    });

    expect(parsed.workspaces[0]?.workspaceId).toBe("repo");
  });
});

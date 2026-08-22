import { describe, expect, test } from "bun:test";
import {
  getWorkspacesResultSchema,
  ODT_READ_TASK_ASSETS_MAX_TOTAL_BYTES,
  ODT_TOOL_SCHEMAS,
  ODT_WORKSPACE_SCOPED_TOOL_NAMES,
  odtToolErrorPayloadSchema,
  publicTaskSchema,
  ReadTaskAssetsInputSchema,
  ReadTaskInputSchema,
  readTaskAssetsResultSchema,
  SetPlanInputSchema,
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
        "odt_read_task_assets",
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
    const description = ReadTaskInputSchema["shape"].workspaceId.description ?? "";

    expect(description).toBe(
      "Optional workspaceId. Overrides startup workspace; workflow agents omit.",
    );
  });

  test("read task assets accepts one ordered batch and rejects empty or duplicate ids", () => {
    const firstAssetId = "28cb7c3d-5ec4-47e8-bffe-090223eae3b7";
    const secondAssetId = "96d20c03-a470-47f6-9472-1a1d34cd23df";

    expect(
      ReadTaskAssetsInputSchema.parse({
        workspaceId: "repo",
        taskId: "task-1",
        assetIds: [firstAssetId, secondAssetId],
      }),
    ).toEqual({
      workspaceId: "repo",
      taskId: "task-1",
      assetIds: [firstAssetId, secondAssetId],
    });
    expect(ReadTaskAssetsInputSchema.safeParse({ taskId: "task-1", assetIds: [] }).success).toBe(
      false,
    );
    expect(
      ReadTaskAssetsInputSchema.safeParse({
        taskId: "task-1",
        assetIds: [firstAssetId, firstAssetId],
      }).success,
    ).toBe(false);
    expect(
      ReadTaskAssetsInputSchema.safeParse({
        taskId: "task-1",
        assetIds: Array.from(
          { length: 51 },
          (_, index) => `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
        ),
      }).success,
    ).toBe(false);
  });

  test("read task assets bridge result validates ordered base64 image payloads", () => {
    const firstAssetId = "28cb7c3d-5ec4-47e8-bffe-090223eae3b7";
    const secondAssetId = "96d20c03-a470-47f6-9472-1a1d34cd23df";

    expect(
      readTaskAssetsResultSchema.parse({
        assets: [
          {
            assetId: firstAssetId,
            mediaType: "image/png",
            byteSize: 3,
            dataBase64: "AQID",
          },
          {
            assetId: secondAssetId,
            mediaType: "image/webp",
            byteSize: 2,
            dataBase64: "BAU=",
          },
        ],
      }),
    ).toEqual({
      assets: [
        {
          assetId: firstAssetId,
          mediaType: "image/png",
          byteSize: 3,
          dataBase64: "AQID",
        },
        {
          assetId: secondAssetId,
          mediaType: "image/webp",
          byteSize: 2,
          dataBase64: "BAU=",
        },
      ],
    });
    expect(readTaskAssetsResultSchema.safeParse({ assets: [] }).success).toBe(false);
    expect(
      readTaskAssetsResultSchema.safeParse({
        assets: [
          {
            assetId: firstAssetId,
            mediaType: "image/png",
            byteSize: 2,
            dataBase64: "AQID",
          },
        ],
      }).success,
    ).toBe(false);

    const aggregateResult = readTaskAssetsResultSchema.safeParse({
      assets: [
        {
          assetId: firstAssetId,
          mediaType: "image/png",
          byteSize: ODT_READ_TASK_ASSETS_MAX_TOTAL_BYTES,
          dataBase64: "AQ==",
        },
        {
          assetId: secondAssetId,
          mediaType: "image/webp",
          byteSize: 1,
          dataBase64: "Ag==",
        },
      ],
    });
    expect(aggregateResult.success).toBe(false);
    if (!aggregateResult.success) {
      expect(aggregateResult.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["assets"],
          message: `Task asset batches must be ${ODT_READ_TASK_ASSETS_MAX_TOTAL_BYTES} bytes or smaller.`,
        }),
      );
    }
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

  test("ODT tool error payload schema accepts stable structured errors", () => {
    const parsed = odtToolErrorPayloadSchema.parse({
      ok: false,
      error: {
        code: "ODT_WORKSPACE_SCOPE_VIOLATION",
        message: "Invalid arguments for tool odt_read_task: workspaceId is not allowed.",
        details: {
          toolName: "odt_read_task",
        },
        issues: [
          {
            path: ["workspaceId"],
            code: "forbidden_workspace_id",
            message: "workspaceId is not allowed in workflow-scoped tool calls.",
          },
        ],
      },
    });

    expect(parsed.error.code).toBe("ODT_WORKSPACE_SCOPE_VIOLATION");
    expect(parsed.error.issues?.[0]?.path).toEqual(["workspaceId"]);
  });

  test("ODT tool error payload schema accepts task transition policy errors", () => {
    const parsed = odtToolErrorPayloadSchema.parse({
      ok: false,
      error: {
        code: "TASK_TRANSITION_NOT_ALLOWED",
        message: "Transition not allowed for task-1 (bug): human_review -> blocked",
      },
    });

    expect(parsed.error.code).toBe("TASK_TRANSITION_NOT_ALLOWED");
  });

  test("ODT tool error payload schema accepts generic task policy errors", () => {
    const parsed = odtToolErrorPayloadSchema.parse({
      ok: false,
      error: {
        code: "TASK_POLICY_ERROR",
        message: "Pull request management is only available from active review statuses.",
      },
    });

    expect(parsed.error.code).toBe("TASK_POLICY_ERROR");
  });

  test("ODT tool error payload schema rejects success envelopes", () => {
    expect(() => {
      odtToolErrorPayloadSchema.parse({
        ok: true,
        error: {
          code: "ODT_TOOL_EXECUTION_ERROR",
          message: "This must not parse as an error envelope.",
        },
      });
    }).toThrow();
  });

  test("SetPlanInputSchema accepts taskId+markdown and rejects unknown subtasks field", () => {
    const valid = SetPlanInputSchema.parse({
      workspaceId: "repo",
      taskId: "task-1",
      markdown: "# Plan",
    });

    expect(valid.taskId).toBe("task-1");
    expect(valid.markdown).toBe("# Plan");

    const result = SetPlanInputSchema.safeParse({
      workspaceId: "repo",
      taskId: "task-1",
      markdown: "# Plan",
      subtasks: [{ title: "Subtask" }],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message).join(" ");
      expect(messages).toContain("subtasks");
    }
  });
});

import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  createTransport,
  expectToolError,
  readToolInputProperties,
  startMockBridge,
  taskReadPayload,
  taskSummaryPayload,
  useMcpServerTestLifecycle,
} from "./test-support/mcp-server-harness";

useMcpServerTestLifecycle();

describe("MCP server tool results", () => {
  test("workspaceId-forbidden mode rejects workspaceId for advertised workspace-scoped tools", async () => {
    const bridge = await startMockBridge();
    const transport = await createTransport(bridge.url, {
      workspaceId: "repo",
      forbidWorkspaceIdInput: true,
    });
    const client = new Client({ name: "odt-mcp-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const tools = await client.listTools();

      expect(readToolInputProperties(tools, "odt_read_task")).toMatchObject({
        taskId: expect.any(Object),
      });
      expect(readToolInputProperties(tools, "odt_read_task")).not.toHaveProperty("workspaceId");
      expect(readToolInputProperties(tools, "odt_set_task_artifact")).not.toHaveProperty(
        "workspaceId",
      );
      expect(readToolInputProperties(tools, "odt_get_workspaces")).not.toHaveProperty(
        "workspaceId",
      );
    } finally {
      await client.close();
    }
  });

  test("workspaceId-forbidden mode rejects explicit workspaceId instead of dropping it", async () => {
    const bridge = await startMockBridge();
    const transport = await createTransport(bridge.url, {
      workspaceId: "repo",
      forbidWorkspaceIdInput: true,
    });
    const client = new Client({ name: "odt-mcp-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "odt_read_task",
        arguments: {
          workspaceId: "tool-repo",
          taskId: "task-1",
        },
      });
      const contentResult = result;
      const error = expectToolError(contentResult);

      expect(error.code).toBe("ODT_WORKSPACE_SCOPE_VIOLATION");
      expect(error.message).toContain("Invalid arguments for tool odt_read_task");
      expect(error.message).toContain("workspaceId");
      expect(error.issues).toEqual([
        {
          path: ["workspaceId"],
          code: "forbidden_workspace_id",
          message:
            "workspaceId is fixed by the startup workspace and is not allowed in tool input.",
        },
      ]);
      expect(error.details).toEqual({ toolName: "odt_read_task" });
      expect(bridge.requests).toEqual([
        { url: "/invoke/odt_mcp_ready", body: {} },
        { url: "/invoke/odt_get_workspaces", body: {} },
      ]);
    } finally {
      await client.close();
    }
  });

  test("workspaceId-forbidden mode executes against the startup workspace", async () => {
    const bridge = await startMockBridge();
    const transport = await createTransport(bridge.url, {
      workspaceId: "repo",
      forbidWorkspaceIdInput: true,
    });
    const client = new Client({ name: "odt-mcp-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "odt_read_task",
        arguments: { taskId: " task-1 " },
      });

      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(taskReadPayload);
      expect(bridge.requests).toContainEqual({
        url: "/invoke/odt_read_task",
        body: { workspaceId: "repo", taskId: "task-1" },
      });
    } finally {
      await client.close();
    }
  });

  test("host bridge HTTP failures return content tool errors", async () => {
    const bridge = await startMockBridge();
    const transport = await createTransport(bridge.url, { workspaceId: "repo" });
    const client = new Client({ name: "odt-mcp-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "odt_set_pull_request",
        arguments: {
          taskId: "task-1",
          number: 42,
        },
      });
      const contentResult = result;
      const error = expectToolError(contentResult);

      expect(error.code).toBe("ODT_HOST_BRIDGE_ERROR");
      expect(error.message).toContain("Unexpected URL: /invoke/odt_set_pull_request");
    } finally {
      await client.close();
    }
  });

  test("host bridge business errors keep their error code", async () => {
    const bridge = await startMockBridge();
    const transport = await createTransport(bridge.url, { workspaceId: "repo" });
    const client = new Client({ name: "odt-mcp-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "odt_build_blocked",
        arguments: {
          taskId: "task-1",
          reason: "needs a product decision",
        },
      });
      const contentResult = result;
      const error = expectToolError(contentResult);

      expect(error.code).toBe("TASK_TRANSITION_NOT_ALLOWED");
      expect(error.message).toBe("Transition not allowed for task-1 (bug): closed -> blocked");
      expect(error.details).toBeUndefined();
    } finally {
      await client.close();
    }
  });

  test("odt_read_task bridge errors do not get validated as success output", async () => {
    const bridge = await startMockBridge();
    const transport = await createTransport(bridge.url, { workspaceId: "repo" });
    const client = new Client({ name: "odt-mcp-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "odt_read_task",
        arguments: {
          taskId: "missing-task",
        },
      });
      const contentResult = result;
      const error = expectToolError(contentResult);

      expect(error.code).toBe("ODT_HOST_BRIDGE_ERROR");
      expect(error.message).toBe("Task missing-task was not found.");
    } finally {
      await client.close();
    }
  });

  test("odt_create_task rejects epic input before reaching the host", async () => {
    const bridge = await startMockBridge();
    const transport = await createTransport(bridge.url, { workspaceId: "repo" });
    const client = new Client({ name: "odt-mcp-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "odt_create_task",
        arguments: {
          title: "Epic work",
          issueType: "epic",
          priority: 2,
        },
      });

      expect(result.isError).toBe(true);
      const textBlock = result.content.find((block) => block.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("Expected an MCP text error result.");
      }
      expect(textBlock.text).toContain(
        "Epic creation is not supported by the public MCP create tool.",
      );
      expect(bridge.requests).not.toContainEqual(
        expect.objectContaining({ url: "/invoke/odt_create_task" }),
      );
    } finally {
      await client.close();
    }
  });

  test("odt_create_task sends the create input to the host bridge", async () => {
    const bridge = await startMockBridge();
    const transport = await createTransport(bridge.url, { workspaceId: "repo" });
    const client = new Client({ name: "odt-mcp-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "odt_create_task",
        arguments: {
          title: "Follow-up",
          issueType: "task",
          priority: 2,
        },
      });

      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(taskSummaryPayload);
      expect(bridge.requests).toContainEqual({
        url: "/invoke/odt_create_task",
        body: {
          workspaceId: "repo",
          title: "Follow-up",
          issueType: "task",
          priority: 2,
        },
      });
    } finally {
      await client.close();
    }
  });

  test("odt_update_task sends only the present patch fields to the host bridge", async () => {
    const bridge = await startMockBridge();
    const transport = await createTransport(bridge.url, { workspaceId: "repo" });
    const client = new Client({ name: "odt-mcp-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "odt_update_task",
        arguments: {
          taskId: "task-1",
          priority: 0,
          labels: [],
        },
      });

      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(taskSummaryPayload);
      expect(bridge.requests).toContainEqual({
        url: "/invoke/odt_update_task",
        body: {
          workspaceId: "repo",
          taskId: "task-1",
          priority: 0,
          labels: [],
        },
      });
    } finally {
      await client.close();
    }
  });

  test("odt_update_task rejects epic conversions before reaching the host", async () => {
    const bridge = await startMockBridge();
    const transport = await createTransport(bridge.url, { workspaceId: "repo" });
    const client = new Client({ name: "odt-mcp-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "odt_update_task",
        arguments: {
          taskId: "task-1",
          issueType: "epic",
        },
      });

      expect(result.isError).toBe(true);
      const textBlock = result.content.find((block) => block.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("Expected an MCP text error result.");
      }
      expect(textBlock.text).toContain(
        "Epic updates are not supported by the public MCP update tool.",
      );
      expect(bridge.requests).not.toContainEqual(
        expect.objectContaining({ url: "/invoke/odt_update_task" }),
      );
    } finally {
      await client.close();
    }
  });

  test("odt_update_task rejects unknown fields before reaching the host", async () => {
    const bridge = await startMockBridge();
    const transport = await createTransport(bridge.url, { workspaceId: "repo" });
    const client = new Client({ name: "odt-mcp-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "odt_update_task",
        arguments: {
          taskId: "task-1",
          status: "closed",
        },
      });

      expect(result.isError).toBe(true);
      const textBlock = result.content.find((block) => block.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("Expected an MCP text error result.");
      }
      expect(textBlock.text).toContain("status");
      expect(bridge.requests).not.toContainEqual(
        expect.objectContaining({ url: "/invoke/odt_update_task" }),
      );
    } finally {
      await client.close();
    }
  });

  test("host response schema failures return content tool errors", async () => {
    const bridge = await startMockBridge();
    const transport = await createTransport(bridge.url, { workspaceId: "repo" });
    const client = new Client({ name: "odt-mcp-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "odt_read_task",
        arguments: {
          taskId: "bad-response",
        },
      });
      const contentResult = result;
      const error = expectToolError(contentResult);

      expect(error.code).toBe("ODT_HOST_RESPONSE_INVALID");
      expect(error.message).toContain("Invalid response from host odt_read_task");
      expect(error.details).toEqual({ command: "odt_read_task" });
      expect(JSON.stringify(error.issues)).toContain("title");
    } finally {
      await client.close();
    }
  });

  test("workspaceId stays advertised for public MCP clients with a startup workspace", async () => {
    const bridge = await startMockBridge();
    const transport = await createTransport(bridge.url, { workspaceId: "repo" });
    const client = new Client({ name: "odt-mcp-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const tools = await client.listTools();

      expect(readToolInputProperties(tools, "odt_read_task")).toHaveProperty("workspaceId");
    } finally {
      await client.close();
    }
  });

  test("workspaceId stays advertised when no startup workspace is configured", async () => {
    const bridge = await startMockBridge();
    const transport = await createTransport(bridge.url);
    const client = new Client({ name: "odt-mcp-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const tools = await client.listTools();

      expect(readToolInputProperties(tools, "odt_read_task")).toHaveProperty("workspaceId");
    } finally {
      await client.close();
    }
  });

  test("ODT_ALLOWED_TOOLS limits the advertised tool surface", async () => {
    const bridge = await startMockBridge();
    const transport = await createTransport(bridge.url, {
      workspaceId: "repo",
      allowedTools: "odt_read_task,odt_read_task_artifacts,odt_build_completed",
    });
    const client = new Client({ name: "odt-mcp-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      const toolNames = tools.tools.map((tool) => tool.name);

      expect(toolNames).toEqual([
        "odt_read_task",
        "odt_read_task_artifacts",
        "odt_build_completed",
      ]);
    } finally {
      await client.close();
    }
  });

  test("advertises canonical tool names as stable approval titles", async () => {
    const bridge = await startMockBridge();
    const transport = await createTransport(bridge.url, {
      workspaceId: "repo",
      allowedTools: "odt_read_task,odt_set_task_artifact,odt_build_completed",
    });
    const client = new Client({ name: "odt-mcp-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const tools = await client.listTools();

      expect(tools.tools.map(({ name, title }) => ({ name, title }))).toEqual([
        { name: "odt_read_task", title: "odt_read_task" },
        { name: "odt_set_task_artifact", title: "odt_set_task_artifact" },
        { name: "odt_build_completed", title: "odt_build_completed" },
      ]);
    } finally {
      await client.close();
    }
  });

  test("odt_get_workspaces keeps structuredContent for workspace discovery payloads", async () => {
    const bridge = await startMockBridge();
    const transport = await createTransport(bridge.url);
    const client = new Client({ name: "odt-mcp-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const result = await client.callTool({ name: "odt_get_workspaces", arguments: {} });
      const contentResult = result;

      expect(contentResult.structuredContent).toEqual({
        workspaces: [
          {
            workspaceId: "repo",
            workspaceName: "Repo",
            abbreviation: null,
            tileColor: null,
            repoPath: "/repo",
            isActive: true,
            hasConfig: true,
            configuredWorktreeBasePath: null,
            defaultWorktreeBasePath: null,
            effectiveWorktreeBasePath: null,
          },
        ],
      });
      expect(JSON.parse(contentResult.content[0]?.text ?? "null")).toEqual({
        workspaces: [
          {
            workspaceId: "repo",
            workspaceName: "Repo",
            abbreviation: null,
            tileColor: null,
            repoPath: "/repo",
            isActive: true,
            hasConfig: true,
            configuredWorktreeBasePath: null,
            defaultWorktreeBasePath: null,
            effectiveWorktreeBasePath: null,
          },
        ],
      });
      expect(bridge.requests).toEqual([
        { url: "/invoke/odt_mcp_ready", body: {} },
        { url: "/invoke/odt_get_workspaces", body: {} },
      ]);
    } finally {
      await client.close();
    }
  });

  test("workspace-scoped object results keep structuredContent and preserve tool input workspaceId", async () => {
    const bridge = await startMockBridge();
    const transport = await createTransport(bridge.url);
    const client = new Client({ name: "odt-mcp-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "odt_read_task",
        arguments: {
          workspaceId: "repo",
          taskId: "task-1",
        },
      });
      const contentResult = result;

      expect(contentResult.structuredContent).toEqual(taskReadPayload);
      expect(JSON.parse(contentResult.content[0]?.text ?? "null")).toEqual(taskReadPayload);
      expect(bridge.requests).toEqual([
        { url: "/invoke/odt_mcp_ready", body: {} },
        {
          url: "/invoke/odt_read_task",
          body: {
            workspaceId: "repo",
            taskId: "task-1",
          },
        },
      ]);
    } finally {
      await client.close();
    }
  });

  test("odt_read_task_assets returns native image blocks without structured output", async () => {
    const bridge = await startMockBridge();
    const transport = await createTransport(bridge.url, { workspaceId: "repo" });
    const client = new Client({ name: "odt-mcp-test", version: "1.0.0" });
    const assetIds = [
      "28cb7c3d-5ec4-47e8-bffe-090223eae3b7",
      "96d20c03-a470-47f6-9472-1a1d34cd23df",
    ];

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      const assetTool = tools.tools.find((tool) => tool.name === "odt_read_task_assets");
      expect(assetTool).toBeTruthy();
      expect(assetTool).not.toHaveProperty("outputSchema");

      const result = await client.callTool({
        name: "odt_read_task_assets",
        arguments: { taskId: "task-1", assetIds },
      });
      const contentResult = result;

      expect(contentResult.structuredContent).toBeUndefined();
      expect(contentResult.content).toEqual([
        {
          type: "text",
          text: "Task description asset 28cb7c3d-5ec4-47e8-bffe-090223eae3b7 (image/png, 3 bytes)",
        },
        { type: "image", data: "AQID", mimeType: "image/png" },
        {
          type: "text",
          text: "Task description asset 96d20c03-a470-47f6-9472-1a1d34cd23df (image/webp, 2 bytes)",
        },
        { type: "image", data: "BAU=", mimeType: "image/webp" },
      ]);
      expect(bridge.requests).toEqual([
        { url: "/invoke/odt_mcp_ready", body: {} },
        { url: "/invoke/odt_get_workspaces", body: {} },
        {
          url: "/invoke/odt_read_task_assets",
          body: { workspaceId: "repo", taskId: "task-1", assetIds },
        },
      ]);
    } finally {
      await client.close();
    }
  });

  test("startup workspace still lets explicit tool input workspaceId override execution", async () => {
    const bridge = await startMockBridge();
    const transport = await createTransport(bridge.url, { workspaceId: "repo" });
    const client = new Client({ name: "odt-mcp-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "odt_read_task",
        arguments: {
          workspaceId: "tool-repo",
          taskId: "task-1",
        },
      });
      const contentResult = result;

      expect(contentResult.structuredContent).toEqual(taskReadPayload);
      expect(bridge.requests).toEqual([
        { url: "/invoke/odt_mcp_ready", body: {} },
        { url: "/invoke/odt_get_workspaces", body: {} },
        {
          url: "/invoke/odt_read_task",
          body: {
            workspaceId: "tool-repo",
            taskId: "task-1",
          },
        },
      ]);
    } finally {
      await client.close();
    }
  });
});

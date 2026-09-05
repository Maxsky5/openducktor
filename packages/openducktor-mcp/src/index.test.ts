import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult, ListToolsResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { RegisteredToolName } from "./listed-tool-schema";
import { ODT_TOOL_SCHEMAS } from "./lib";
import { createMcpServer } from "./mcp-server";
import { type OdtToolErrorPayload, odtToolErrorPayloadSchema } from "@openducktor/contracts";
import { mcpToolPayloadSchema, type McpToolPayload } from "./tool-results";

type McpToolObject = Record<string, McpToolPayload>;
const mcpToolObjectSchema = z.record(z.string(), mcpToolPayloadSchema);
const isMcpToolObject = (value: McpToolPayload): value is McpToolObject =>
  mcpToolObjectSchema.safeParse(value).success;

type RecordedRequest = {
  url: string;
  body: McpToolPayload;
};

const activeServers = new Set<ReturnType<typeof createServer>>();
const activeMcpServers = new Set<Awaited<ReturnType<typeof createMcpServer>>>();
const MCP_STARTUP_ENV_KEYS = [
  "ODT_ALLOWED_TOOLS",
  "ODT_FORBID_WORKSPACE_ID_INPUT",
  "ODT_HOST_TOKEN",
  "ODT_HOST_URL",
  "ODT_WORKSPACE_ID",
  "OPENDUCKTOR_CONFIG_DIR",
] as const;

const closeServer = async (server: ReturnType<typeof createServer>): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
};

const readJsonBody = async (request: IncomingMessage): Promise<McpToolPayload> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const body = Buffer.concat(chunks).toString("utf8").trim();
  if (body.length === 0) {
    return {};
  }

  return mcpToolPayloadSchema.parse(JSON.parse(body));
};

const writeJson = (response: ServerResponse, payload: McpToolPayload, statusCode = 200): void => {
  response.statusCode = statusCode;
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
};

const taskSummaryPayload = {
  task: {
    id: "task-1",
    title: "Read task",
    description: "Inspect task payload",
    status: "open",
    priority: 2,
    issueType: "task",
    aiReviewEnabled: true,
    labels: ["mcp"],
    createdAt: "2026-04-18T00:00:00Z",
    updatedAt: "2026-04-18T00:00:00Z",
    qaVerdict: "not_reviewed",
    documents: {
      hasSpec: false,
      hasPlan: false,
      hasQaReport: false,
    },
  },
};

const startMockBridge = async (): Promise<{ url: string; requests: RecordedRequest[] }> => {
  const requests: RecordedRequest[] = [];
  const server = createServer(async (request, response) => {
    const url = request.url ?? "/";

    // Bun's test fetch applies browser CORS rules to concurrent loopback JSON requests.
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.setHeader("Access-Control-Allow-Headers", "content-type");
      response.setHeader("Access-Control-Allow-Methods", "POST");
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.end();
      return;
    }

    if (url === "/health") {
      requests.push({ url, body: await readJsonBody(request) });
      writeJson(response, { ok: true });
      return;
    }

    if (url === "/invoke/odt_mcp_ready") {
      requests.push({ url, body: await readJsonBody(request) });
      writeJson(response, {
        bridgeVersion: 1,
        toolNames: [
          "odt_get_workspaces",
          "odt_create_task",
          "odt_search_tasks",
          "odt_read_task",
          "odt_read_task_assets",
          "odt_read_task_documents",
          "odt_set_spec",
          "odt_set_plan",
          "odt_build_blocked",
          "odt_build_resumed",
          "odt_build_completed",
          "odt_set_pull_request",
          "odt_qa_approved",
          "odt_qa_rejected",
        ],
      });
      return;
    }

    if (url === "/invoke/odt_get_workspaces") {
      requests.push({ url, body: await readJsonBody(request) });
      writeJson(response, {
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
      return;
    }

    if (url === "/invoke/odt_read_task") {
      const body = await readJsonBody(request);
      requests.push({ url, body });
      if (isMcpToolObject(body) && body.taskId === "missing-task") {
        writeJson(
          response,
          {
            ok: false,
            error: {
              code: "ODT_HOST_BRIDGE_ERROR",
              message: "Task missing-task was not found.",
            },
          },
          404,
        );
        return;
      }
      if (isMcpToolObject(body) && body.taskId === "bad-response") {
        writeJson(response, { task: { id: "bad-response" } });
        return;
      }
      writeJson(response, taskSummaryPayload);
      return;
    }

    if (url === "/invoke/odt_read_task_assets") {
      const body = await readJsonBody(request);
      requests.push({ url, body });
      writeJson(response, {
        assets: [
          {
            assetId: "28cb7c3d-5ec4-47e8-bffe-090223eae3b7",
            mediaType: "image/png",
            byteSize: 3,
            dataBase64: "AQID",
          },
          {
            assetId: "96d20c03-a470-47f6-9472-1a1d34cd23df",
            mediaType: "image/webp",
            byteSize: 2,
            dataBase64: "BAU=",
          },
        ],
      });
      return;
    }

    if (url === "/invoke/odt_build_blocked") {
      requests.push({ url, body: await readJsonBody(request) });
      writeJson(
        response,
        {
          ok: false,
          error: {
            code: "TASK_TRANSITION_NOT_ALLOWED",
            message: "Transition not allowed for task-1 (bug): closed -> blocked",
          },
        },
        400,
      );
      return;
    }

    writeJson(
      response,
      {
        ok: false,
        error: {
          code: "ODT_HOST_BRIDGE_ERROR",
          message: `Unexpected URL: ${url}`,
        },
      },
      404,
    );
  });

  activeServers.add(server);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const address = z.object({ port: z.number() }).safeParse(server.address());
  if (!address.success) {
    throw new Error("Mock bridge failed to bind to a TCP port.");
  }

  return {
    url: `http://127.0.0.1:${address.data.port}`,
    requests,
  };
};

const parseAllowedToolNames = (allowedTools?: string): RegisteredToolName[] | undefined => {
  return allowedTools
    ?.split(",")
    .map((toolName) => toolName.trim())
    .filter(
      (toolName): toolName is RegisteredToolName =>
        toolName.length > 0 && Object.hasOwn(ODT_TOOL_SCHEMAS, toolName),
    );
};

const createTransport = async (
  hostUrl: string,
  options: { workspaceId?: string; forbidWorkspaceIdInput?: boolean; allowedTools?: string } = {},
) => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const context: Parameters<typeof createMcpServer>[0] = { hostUrl };
  if (options.workspaceId) {
    context.workspaceId = options.workspaceId;
  }
  if (options.forbidWorkspaceIdInput) {
    context.forbidWorkspaceIdInput = true;
  }
  const server = await createMcpServer(context, {
    allowedToolNames: parseAllowedToolNames(options.allowedTools),
  });
  activeMcpServers.add(server);
  await server.connect(serverTransport);
  return clientTransport;
};

const expectToolError = (result: CallToolResult): OdtToolErrorPayload["error"] => {
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toBeUndefined();
  const textBlock = result.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Expected an MCP text error result.");
  }
  const payload = odtToolErrorPayloadSchema.parse(JSON.parse(textBlock.text));
  expect(payload).toMatchObject({ ok: false });
  return payload.error;
};

const readToolInputProperties = (toolsResult: ListToolsResult, toolName: string): McpToolObject => {
  const tool = toolsResult.tools.find((entry) => entry.name === toolName);
  const parsed = z
    .object({ properties: z.record(z.string(), mcpToolPayloadSchema) })
    .safeParse(tool?.inputSchema);
  if (!parsed.success) {
    throw new Error(`Expected ${toolName} to expose input schema properties.`);
  }
  return parsed.data.properties;
};

beforeEach(() => {
  for (const key of MCP_STARTUP_ENV_KEYS) {
    delete process.env[key];
  }
});

afterEach(async () => {
  for (const key of MCP_STARTUP_ENV_KEYS) {
    delete process.env[key];
  }
  await Promise.all([
    ...Array.from(activeMcpServers, async (server) => {
      activeMcpServers.delete(server);
      await server.close();
    }),
    ...Array.from(activeServers, async (server) => {
      activeServers.delete(server);
      await closeServer(server);
    }),
  ]);
});

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
      expect(readToolInputProperties(tools, "odt_set_plan")).not.toHaveProperty("workspaceId");
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
      expect(result.structuredContent).toEqual(taskSummaryPayload);
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
        name: "odt_set_plan",
        arguments: {
          taskId: "task-1",
          markdown: "# Plan",
        },
      });
      const contentResult = result;
      const error = expectToolError(contentResult);

      expect(error.code).toBe("ODT_HOST_BRIDGE_ERROR");
      expect(error.message).toContain("Unexpected URL: /invoke/odt_set_plan");
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
      allowedTools: "odt_read_task,odt_read_task_documents,odt_build_completed",
    });
    const client = new Client({ name: "odt-mcp-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      const toolNames = tools.tools.map((tool) => tool.name);

      expect(toolNames).toEqual([
        "odt_read_task",
        "odt_read_task_documents",
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
      allowedTools: "odt_read_task,odt_set_plan,odt_build_completed",
    });
    const client = new Client({ name: "odt-mcp-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const tools = await client.listTools();

      expect(tools.tools.map(({ name, title }) => ({ name, title }))).toEqual([
        { name: "odt_read_task", title: "odt_read_task" },
        { name: "odt_set_plan", title: "odt_set_plan" },
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

      expect(contentResult.structuredContent).toEqual(taskSummaryPayload);
      expect(JSON.parse(contentResult.content[0]?.text ?? "null")).toEqual(taskSummaryPayload);
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

      expect(contentResult.structuredContent).toEqual(taskSummaryPayload);
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

  test("odt_set_plan registered tool excludes subtasks from input schema and description", async () => {
    const bridge = await startMockBridge();
    const transport = await createTransport(bridge.url, { workspaceId: "repo" });
    const client = new Client({ name: "odt-mcp-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const tools = await client.listTools();

      const setPlanTool = tools.tools.find((entry) => entry.name === "odt_set_plan");
      expect(setPlanTool).toBeTruthy();

      expect(setPlanTool?.description).not.toContain("subtask");
      expect(setPlanTool?.description).not.toContain("priority");

      expect(readToolInputProperties(tools, "odt_set_plan")).not.toHaveProperty("subtasks");
    } finally {
      await client.close();
    }
  });
});

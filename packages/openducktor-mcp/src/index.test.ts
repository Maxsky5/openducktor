import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const inheritedEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === "string" &&
      !entry[0].startsWith("ODT_") &&
      !entry[0].startsWith("OPENDUCKTOR_"),
  ),
);

type RecordedRequest = {
  url: string;
  body: unknown;
};

type ContentToolResult = {
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const activeServers = new Set<ReturnType<typeof createServer>>();
const mcpPackageRoot = fileURLToPath(new URL("..", import.meta.url));

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

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const body = Buffer.concat(chunks).toString("utf8").trim();
  if (body.length === 0) {
    return {};
  }

  return JSON.parse(body);
};

const writeJson = (response: ServerResponse, payload: unknown): void => {
  response.statusCode = 200;
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

    if (url === "/health") {
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
      if (
        typeof body === "object" &&
        body !== null &&
        (body as { taskId?: unknown }).taskId === "bad-response"
      ) {
        writeJson(response, { task: { id: "bad-response" } });
        return;
      }
      writeJson(response, taskSummaryPayload);
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: `Unexpected URL: ${url}` }));
  });

  activeServers.add(server);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Mock bridge failed to bind to a TCP port.");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
  };
};

const createTransport = (
  hostUrl: string,
  options: { workspaceId?: string; forbidWorkspaceIdInput?: boolean } = {},
) => {
  return new StdioClientTransport({
    command: process.execPath,
    args: ["src/index.ts"],
    cwd: mcpPackageRoot,
    env: {
      ...inheritedEnv,
      ODT_HOST_URL: hostUrl,
      ...(options.workspaceId ? { ODT_WORKSPACE_ID: options.workspaceId } : {}),
      ...(options.forbidWorkspaceIdInput ? { ODT_FORBID_WORKSPACE_ID_INPUT: "true" } : {}),
    },
    stderr: "pipe",
  });
};

const requireContentToolResult = (result: unknown): ContentToolResult => {
  expect("content" in (result as object)).toBe(true);
  if (!("content" in (result as object))) {
    throw new Error("Expected callTool() to return a content-based tool result.");
  }

  return result as ContentToolResult;
};

const expectStructuredError = (
  result: ContentToolResult,
): { code?: unknown; message?: unknown; details?: unknown; issues?: unknown } => {
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({ ok: false });
  const textPayload = JSON.parse(result.content[0]?.text ?? "null");
  expect(textPayload).toEqual(result.structuredContent);
  const error = (result.structuredContent as { error?: unknown }).error;
  expect(error).toBeTruthy();
  return error as { code?: unknown; message?: unknown; details?: unknown; issues?: unknown };
};

const readToolInputProperties = (
  toolsResult: unknown,
  toolName: string,
): Record<string, unknown> => {
  const tools = (toolsResult as { tools?: Array<{ name?: string; inputSchema?: unknown }> }).tools;
  const tool = tools?.find((entry) => entry.name === toolName);
  const properties = (tool?.inputSchema as { properties?: Record<string, unknown> } | undefined)
    ?.properties;
  if (!properties) {
    throw new Error(`Expected ${toolName} to expose input schema properties.`);
  }
  return properties;
};

afterEach(async () => {
  await Promise.all(
    Array.from(activeServers, async (server) => {
      activeServers.delete(server);
      await closeServer(server);
    }),
  );
});

describe("MCP server tool results", () => {
  test("workspaceId-forbidden mode rejects workspaceId for advertised workspace-scoped tools", async () => {
    const bridge = await startMockBridge();
    const transport = createTransport(bridge.url, {
      workspaceId: "repo",
      forbidWorkspaceIdInput: true,
    });
    const client = new Client({ name: "odt-mcp-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const tools = await client.listTools();

      expect(readToolInputProperties(tools, "odt_read_task")).toMatchObject({
        taskId: expect.any(Object),
        workspaceId: expect.any(Object),
      });
      expect(readToolInputProperties(tools, "odt_set_plan")).toHaveProperty("workspaceId");
      expect(readToolInputProperties(tools, "odt_get_workspaces")).not.toHaveProperty(
        "workspaceId",
      );
    } finally {
      await client.close();
    }
  });

  test("workspaceId-forbidden mode rejects explicit workspaceId instead of dropping it", async () => {
    const bridge = await startMockBridge();
    const transport = createTransport(bridge.url, {
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
      const contentResult = requireContentToolResult(result);
      const error = expectStructuredError(contentResult);

      expect(error.code).toBe("ODT_WORKSPACE_SCOPE_VIOLATION");
      expect(error.message).toContain("Invalid arguments for tool odt_read_task");
      expect(error.message).toContain("workspaceId");
      expect(error.issues).toEqual([
        {
          path: ["workspaceId"],
          code: "forbidden_workspace_id",
          message: "workspaceId is not allowed in workflow-scoped tool calls.",
        },
      ]);
      expect(JSON.stringify(error.details)).toContain("workspaceId");
      expect(bridge.requests).toEqual([
        { url: "/invoke/odt_mcp_ready", body: {} },
        { url: "/invoke/odt_get_workspaces", body: {} },
      ]);
    } finally {
      await client.close();
    }
  });

  test("host bridge HTTP failures return structured tool errors", async () => {
    const bridge = await startMockBridge();
    const transport = createTransport(bridge.url, { workspaceId: "repo" });
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
      const contentResult = requireContentToolResult(result);
      const error = expectStructuredError(contentResult);

      expect(error.code).toBe("ODT_HOST_BRIDGE_ERROR");
      expect(error.message).toContain("Unexpected URL: /invoke/odt_set_plan");
    } finally {
      await client.close();
    }
  });

  test("host response schema failures return structured tool errors", async () => {
    const bridge = await startMockBridge();
    const transport = createTransport(bridge.url, { workspaceId: "repo" });
    const client = new Client({ name: "odt-mcp-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "odt_read_task",
        arguments: {
          taskId: "bad-response",
        },
      });
      const contentResult = requireContentToolResult(result);
      const error = expectStructuredError(contentResult);

      expect(error.code).toBe("ODT_HOST_RESPONSE_INVALID");
      expect(error.message).toContain("Invalid response from host odt_read_task");
      expect(JSON.stringify(error.details)).toContain("title");
    } finally {
      await client.close();
    }
  });

  test("workspaceId stays advertised for public MCP clients with a startup workspace", async () => {
    const bridge = await startMockBridge();
    const transport = createTransport(bridge.url, { workspaceId: "repo" });
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
    const transport = createTransport(bridge.url);
    const client = new Client({ name: "odt-mcp-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const tools = await client.listTools();

      expect(readToolInputProperties(tools, "odt_read_task")).toHaveProperty("workspaceId");
    } finally {
      await client.close();
    }
  });

  test("odt_get_workspaces keeps structuredContent for workspace discovery payloads", async () => {
    const bridge = await startMockBridge();
    const transport = createTransport(bridge.url);
    const client = new Client({ name: "odt-mcp-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const result = await client.callTool({ name: "odt_get_workspaces", arguments: {} });
      const contentResult = requireContentToolResult(result);

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
    const transport = createTransport(bridge.url);
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
      const contentResult = requireContentToolResult(result);

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

  test("startup workspace still lets explicit tool input workspaceId override execution", async () => {
    const bridge = await startMockBridge();
    const transport = createTransport(bridge.url, { workspaceId: "repo" });
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
      const contentResult = requireContentToolResult(result);

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
    const transport = createTransport(bridge.url, { workspaceId: "repo" });
    const client = new Client({ name: "odt-mcp-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const tools = await client.listTools();

      const setPlanTool = (
        tools as { tools?: Array<{ name?: string; description?: string; inputSchema?: unknown }> }
      ).tools?.find((entry) => entry.name === "odt_set_plan");
      expect(setPlanTool).toBeTruthy();

      expect(setPlanTool!.description).not.toContain("subtask");
      expect(setPlanTool!.description).not.toContain("priority");

      expect(readToolInputProperties(tools, "odt_set_plan")).not.toHaveProperty("subtasks");
    } finally {
      await client.close();
    }
  });
});

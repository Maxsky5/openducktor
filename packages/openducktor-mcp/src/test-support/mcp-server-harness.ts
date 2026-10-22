/** Shared helpers of the MCP server tests: a mock host bridge and MCP clients. */
import { afterEach, beforeEach, expect } from "bun:test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult, ListToolsResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { RegisteredToolName } from "../listed-tool-schema";
import { ODT_TOOL_SCHEMAS } from "../lib";
import { createMcpServer } from "../mcp-server";
import {
  ODT_MCP_TOOL_NAMES,
  type OdtToolErrorPayload,
  odtToolErrorPayloadSchema,
} from "@openducktor/contracts";
import { mcpToolPayloadSchema, type McpToolPayload } from "../tool-results";

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
  "ODT_RUNTIME_KIND",
  "ODT_RUNTIME_SESSION_ID",
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

export const taskSummaryPayload = {
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

export const TAB_ID = "6f1c2a8e-3b4d-4e5f-9a6b-7c8d9e0f1a2b";
export const MANAGED_TOOLS = ODT_MCP_TOOL_NAMES.join(",");
export const BROWSER_CLOSE_FAILURE =
  "The user shares this tab. You can close only your agent tabs.";

export const startMockBridge = async (): Promise<{ url: string; requests: RecordedRequest[] }> => {
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
      writeJson(response, { bridgeVersion: 1, toolNames: [...ODT_MCP_TOOL_NAMES] });
      return;
    }

    if (url === "/invoke/odt_get_workspaces") {
      requests.push({ url, body: await readJsonBody(request) });
      writeJson(response, {
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

    if (url === "/invoke/odt_create_task") {
      requests.push({ url, body: await readJsonBody(request) });
      writeJson(response, taskSummaryPayload);
      return;
    }

    if (url === "/invoke/odt_update_task") {
      requests.push({ url, body: await readJsonBody(request) });
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

    if (url === "/invoke/odt_browser_close") {
      requests.push({ url, body: await readJsonBody(request) });
      writeJson(
        response,
        {
          ok: false,
          error: {
            code: "ODT_TOOL_EXECUTION_ERROR",
            message: BROWSER_CLOSE_FAILURE,
            details: {
              browserFailure: { code: "browser_not_closable", message: BROWSER_CLOSE_FAILURE },
            },
          },
        },
        400,
      );
      return;
    }

    if (url === "/invoke/odt_browser_screenshot") {
      requests.push({ url, body: await readJsonBody(request) });
      writeJson(response, {
        content: [
          { type: "text", text: "Screenshot of tab 1" },
          { type: "image", mimeType: "image/png", dataBase64: "AQID" },
        ],
      });
      return;
    }

    if (url.startsWith("/invoke/odt_browser_")) {
      requests.push({ url, body: await readJsonBody(request) });
      writeJson(response, { content: [{ type: "text", text: "Clicked e12" }] });
      return;
    }

    requests.push({ url, body: await readJsonBody(request) });
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

export const createTransport = async (
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

export const expectToolError = (result: CallToolResult): OdtToolErrorPayload["error"] => {
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

export const readToolInputProperties = (
  toolsResult: ListToolsResult,
  toolName: string,
): McpToolObject => {
  const tool = toolsResult.tools.find((entry) => entry.name === toolName);
  const parsed = z
    .object({ properties: z.record(z.string(), mcpToolPayloadSchema) })
    .safeParse(tool?.inputSchema);
  if (!parsed.success) {
    throw new Error(`Expected ${toolName} to expose input schema properties.`);
  }
  return parsed.data.properties;
};

/** Sets the process environment that a managed runtime gives the server, then connects a client. */
export const connectClientWithEnv = async (
  hostUrl: string,
  env: Partial<Record<(typeof MCP_STARTUP_ENV_KEYS)[number], string>>,
): Promise<Client> => {
  Object.assign(process.env, env);
  const transport = await createTransport(hostUrl, {
    workspaceId: "repo",
    forbidWorkspaceIdInput: true,
  });
  const client = new Client({ name: "odt-mcp-test", version: "1.0.0" });
  await client.connect(transport);
  return client;
};

export const browserRequests = (requests: RecordedRequest[]): RecordedRequest[] =>
  requests.filter((request) => request.url.startsWith("/invoke/odt_browser_"));

/** Clears the MCP startup environment around each test and closes the servers that it started. */
export const useMcpServerTestLifecycle = (): void => {
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
};

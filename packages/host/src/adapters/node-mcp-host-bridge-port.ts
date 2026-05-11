import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  ODT_WORKSPACE_SCOPED_TOOL_NAMES,
  type WorkspaceScopedOdtToolName,
} from "@openducktor/contracts";
import type { OdtMcpBridgeService } from "../application/odt-mcp-bridge-service";
import type { WorkspaceSettingsService } from "../application/workspace-settings-service";
import type { OpenCodeMcpBridgeConnection } from "./node-opencode-workspace-starter-port";

export type McpHostBridgeConnectionInput = {
  repoPath: string;
};

export type McpHostBridgePort = {
  ensureConnection(input: McpHostBridgeConnectionInput): Promise<OpenCodeMcpBridgeConnection>;
  close(): Promise<void>;
};

export type CreateNodeMcpHostBridgePortInput = {
  bridgeService: OdtMcpBridgeService;
  workspaceSettingsService: WorkspaceSettingsService;
  token?: string;
};

const APP_TOKEN_HEADER = "x-openducktor-app-token";
const MAX_BODY_BYTES = 1024 * 1024;
const workspaceScopedToolNames = new Set<string>(ODT_WORKSPACE_SCOPED_TOOL_NAMES);

const readRequestBody = (request: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    let body = "";
    let receivedBytes = 0;

    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      receivedBytes += Buffer.byteLength(chunk);
      if (receivedBytes > MAX_BODY_BYTES) {
        reject(new Error("MCP host bridge request body exceeds 1 MiB."));
        request.destroy();
        return;
      }
      body += chunk;
    });
    request.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body) as unknown);
      } catch (error) {
        reject(
          new Error(`Invalid JSON request body: ${error instanceof Error ? error.message : error}`),
        );
      }
    });
    request.on("error", reject);
  });

const sendJson = (response: ServerResponse, statusCode: number, payload: unknown): void => {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
};

const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message.trim() ? error.message : String(error);

const listen = (server: Server): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to bind MCP host bridge on 127.0.0.1."));
        return;
      }
      resolve((address as AddressInfo).port);
    });
  });

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

export const createNodeMcpHostBridgePort = ({
  bridgeService,
  workspaceSettingsService,
  token = randomUUID(),
}: CreateNodeMcpHostBridgePortInput): McpHostBridgePort => {
  let server: Server | null = null;
  let baseUrl: string | null = null;

  const ensureStarted = async (): Promise<string> => {
    if (baseUrl) {
      return baseUrl;
    }

    const nextServer = createServer(async (request, response) => {
      try {
        if (request.method === "GET" && request.url === "/health") {
          sendJson(response, 200, { ok: true });
          return;
        }

        if (request.method !== "POST" || !request.url?.startsWith("/invoke/")) {
          sendJson(response, 404, { error: "MCP host bridge endpoint not found." });
          return;
        }

        const receivedToken = request.headers[APP_TOKEN_HEADER];
        if (receivedToken !== token) {
          sendJson(response, receivedToken === undefined ? 401 : 403, {
            error:
              receivedToken === undefined
                ? "Missing OpenDucktor web host app token."
                : "Invalid OpenDucktor web host app token.",
          });
          return;
        }

        const command = decodeURIComponent(request.url.slice("/invoke/".length));
        const body = await readRequestBody(request);
        if (command === "odt_mcp_ready") {
          sendJson(response, 200, await bridgeService.ready(body));
          return;
        }
        if (command === "odt_get_workspaces") {
          sendJson(response, 200, await bridgeService.getWorkspaces(body));
          return;
        }

        if (!workspaceScopedToolNames.has(command)) {
          sendJson(response, 404, { error: `Unknown MCP host bridge command: ${command}` });
          return;
        }

        sendJson(
          response,
          200,
          await bridgeService.invoke(command as WorkspaceScopedOdtToolName, body),
        );
      } catch (error) {
        sendJson(response, 400, { error: errorMessage(error) });
      }
    });

    const port = await listen(nextServer);
    server = nextServer;
    baseUrl = `http://127.0.0.1:${port}`;
    return baseUrl;
  };

  return {
    async ensureConnection(input) {
      const repoConfig = await workspaceSettingsService.getRepoConfigByRepoPath(input.repoPath);
      return {
        workspaceId: repoConfig.workspaceId,
        hostUrl: await ensureStarted(),
        hostToken: token,
      };
    },
    async close() {
      const current = server;
      server = null;
      baseUrl = null;
      if (current) {
        await closeServer(current);
      }
    },
  };
};

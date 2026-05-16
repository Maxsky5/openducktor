import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  ODT_WORKSPACE_SCOPED_TOOL_NAMES,
  type WorkspaceScopedOdtToolName,
} from "@openducktor/contracts";
import type { OdtMcpBridgeService } from "../../application/mcp/odt-mcp-bridge-service";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";
import type { OpenCodeMcpBridgeConnection } from "../opencode/opencode-workspace-runtime-starter";
import {
  type McpBridgeDiscoveryFile,
  removeMcpBridgeDiscoveryFile,
  resolveMcpBridgeDiscoveryPath,
  writeMcpBridgeDiscoveryFile,
} from "./mcp-bridge-discovery-file";

export { resolveMcpBridgeDiscoveryPath } from "./mcp-bridge-discovery-file";

export type McpHostBridgeConnectionInput = {
  repoPath: string;
};

export type McpHostBridgeServer = {
  ensureConnection(input: McpHostBridgeConnectionInput): Promise<OpenCodeMcpBridgeConnection>;
  ensureExternalDiscoveryReady(): Promise<void>;
  close(): Promise<McpHostBridgeCloseResult>;
};

export type McpHostBridgeCloseResult = {
  baseUrl: string | null;
  closed: boolean;
};

export type CreateMcpHostBridgeServerInput = {
  bridgeService: OdtMcpBridgeService;
  discoveryPath?: string;
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

export const createMcpHostBridgeServer = ({
  bridgeService,
  discoveryPath = resolveMcpBridgeDiscoveryPath(),
  workspaceSettingsService,
  token = randomUUID(),
}: CreateMcpHostBridgeServerInput): McpHostBridgeServer => {
  let server: Server | null = null;
  let baseUrl: string | null = null;
  let publishedDiscovery: McpBridgeDiscoveryFile | null = null;

  const ensureStarted = async (): Promise<{ baseUrl: string; port: number }> => {
    if (baseUrl) {
      return {
        baseUrl,
        port: Number(new URL(baseUrl).port),
      };
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
    const discovery: McpBridgeDiscoveryFile = {
      hostToken: token,
      hostUrl: baseUrl,
      pid: process.pid,
    };
    try {
      await writeMcpBridgeDiscoveryFile(discoveryPath, discovery);
    } catch (error) {
      server = null;
      baseUrl = null;
      try {
        await closeServer(nextServer);
      } catch (closeError) {
        throw new Error(
          `Failed to publish MCP host bridge discovery file and close the unpublished bridge: ${
            closeError instanceof Error ? closeError.message : String(closeError)
          }`,
          { cause: error },
        );
      }
      throw error;
    }
    publishedDiscovery = discovery;
    return { baseUrl, port };
  };

  return {
    async ensureConnection(input) {
      const repoConfig = await workspaceSettingsService.getRepoConfigByRepoPath(input.repoPath);
      const connection = await ensureStarted();
      return {
        workspaceId: repoConfig.workspaceId,
        hostUrl: connection.baseUrl,
        hostToken: token,
      };
    },
    async ensureExternalDiscoveryReady() {
      await ensureStarted();
    },
    async close() {
      const current = server;
      const currentBaseUrl = baseUrl;
      const currentDiscovery = publishedDiscovery;
      server = null;
      baseUrl = null;
      publishedDiscovery = null;
      if (current) {
        await closeServer(current);
        if (currentDiscovery !== null) {
          await removeMcpBridgeDiscoveryFile(discoveryPath, currentDiscovery);
        }
        return { baseUrl: currentBaseUrl, closed: true };
      }
      return { baseUrl: null, closed: false };
    },
  };
};

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { ODT_MCP_TOOL_NAMES, type RepoConfig } from "@openducktor/contracts";
import type { OdtMcpBridgeService } from "../../application/mcp/odt-mcp-bridge-service";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";
import { createMcpHostBridgeServer } from "./mcp-host-bridge-server";

const repoConfig: RepoConfig = {
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  defaultRuntimeKind: "opencode",
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: { providers: {} },
  hooks: { preStart: [], postComplete: [] },
  devServers: [],
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentDefaults: {},
};

const createWorkspaceSettingsService = (): WorkspaceSettingsService =>
  ({
    async getRepoConfigByRepoPath(repoPath: unknown) {
      if (repoPath !== "/repo") {
        throw new Error(`Workspace repo path is not configured: ${String(repoPath)}`);
      }
      return repoConfig;
    },
  }) as WorkspaceSettingsService;

const requestJson = (
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> =>
  new Promise((resolve, reject) => {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = request(
      url,
      {
        method: options.method ?? "GET",
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...options.headers,
        },
      },
      (response) => {
        let payload = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          payload += chunk;
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            body: payload ? (JSON.parse(payload) as unknown) : null,
          });
        });
      },
    );
    req.on("error", reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });

describe("createMcpHostBridgeServer", () => {
  test("publishes and removes the external MCP discovery file", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "openducktor-mcp-discovery-"));
    const discoveryPath = path.join(tempDir, "runtime", "mcp-bridge.json");
    const bridge = createMcpHostBridgeServer({
      discoveryPath,
      token: "token-1",
      workspaceSettingsService: createWorkspaceSettingsService(),
      bridgeService: {
        async ready() {
          return { bridgeVersion: 1, toolNames: [...ODT_MCP_TOOL_NAMES] };
        },
        async getWorkspaces() {
          return { workspaces: [] };
        },
        async invoke() {
          throw new Error("unexpected scoped tool invocation");
        },
      } as OdtMcpBridgeService,
    });

    try {
      await bridge.ensureExternalDiscoveryReady();
      const published = JSON.parse(await readFile(discoveryPath, "utf8")) as {
        hostToken: string;
        hostUrl: string;
        pid: number;
      };

      expect(published).toMatchObject({
        hostToken: "token-1",
        pid: process.pid,
      });
      expect(published.hostUrl.startsWith("http://127.0.0.1:")).toBe(true);

      await bridge.close();
      await expect(readFile(discoveryPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await bridge.close();
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("serves health and authenticated MCP invocations", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "openducktor-mcp-discovery-"));
    const bridge = createMcpHostBridgeServer({
      discoveryPath: path.join(tempDir, "runtime", "mcp-bridge.json"),
      token: "token-1",
      workspaceSettingsService: createWorkspaceSettingsService(),
      bridgeService: {
        async ready() {
          return { bridgeVersion: 1, toolNames: [...ODT_MCP_TOOL_NAMES] };
        },
        async getWorkspaces() {
          return { workspaces: [] };
        },
        async invoke() {
          throw new Error("unexpected scoped tool invocation");
        },
      } as OdtMcpBridgeService,
    });

    try {
      const connection = await bridge.ensureConnection({ repoPath: "/repo" });
      expect(connection).toMatchObject({
        workspaceId: "repo",
        hostToken: "token-1",
      });

      await expect(requestJson(`${connection.hostUrl}/health`)).resolves.toEqual({
        status: 200,
        body: { ok: true },
      });
      const missingToken = await requestJson(`${connection.hostUrl}/invoke/odt_mcp_ready`, {
        method: "POST",
        body: {},
      });
      expect(missingToken.body).toEqual({
        error: "Missing OpenDucktor web host app token.",
      });
      expect(missingToken.status).toBe(401);

      const ready = await requestJson(`${connection.hostUrl}/invoke/odt_mcp_ready`, {
        method: "POST",
        headers: {
          "x-openducktor-app-token": "token-1",
        },
        body: {},
      });
      expect(ready.body).toEqual({
        bridgeVersion: 1,
        toolNames: [...ODT_MCP_TOOL_NAMES],
      });
      expect(ready.status).toBe(200);
    } finally {
      await bridge.close();
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("forwards workspace-scoped commands to the bridge service", async () => {
    const calls: unknown[] = [];
    const tempDir = await mkdtemp(path.join(tmpdir(), "openducktor-mcp-discovery-"));
    const bridge = createMcpHostBridgeServer({
      discoveryPath: path.join(tempDir, "runtime", "mcp-bridge.json"),
      token: "token-1",
      workspaceSettingsService: createWorkspaceSettingsService(),
      bridgeService: {
        async ready() {
          return { bridgeVersion: 1, toolNames: [...ODT_MCP_TOOL_NAMES] };
        },
        async getWorkspaces() {
          return { workspaces: [] };
        },
        async invoke(toolName, input) {
          calls.push({ toolName, input });
          return {
            task: {
              id: "task-1",
              title: "Task",
              description: "",
              status: "in_progress",
              priority: 2,
              issueType: "feature",
              aiReviewEnabled: true,
              labels: [],
              createdAt: "2026-05-10T10:00:00.000Z",
              updatedAt: "2026-05-10T10:01:00.000Z",
            },
          };
        },
      } as OdtMcpBridgeService,
    });

    try {
      const connection = await bridge.ensureConnection({ repoPath: "/repo" });
      const response = await requestJson(`${connection.hostUrl}/invoke/odt_build_resumed`, {
        method: "POST",
        headers: {
          "x-openducktor-app-token": "token-1",
        },
        body: { workspaceId: "repo", taskId: "task-1" },
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        task: { id: "task-1", status: "in_progress" },
      });
      expect(calls).toEqual([
        {
          toolName: "odt_build_resumed",
          input: { workspaceId: "repo", taskId: "task-1" },
        },
      ]);
    } finally {
      await bridge.close();
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});

import { mkdtemp, readFile, rm } from "node:fs/promises";

import { request } from "node:http";

import { tmpdir } from "node:os";

import path from "node:path";

import {
  ODT_MCP_TOOL_NAMES,
  type OdtHostBridgeReady,
  type RepoConfig,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { OdtMcpBridgeService } from "../../application/mcp/odt-mcp-bridge-service";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";
import { TaskPolicyError } from "../../domain/task";
import { type HostErrorDetailValue, HostOperationError } from "../../effect/host-errors";
import { createWorkspaceSettingsServiceTestDouble } from "../../test-support/service-test-doubles";
import { createMcpHostBridgeServer } from "./mcp-host-bridge-server";

class CyclicDetails {
  [key: string]: HostErrorDetailValue;

  readonly loop: HostErrorDetailValue;

  constructor() {
    this.loop = this;
  }
}

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
  createWorkspaceSettingsServiceTestDouble({
    getRepoConfigByRepoPath(repoPath: string) {
      return Effect.tryPromise({
        try: async () => {
          if (repoPath !== "/repo") {
            throw new Error(`Workspace repo path is not configured: ${String(repoPath)}`);
          }
          return repoConfig;
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
  });
const createBridgeService = (service: OdtMcpBridgeService): OdtMcpBridgeService => service;
const requestJson = (
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } = {},
): Promise<{
  status: number;
  body: unknown;
}> =>
  new Promise((resolve, reject) => {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = request(
      url,
      {
        method: options.method ?? "GET",
        headers: {
          ...(body ? { "Content-Type": "application/json" } : undefined),
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
          const parsedBody: unknown = payload ? JSON.parse(payload) : null;
          resolve({
            status: response.statusCode ?? 0,
            body: parsedBody,
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
      bridgeService: createBridgeService({
        ready() {
          return Effect.tryPromise({
            try: async () => {
              return { bridgeVersion: 1, toolNames: [...ODT_MCP_TOOL_NAMES] };
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          });
        },
        getWorkspaces() {
          return Effect.tryPromise({
            try: async () => {
              return { workspaces: [] };
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          });
        },
        invoke() {
          return Effect.tryPromise({
            try: async () => {
              throw new Error("unexpected scoped tool invocation");
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          });
        },
      }),
    });
    try {
      await Effect.runPromise(bridge.ensureExternalDiscoveryReady());
      const published: {
        hostToken: string;
        hostUrl: string;
        pid: number;
      } = JSON.parse(await readFile(discoveryPath, "utf8"));
      expect(published).toMatchObject({
        hostToken: "token-1",
        pid: process.pid,
      });
      expect(published.hostUrl.startsWith("http://127.0.0.1:")).toBe(true);
      await Effect.runPromise(bridge.close());
      await expect(readFile(discoveryPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await Effect.runPromise(bridge.close());
      await rm(tempDir, { force: true, recursive: true });
    }
  });
  test("serves health and authenticated MCP invocations", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "openducktor-mcp-discovery-"));
    const bridge = createMcpHostBridgeServer({
      discoveryPath: path.join(tempDir, "runtime", "mcp-bridge.json"),
      token: "token-1",
      workspaceSettingsService: createWorkspaceSettingsService(),
      bridgeService: createBridgeService({
        ready() {
          return Effect.tryPromise({
            try: async () => {
              return { bridgeVersion: 1, toolNames: [...ODT_MCP_TOOL_NAMES] };
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          });
        },
        getWorkspaces() {
          return Effect.tryPromise({
            try: async () => {
              return { workspaces: [] };
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          });
        },
        invoke() {
          return Effect.tryPromise({
            try: async () => {
              throw new Error("unexpected scoped tool invocation");
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          });
        },
      }),
    });
    try {
      const connection = await Effect.runPromise(bridge.ensureConnection({ repoPath: "/repo" }));
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
        ok: false,
        error: {
          code: "ODT_HOST_BRIDGE_ERROR",
          message: "Missing OpenDucktor web host app token.",
        },
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
      await Effect.runPromise(bridge.close());
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("returns a bridge error when a response payload cannot be serialized", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "openducktor-mcp-discovery-"));
    const bridge = createMcpHostBridgeServer({
      discoveryPath: path.join(tempDir, "runtime", "mcp-bridge.json"),
      token: "token-1",
      workspaceSettingsService: createWorkspaceSettingsService(),
      bridgeService: createBridgeService({
        ready() {
          return Effect.succeed({
            bridgeVersion: 1,
            toolNames: [...ODT_MCP_TOOL_NAMES],
            // @ts-expect-error -- This test verifies that the HTTP boundary rejects non-JSON output.
            invalid: 1n,
          } satisfies OdtHostBridgeReady);
        },
        getWorkspaces() {
          return Effect.succeed({ workspaces: [] });
        },
        invoke() {
          return Effect.dieMessage("unexpected scoped tool invocation");
        },
      }),
    });
    try {
      const connection = await Effect.runPromise(bridge.ensureConnection({ repoPath: "/repo" }));
      const response = await requestJson(`${connection.hostUrl}/invoke/odt_mcp_ready`, {
        method: "POST",
        headers: {
          "x-openducktor-app-token": "token-1",
        },
        body: {},
      });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        ok: false,
        error: {
          code: "ODT_HOST_BRIDGE_ERROR",
          message: expect.stringContaining("BigInt"),
        },
      });
    } finally {
      await Effect.runPromise(bridge.close());
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("includes JSON-serializable error details in bridge responses", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "openducktor-mcp-discovery-"));
    const bridge = createMcpHostBridgeServer({
      discoveryPath: path.join(tempDir, "runtime", "mcp-bridge.json"),
      token: "token-1",
      workspaceSettingsService: createWorkspaceSettingsService(),
      bridgeService: createBridgeService({
        ready() {
          return Effect.fail(
            new HostOperationError({
              operation: "test.effect",
              message: "Bridge operation failed.",
              details: { taskId: "task-1", retryable: false, context: { attempt: 2 } },
            }),
          );
        },
        getWorkspaces() {
          return Effect.succeed({ workspaces: [] });
        },
        invoke() {
          return Effect.dieMessage("unexpected scoped tool invocation");
        },
      }),
    });

    try {
      const connection = await Effect.runPromise(bridge.ensureConnection({ repoPath: "/repo" }));
      const response = await requestJson(`${connection.hostUrl}/invoke/odt_mcp_ready`, {
        method: "POST",
        headers: { "x-openducktor-app-token": "token-1" },
        body: {},
      });

      expect(response).toEqual({
        status: 400,
        body: {
          ok: false,
          error: {
            code: "ODT_HOST_BRIDGE_ERROR",
            message: "Bridge operation failed.",
            details: { taskId: "task-1", retryable: false, context: { attempt: 2 } },
          },
        },
      });
    } finally {
      await Effect.runPromise(bridge.close());
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("omits cyclic error details while retaining the bridge error", async () => {
    const cyclicDetails = new CyclicDetails();
    const tempDir = await mkdtemp(path.join(tmpdir(), "openducktor-mcp-discovery-"));
    const bridge = createMcpHostBridgeServer({
      discoveryPath: path.join(tempDir, "runtime", "mcp-bridge.json"),
      token: "token-1",
      workspaceSettingsService: createWorkspaceSettingsService(),
      bridgeService: createBridgeService({
        ready() {
          return Effect.fail(
            new HostOperationError({
              operation: "test.effect",
              message: "Bridge operation failed.",
              details: { cyclicDetails },
            }),
          );
        },
        getWorkspaces() {
          return Effect.succeed({ workspaces: [] });
        },
        invoke() {
          return Effect.dieMessage("unexpected scoped tool invocation");
        },
      }),
    });

    try {
      const connection = await Effect.runPromise(bridge.ensureConnection({ repoPath: "/repo" }));
      const response = await requestJson(`${connection.hostUrl}/invoke/odt_mcp_ready`, {
        method: "POST",
        headers: { "x-openducktor-app-token": "token-1" },
        body: {},
      });

      expect(response).toEqual({
        status: 400,
        body: {
          ok: false,
          error: {
            code: "ODT_HOST_BRIDGE_ERROR",
            message: "Bridge operation failed.",
          },
        },
      });
    } finally {
      await Effect.runPromise(bridge.close());
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("deduplicates concurrent startup requests", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "openducktor-mcp-discovery-"));
    const discoveryPath = path.join(tempDir, "runtime", "mcp-bridge.json");
    const bridge = createMcpHostBridgeServer({
      discoveryPath,
      token: "token-1",
      workspaceSettingsService: createWorkspaceSettingsService(),
      bridgeService: {
        ready() {
          return Effect.succeed({ bridgeVersion: 1, toolNames: [...ODT_MCP_TOOL_NAMES] });
        },
        getWorkspaces() {
          return Effect.succeed({ workspaces: [] });
        },
        invoke() {
          return Effect.dieMessage("unexpected scoped tool invocation");
        },
      },
    });

    try {
      const connections = await Promise.all(
        Array.from({ length: 8 }, () =>
          Effect.runPromise(bridge.ensureConnection({ repoPath: "/repo" })),
        ),
      );
      const [firstConnection] = connections;
      if (!firstConnection) {
        throw new Error("Expected at least one MCP bridge connection.");
      }
      const hostUrls = new Set(connections.map((connection) => connection.hostUrl));

      expect(hostUrls.size).toBe(1);
      expect(connections).toEqual(
        Array.from({ length: 8 }, () => ({
          workspaceId: "repo",
          hostToken: "token-1",
          hostUrl: firstConnection.hostUrl,
        })),
      );

      const published: {
        hostToken: string;
        hostUrl: string;
        pid: number;
      } = JSON.parse(await readFile(discoveryPath, "utf8"));
      expect(published).toEqual({
        hostToken: "token-1",
        hostUrl: firstConnection.hostUrl,
        pid: process.pid,
      });
    } finally {
      await Effect.runPromise(bridge.close());
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
      bridgeService: createBridgeService({
        ready() {
          return Effect.tryPromise({
            try: async () => {
              return { bridgeVersion: 1, toolNames: [...ODT_MCP_TOOL_NAMES] };
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          });
        },
        getWorkspaces() {
          return Effect.tryPromise({
            try: async () => {
              return { workspaces: [] };
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          });
        },
        invoke(toolName, input) {
          return Effect.tryPromise({
            try: async () => {
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
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          });
        },
      }),
    });
    try {
      const connection = await Effect.runPromise(bridge.ensureConnection({ repoPath: "/repo" }));
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
      await Effect.runPromise(bridge.close());
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("preserves coded business errors from workspace-scoped commands", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "openducktor-mcp-discovery-"));
    const bridge = createMcpHostBridgeServer({
      discoveryPath: path.join(tempDir, "runtime", "mcp-bridge.json"),
      token: "token-1",
      workspaceSettingsService: createWorkspaceSettingsService(),
      bridgeService: createBridgeService({
        ready() {
          return Effect.succeed({ bridgeVersion: 1, toolNames: [...ODT_MCP_TOOL_NAMES] });
        },
        getWorkspaces() {
          return Effect.succeed({ workspaces: [] });
        },
        invoke() {
          return Effect.fail(
            TaskPolicyError.transitionNotAllowed(
              "Transition not allowed for task-1 (bug): human_review -> blocked",
              { reason: "needs a product decision", taskId: "task-1" },
            ),
          );
        },
      }),
    });
    try {
      const connection = await Effect.runPromise(bridge.ensureConnection({ repoPath: "/repo" }));
      const response = await requestJson(`${connection.hostUrl}/invoke/odt_build_blocked`, {
        method: "POST",
        headers: {
          "x-openducktor-app-token": "token-1",
        },
        body: { workspaceId: "repo", taskId: "task-1", reason: "needs a product decision" },
      });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        ok: false,
        error: {
          code: "TASK_TRANSITION_NOT_ALLOWED",
          message: "Transition not allowed for task-1 (bug): human_review -> blocked",
          details: { reason: "needs a product decision", taskId: "task-1" },
        },
      });
    } finally {
      await Effect.runPromise(bridge.close());
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});

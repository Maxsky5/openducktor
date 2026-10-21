import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { request } from "node:http";

import { tmpdir } from "node:os";

import path from "node:path";

import {
  type HostMcpBridgeStatus,
  ODT_MCP_TOOL_NAMES,
  type RepoConfig,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { BrowserServiceError } from "../../application/browser/browser-service-error";
import type { OdtMcpBridgeService } from "../../application/mcp/odt-mcp-bridge-service";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";
import { TaskPolicyError } from "../../domain/task";
import { HostOperationError } from "../../effect/host-errors";
import { createWorkspaceSettingsServiceTestDouble } from "../../test-support/service-test-doubles";
import { createMcpHostBridgeServer } from "./mcp-host-bridge-server";

const repoConfig: RepoConfig = {
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {},
  hooks: { postComplete: [] },
  actions: { items: [], defaultActionId: null },
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentDefaults: {},
  agentStudioState: { openTaskIds: [] },
};
const unexpectedBrowserTool: OdtMcpBridgeService["invokeBrowserTool"] = () =>
  Effect.die(new Error("unexpected browser tool invocation"));
const unexpectedTaskTool: OdtMcpBridgeService["invoke"] = () =>
  Effect.die(new Error("unexpected scoped tool invocation"));
const BROWSER_TAB_ID = "6f1c2a8e-3b4d-4e5f-9a6b-7c8d9e0f1a2b";
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
    const headers: Record<string, string> = {};
    if (body) {
      headers["Content-Type"] = "application/json";
    }
    if (options.headers) {
      Object.assign(headers, options.headers);
    }
    const req = request(
      url,
      {
        method: options.method ?? "GET",
        headers,
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
      onStatusChanged: () => {},
      bridgeService: {
        invokeBrowserTool: unexpectedBrowserTool,
        ready() {
          return Effect.sync(() => {
            return { bridgeVersion: 1, toolNames: [...ODT_MCP_TOOL_NAMES] };
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
      } satisfies OdtMcpBridgeService,
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
      onStatusChanged: () => {},
      bridgeService: {
        invokeBrowserTool: unexpectedBrowserTool,
        ready() {
          return Effect.sync(() => {
            return { bridgeVersion: 1, toolNames: [...ODT_MCP_TOOL_NAMES] };
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
      } satisfies OdtMcpBridgeService,
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

  test("includes JSON-serializable error details in bridge responses", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "openducktor-mcp-discovery-"));
    const bridge = createMcpHostBridgeServer({
      discoveryPath: path.join(tempDir, "runtime", "mcp-bridge.json"),
      token: "token-1",
      workspaceSettingsService: createWorkspaceSettingsService(),
      onStatusChanged: () => {},
      bridgeService: {
        invokeBrowserTool: unexpectedBrowserTool,
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
          return Effect.die(new Error("unexpected scoped tool invocation"));
        },
      } satisfies OdtMcpBridgeService,
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

  test("reports starting, then ready, and publishes each change", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "openducktor-mcp-discovery-"));
    const published: HostMcpBridgeStatus[] = [];
    const bridge = createMcpHostBridgeServer({
      discoveryPath: path.join(tempDir, "runtime", "mcp-bridge.json"),
      token: "token-1",
      workspaceSettingsService: createWorkspaceSettingsService(),
      onStatusChanged: (status) => published.push(status),
      bridgeService: {
        invokeBrowserTool: unexpectedBrowserTool,
        ready() {
          return Effect.succeed({ bridgeVersion: 1, toolNames: [...ODT_MCP_TOOL_NAMES] });
        },
        getWorkspaces() {
          return Effect.succeed({ workspaces: [] });
        },
        invoke() {
          return Effect.die(new Error("unexpected scoped tool invocation"));
        },
      } satisfies OdtMcpBridgeService,
    });

    try {
      expect(bridge.status()).toMatchObject({ state: "starting", hostUrl: null, revision: 0 });
      expect(published).toEqual([]);

      const connection = await Effect.runPromise(bridge.ensureConnection({ repoPath: "/repo" }));

      expect(bridge.status()).toMatchObject({
        state: "ready",
        hostUrl: connection.hostUrl,
        failure: null,
        revision: 1,
      });
      expect(published).toEqual([bridge.status()]);
    } finally {
      await Effect.runPromise(bridge.close());
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("keeps a failed startup visible and does not retry it", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "openducktor-mcp-discovery-"));
    // A file where the discovery directory must be makes the discovery write fail.
    await writeFile(path.join(tempDir, "runtime"), "");
    const bridge = createMcpHostBridgeServer({
      discoveryPath: path.join(tempDir, "runtime", "mcp-bridge.json"),
      token: "token-1",
      workspaceSettingsService: createWorkspaceSettingsService(),
      onStatusChanged: () => {},
      bridgeService: {
        invokeBrowserTool: unexpectedBrowserTool,
        ready() {
          return Effect.succeed({ bridgeVersion: 1, toolNames: [...ODT_MCP_TOOL_NAMES] });
        },
        getWorkspaces() {
          return Effect.succeed({ workspaces: [] });
        },
        invoke() {
          return Effect.die(new Error("unexpected scoped tool invocation"));
        },
      },
    });

    try {
      const startup = await Effect.runPromise(Effect.flip(bridge.ensureExternalDiscoveryReady()));
      await rm(path.join(tempDir, "runtime"));

      const connection = await Effect.runPromise(
        Effect.flip(bridge.ensureConnection({ repoPath: "/repo" })),
      );
      expect(connection.message).toBe(
        `The OpenDucktor MCP host bridge did not start: ${startup.message} Fix the cause, then restart OpenDucktor.`,
      );
      expect(bridge.status()).toMatchObject({
        state: "failed",
        hostUrl: null,
        failure: connection.message,
        revision: 1,
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
      onStatusChanged: () => {},
      bridgeService: {
        invokeBrowserTool: unexpectedBrowserTool,
        ready() {
          return Effect.succeed({ bridgeVersion: 1, toolNames: [...ODT_MCP_TOOL_NAMES] });
        },
        getWorkspaces() {
          return Effect.succeed({ workspaces: [] });
        },
        invoke() {
          return Effect.die(new Error("unexpected scoped tool invocation"));
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
      onStatusChanged: () => {},
      bridgeService: {
        invokeBrowserTool: unexpectedBrowserTool,
        ready() {
          return Effect.sync(() => {
            return { bridgeVersion: 1, toolNames: [...ODT_MCP_TOOL_NAMES] };
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
          return Effect.sync(() => {
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
          });
        },
      } satisfies OdtMcpBridgeService,
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
      onStatusChanged: () => {},
      bridgeService: {
        invokeBrowserTool: unexpectedBrowserTool,
        ready() {
          return Effect.succeed({ bridgeVersion: 1, toolNames: [...ODT_MCP_TOOL_NAMES] });
        },
        getWorkspaces() {
          return Effect.succeed({ workspaces: [] });
        },
        invoke() {
          return Effect.fail(
            TaskPolicyError.transitionNotAllowed(
              "Transition not allowed for task-1 (bug): closed -> blocked",
              { reason: "needs a product decision", taskId: "task-1" },
            ),
          );
        },
      } satisfies OdtMcpBridgeService,
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
          message: "Transition not allowed for task-1 (bug): closed -> blocked",
          details: { reason: "needs a product decision", taskId: "task-1" },
        },
      });
    } finally {
      await Effect.runPromise(bridge.close());
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("routes browser tools with their caller to the browser branch", async () => {
    const calls: unknown[] = [];
    const tempDir = await mkdtemp(path.join(tmpdir(), "openducktor-mcp-discovery-"));
    const bridge = createMcpHostBridgeServer({
      discoveryPath: path.join(tempDir, "runtime", "mcp-bridge.json"),
      token: "token-1",
      workspaceSettingsService: createWorkspaceSettingsService(),
      onStatusChanged: () => {},
      bridgeService: {
        ready: () => Effect.succeed({ bridgeVersion: 1, toolNames: [...ODT_MCP_TOOL_NAMES] }),
        getWorkspaces: () => Effect.succeed({ workspaces: [] }),
        invoke: unexpectedTaskTool,
        invokeBrowserTool(toolName, input) {
          return Effect.sync(() => {
            calls.push({ toolName, input });
            return { content: [{ type: "text" as const, text: "Clicked e12" }] };
          });
        },
      } satisfies OdtMcpBridgeService,
    });
    const body = {
      tabId: BROWSER_TAB_ID,
      ref: "e12",
      workspaceId: "repo",
      caller: { runtime: "opencode", runtimeSessionId: "ses_1" },
    };
    try {
      const connection = await Effect.runPromise(bridge.ensureConnection({ repoPath: "/repo" }));
      const response = await requestJson(`${connection.hostUrl}/invoke/odt_browser_click`, {
        method: "POST",
        headers: { "x-openducktor-app-token": "token-1" },
        body,
      });

      expect(response).toEqual({
        status: 200,
        body: { content: [{ type: "text", text: "Clicked e12" }] },
      });
      expect(calls).toEqual([{ toolName: "odt_browser_click", input: body }]);
    } finally {
      await Effect.runPromise(bridge.close());
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("returns browser failures with their message and failure code", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "openducktor-mcp-discovery-"));
    const bridge = createMcpHostBridgeServer({
      discoveryPath: path.join(tempDir, "runtime", "mcp-bridge.json"),
      token: "token-1",
      workspaceSettingsService: createWorkspaceSettingsService(),
      onStatusChanged: () => {},
      bridgeService: {
        ready: () => Effect.succeed({ bridgeVersion: 1, toolNames: [...ODT_MCP_TOOL_NAMES] }),
        getWorkspaces: () => Effect.succeed({ workspaces: [] }),
        invoke: unexpectedTaskTool,
        invokeBrowserTool: () =>
          Effect.fail(
            new BrowserServiceError({
              code: "browser_not_shared",
              operation: "browser.runAgentTool",
              message: "The user stopped sharing this tab. Ask the user to share it again.",
              tabId: BROWSER_TAB_ID,
            }),
          ),
      } satisfies OdtMcpBridgeService,
    });
    try {
      const connection = await Effect.runPromise(bridge.ensureConnection({ repoPath: "/repo" }));
      const response = await requestJson(`${connection.hostUrl}/invoke/odt_browser_snapshot`, {
        method: "POST",
        headers: { "x-openducktor-app-token": "token-1" },
        body: {
          tabId: BROWSER_TAB_ID,
          workspaceId: "repo",
          caller: { runtime: "codex", runtimeSessionId: "thread-1" },
        },
      });

      expect(response).toEqual({
        status: 400,
        body: {
          ok: false,
          error: {
            code: "ODT_TOOL_EXECUTION_ERROR",
            message: "The user stopped sharing this tab. Ask the user to share it again.",
            details: {
              browserFailure: {
                code: "browser_not_shared",
                message: "The user stopped sharing this tab. Ask the user to share it again.",
                tabId: BROWSER_TAB_ID,
              },
            },
          },
        },
      });
    } finally {
      await Effect.runPromise(bridge.close());
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("stops the host work of a call when its client stops waiting", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "openducktor-mcp-discovery-"));
    const started = Promise.withResolvers<void>();
    const interrupted = Promise.withResolvers<void>();
    const bridge = createMcpHostBridgeServer({
      discoveryPath: path.join(tempDir, "runtime", "mcp-bridge.json"),
      token: "token-1",
      workspaceSettingsService: createWorkspaceSettingsService(),
      onStatusChanged: () => {},
      bridgeService: {
        ready: () => Effect.succeed({ bridgeVersion: 1, toolNames: [...ODT_MCP_TOOL_NAMES] }),
        getWorkspaces: () => Effect.succeed({ workspaces: [] }),
        invoke: unexpectedTaskTool,
        invokeBrowserTool: () =>
          Effect.sync(() => started.resolve()).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Effect.sync(() => interrupted.resolve())),
          ),
      } satisfies OdtMcpBridgeService,
    });
    try {
      const connection = await Effect.runPromise(bridge.ensureConnection({ repoPath: "/repo" }));
      const body = JSON.stringify({
        tabId: BROWSER_TAB_ID,
        workspaceId: "repo",
        caller: { runtime: "codex", runtimeSessionId: "thread-1" },
      });
      const client = request(`${connection.hostUrl}/invoke/odt_browser_snapshot`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-openducktor-app-token": "token-1" },
      });
      client.on("error", () => {});
      client.end(body);
      await started.promise;

      client.destroy();

      await interrupted.promise;
    } finally {
      await Effect.runPromise(bridge.close());
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});

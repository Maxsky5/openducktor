import { describe, expect, mock, test } from "bun:test";
import type {
  HostMcpBridgeCheck,
  RuntimeCheck,
  SystemCheck,
  TaskStoreCheck,
  WorkspaceRuntimeMcpCheck,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { RuntimeMcpDiagnosticsService } from "../../application/diagnostics/runtime-mcp-diagnostics-service";
import type { SystemDiagnosticsService } from "../../application/diagnostics/system-diagnostics-service";
import {
  type CreateHostCommandRouterInput,
  createEffectHostCommandRouter,
  toPromiseHostCommandRouter,
} from "../router/host-command-router";

import { createSystemDiagnosticsCommandHandlers } from "./system-diagnostics-command-handlers";

const createHostCommandRouter = (input: CreateHostCommandRouterInput) =>
  toPromiseHostCommandRouter(createEffectHostCommandRouter(input));

const runtimeCheckResult = {
  pathOk: true,
  gitOk: true,
  gitVersion: "2.50.0",
  runtimes: [],
  errors: [],
} satisfies RuntimeCheck;

const taskStoreCheckResult = {
  repoStoreHealth: {
    category: "healthy",
    status: "ready",
    isReady: true,
    detail: null,
    databasePath: "/repo/.openducktor/tasks.db",
  },
  taskStoreOk: true,
  taskStorePath: "/repo/.openducktor/tasks.db",
  taskStoreError: null,
} satisfies TaskStoreCheck;

const systemCheckResult = {
  ...runtimeCheckResult,
  ...taskStoreCheckResult,
} satisfies SystemCheck;

const hostBridgeCheckResult = {
  state: "ready",
  hostUrl: "http://127.0.0.1:4000",
  checkedAt: "2026-10-03T10:00:00.000Z",
  detail: null,
} satisfies HostMcpBridgeCheck;

const workspaceRuntimeMcpCheckResult = {
  repoPath: "/repo",
  checkedAt: "2026-10-03T10:00:00.000Z",
  runtimes: [
    {
      kind: "opencode",
      state: "not_checked",
      runtimeId: "runtime-1",
      observations: [],
      detail: null,
    },
  ],
} satisfies WorkspaceRuntimeMcpCheck;

const createDiagnosticsService = () => {
  const runtimeCheck = mock((_forceRefresh?: boolean) => Effect.succeed(runtimeCheckResult));
  const taskStoreCheck = mock((_repoPath: string) => Effect.succeed(taskStoreCheckResult));
  const systemCheck = mock((_repoPath: string) => Effect.succeed(systemCheckResult));
  const service = {
    runtimeCheck,
    taskStoreCheck,
    systemCheck,
  } satisfies SystemDiagnosticsService;
  const hostBridgeCheck = mock(() => Effect.succeed(hostBridgeCheckResult));
  const workspaceRuntimeMcpCheck = mock((_repoPath: string) =>
    Effect.succeed(workspaceRuntimeMcpCheckResult),
  );
  const mcpService = {
    hostBridgeCheck,
    workspaceRuntimeMcpCheck,
  } satisfies RuntimeMcpDiagnosticsService;
  return {
    runtimeCheck,
    service,
    mcpService,
    systemCheck,
    taskStoreCheck,
    hostBridgeCheck,
    workspaceRuntimeMcpCheck,
  };
};
describe("createSystemDiagnosticsCommandHandlers", () => {
  test("routes diagnostics commands to the service", async () => {
    const diagnostics = createDiagnosticsService();
    const router = createHostCommandRouter({
      handlers: createSystemDiagnosticsCommandHandlers(diagnostics.service, diagnostics.mcpService),
    });
    await expect(router.invoke("runtime_check", { force: true })).resolves.toEqual(
      runtimeCheckResult,
    );
    await expect(router.invoke("task_store_check", { repoPath: "/repo" })).resolves.toEqual(
      taskStoreCheckResult,
    );
    await expect(router.invoke("system_check", { repoPath: "/repo" })).resolves.toEqual(
      systemCheckResult,
    );
    expect(diagnostics.runtimeCheck).toHaveBeenCalledWith(true);
    expect(diagnostics.taskStoreCheck).toHaveBeenCalledWith("/repo");
    expect(diagnostics.systemCheck).toHaveBeenCalledWith("/repo");
  });
  test("routes MCP checks to the runtime MCP diagnostics service", async () => {
    const diagnostics = createDiagnosticsService();
    const router = createHostCommandRouter({
      handlers: createSystemDiagnosticsCommandHandlers(diagnostics.service, diagnostics.mcpService),
    });
    await expect(router.invoke("host_mcp_bridge_check")).resolves.toEqual(hostBridgeCheckResult);
    await expect(
      router.invoke("workspace_runtime_mcp_check", { repoPath: "/repo" }),
    ).resolves.toEqual(workspaceRuntimeMcpCheckResult);
    await expect(router.invoke("workspace_runtime_mcp_check", {})).rejects.toThrow(
      "repoPath is required.",
    );
    expect(diagnostics.hostBridgeCheck).toHaveBeenCalledTimes(1);
    expect(diagnostics.workspaceRuntimeMcpCheck).toHaveBeenCalledTimes(1);
    expect(diagnostics.workspaceRuntimeMcpCheck).toHaveBeenCalledWith("/repo");
  });
  test("requires repoPath for repo-scoped diagnostics", async () => {
    const diagnostics = createDiagnosticsService();
    const router = createHostCommandRouter({
      handlers: createSystemDiagnosticsCommandHandlers(diagnostics.service, diagnostics.mcpService),
    });
    await expect(router.invoke("task_store_check", {})).rejects.toThrow("repoPath is required.");
    await expect(router.invoke("system_check")).rejects.toThrow(
      "system_check input must be an object.",
    );
  });
});

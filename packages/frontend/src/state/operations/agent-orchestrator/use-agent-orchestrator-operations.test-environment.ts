import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { spyOn } from "bun:test";
import { clearAppQueryClient } from "@/lib/query-client";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { host } from "../shared/host";
import { createWorktreeRuntimeFixture } from "./use-agent-orchestrator-operations.test-fixtures";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
});

export const setupOrchestratorOperationsTestEnvironment = async () => {
  await clearAppQueryClient();
  const repoConfig: Awaited<ReturnType<typeof host.workspaceGetRepoConfig>> = {
    workspaceId: "repo",
    workspaceName: "Repo",
    repoPath: "/tmp/repo",
    defaultRuntimeKind: "opencode",
    branchPrefix: "odt",
    defaultTargetBranch: { remote: "origin", branch: "main" },
    git: {},
    hooks: { preStart: [], postComplete: [] },
    devServers: [],
    worktreeCopyPaths: [],
    promptOverrides: {},
    agentStudioState: { openTaskIds: [] },
    agentDefaults: {},
  };
  const runtimeEnsure: typeof host.runtimeEnsure = async (repoPath, runtimeKind) => ({
    kind: runtimeKind,
    runtimeId: "runtime-1",
    repoPath,
    taskId: null,
    role: "workspace",
    workingDirectory: repoPath,
    runtimeRoute: {
      type: "local_http",
      endpoint: "http://127.0.0.1:4444",
    },
    startedAt: "2026-02-22T08:00:00.000Z",
    descriptor: { ...OPENCODE_RUNTIME_DESCRIPTOR, kind: runtimeKind },
  });
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        taskWorktreeGet: async () => ({ workingDirectory: "/tmp/repo/worktree" }),
        workspaceGetRepoConfig: async () => repoConfig,
        workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
        runtimeList: async () => [createWorktreeRuntimeFixture()],
        runtimeEnsure,
        runtimeRequire: runtimeEnsure,
        taskSessionBootstrapPrepare: async (_repoPath, _taskId, role, runtimeKind) => ({
          bootstrapId: "bootstrap-1",
          role,
          runtimeKind,
          workingDirectory: "/tmp/repo/worktree",
        }),
        taskSessionBootstrapComplete: async () => undefined,
        taskSessionBootstrapAbort: async () => undefined,
      },
    }),
  );
  const spies = [
    spyOn(OpencodeSdkAdapter.prototype, "loadSessionHistory").mockResolvedValue([]),
    spyOn(OpencodeSdkAdapter.prototype, "loadSessionTodos").mockResolvedValue([]),
  ];

  return () => {
    for (const spy of spies) spy.mockRestore();
    configureShellBridge(createUnavailableShellBridge());
  };
};

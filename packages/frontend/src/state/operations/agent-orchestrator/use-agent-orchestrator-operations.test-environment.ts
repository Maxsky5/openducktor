import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import { spyOn } from "bun:test";
import { clearAppQueryClient } from "@/lib/query-client";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { host } from "../shared/host";

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
    branchPrefix: "odt",
    defaultTargetBranch: { remote: "origin", branch: "main" },
    git: {},
    hooks: { postComplete: [] },
    actions: { items: [], defaultActionId: null },
    worktreeCopyPaths: [],
    promptOverrides: {},
    agentStudioState: { openTaskIds: [] },
    agentDefaults: {},
  };
  configureShellBridge(
    createShellBridgeFixture({
      bridge: { subscribeWorkspaceSessionUpdates: async () => () => {} },
      client: {
        workspaceSessionListActive: async () => [],
        taskWorktreeGet: async () => ({ workingDirectory: "/tmp/repo/worktree" }),
        workspaceGetRepoConfig: async () => repoConfig,
        workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
        agentSessionWorkflowStart: async (input) => ({
          externalSessionId: "session-1",
          runtimeKind: input.runtimeKind,
          workingDirectory: "/tmp/repo/worktree",
          startedAt: "2026-02-22T08:00:00.000Z",
          status: "idle",
        }),
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

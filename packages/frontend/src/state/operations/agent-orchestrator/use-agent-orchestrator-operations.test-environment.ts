import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { clearAppQueryClient } from "@/lib/query-client";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { host } from "../shared/host";
import { createWorktreeRuntimeFixture } from "./use-agent-orchestrator-operations.test-fixtures";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export const setupOrchestratorOperationsTestEnvironment = async () => {
  const originalAgentSessionsListForTasks = host.agentSessionsListForTasks;
  const originalWorkspaceGetRepoConfig = host.workspaceGetRepoConfig;
  const originalBuildContinuationTargetGet = host.taskWorktreeGet;
  const originalWorkspaceGetSettingsSnapshot = host.workspaceGetSettingsSnapshot;
  const originalRuntimeList = host.runtimeList;
  const originalRuntimeEnsure = host.runtimeEnsure;
  const originalRuntimeRequire = host.runtimeRequire;
  const originalTaskSessionBootstrapPrepare = host.taskSessionBootstrapPrepare;
  const originalTaskSessionBootstrapComplete = host.taskSessionBootstrapComplete;
  const originalTaskSessionBootstrapAbort = host.taskSessionBootstrapAbort;
  const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;
  const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;

  await clearAppQueryClient();
  host.agentSessionsListForTasks = async (repoPath, taskIds) =>
    Promise.all(
      taskIds.map(async (taskId) => ({
        taskId,
        agentSessions: await host.agentSessionsList(repoPath, taskId),
      })),
    );
  host.taskWorktreeGet = async () => ({
    workingDirectory: "/tmp/repo/worktree",
  });
  host.workspaceGetRepoConfig = async () =>
    ({
      workspaceId: "repo",
      workspaceName: "Repo",
      repoPath: "/tmp/repo",
      defaultRuntimeKind: "opencode",
      branchPrefix: "odt",
      defaultTargetBranch: { remote: "origin", branch: "main" },
      git: { providers: {} },
      hooks: { preStart: [], postComplete: [] },
      devServers: [],
      worktreeCopyPaths: [],
      promptOverrides: {},
      agentDefaults: {},
    }) as Awaited<ReturnType<typeof host.workspaceGetRepoConfig>>;
  host.workspaceGetSettingsSnapshot = async () => createSettingsSnapshotFixture();
  host.runtimeList = async () => [createWorktreeRuntimeFixture()];
  host.runtimeEnsure = async (repoPath, runtimeKind) => ({
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
    descriptor: {
      ...OPENCODE_RUNTIME_DESCRIPTOR,
      kind: runtimeKind,
    },
  });
  host.runtimeRequire = host.runtimeEnsure;
  host.taskSessionBootstrapPrepare = async (_repoPath, _taskId, role, runtimeKind) => ({
    bootstrapId: "bootstrap-1",
    role,
    runtimeKind,
    workingDirectory: "/tmp/repo/worktree",
  });
  host.taskSessionBootstrapComplete = async () => undefined;
  host.taskSessionBootstrapAbort = async () => undefined;
  OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [];
  OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];

  return () => {
    host.agentSessionsListForTasks = originalAgentSessionsListForTasks;
    host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;
    host.taskWorktreeGet = originalBuildContinuationTargetGet;
    host.workspaceGetSettingsSnapshot = originalWorkspaceGetSettingsSnapshot;
    host.runtimeList = originalRuntimeList;
    host.runtimeEnsure = originalRuntimeEnsure;
    host.runtimeRequire = originalRuntimeRequire;
    host.taskSessionBootstrapPrepare = originalTaskSessionBootstrapPrepare;
    host.taskSessionBootstrapComplete = originalTaskSessionBootstrapComplete;
    host.taskSessionBootstrapAbort = originalTaskSessionBootstrapAbort;
    OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
    OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
  };
};

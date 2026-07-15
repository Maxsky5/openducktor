import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { clearAppQueryClient } from "@/lib/query-client";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { host } from "../shared/host";
import { createAgentSessionRuntimeSnapshotFixture } from "./test-utils";
import { createWorktreeRuntimeFixture } from "./use-agent-orchestrator-operations.test-fixtures";

export type ReadSessionRuntimeSnapshotInput = Parameters<
  NonNullable<AgentEnginePort["readSessionRuntimeSnapshot"]>
>[0];

export type OpencodeSdkAdapterPrototype = Pick<
  OpencodeSdkAdapter,
  "listSessionRuntimeSnapshots" | "readSessionRuntimeSnapshot"
>;

export const opencodeSdkAdapterPrototype =
  OpencodeSdkAdapter.prototype as OpencodeSdkAdapterPrototype;

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
  const originalListSessionRuntimeSnapshots =
    OpencodeSdkAdapter.prototype.listSessionRuntimeSnapshots;
  const originalReadAgentSessionRuntimeSnapshot =
    OpencodeSdkAdapter.prototype.readSessionRuntimeSnapshot;
  const originalSubscribeEvents = OpencodeSdkAdapter.prototype.subscribeEvents;
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
  opencodeSdkAdapterPrototype.listSessionRuntimeSnapshots = async () => [
    createAgentSessionRuntimeSnapshotFixture(),
  ];
  opencodeSdkAdapterPrototype.readSessionRuntimeSnapshot = async (
    input: ReadSessionRuntimeSnapshotInput,
  ): ReturnType<NonNullable<OpencodeSdkAdapterPrototype["readSessionRuntimeSnapshot"]>> => {
    const snapshots = await opencodeSdkAdapterPrototype.listSessionRuntimeSnapshots({
      repoPath: input.repoPath ?? "/tmp/repo",
      runtimeKind: input.runtimeKind ?? "opencode",
      directories: [input.workingDirectory ?? "/tmp/repo/worktree"],
    });
    const match = snapshots.find(
      (snapshot: ReturnType<typeof createAgentSessionRuntimeSnapshotFixture>) =>
        snapshot.ref.externalSessionId === input.externalSessionId,
    );
    if (match) {
      return match;
    }
    return createAgentSessionRuntimeSnapshotFixture({
      ref: {
        repoPath: input.repoPath ?? "/tmp/repo",
        runtimeKind: input.runtimeKind ?? "opencode",
        workingDirectory: input.workingDirectory ?? "/tmp/repo/worktree",
        externalSessionId: input.externalSessionId,
      },
    });
  };
  OpencodeSdkAdapter.prototype.subscribeEvents = async () => () => {};
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
    opencodeSdkAdapterPrototype.listSessionRuntimeSnapshots = originalListSessionRuntimeSnapshots;
    opencodeSdkAdapterPrototype.readSessionRuntimeSnapshot =
      originalReadAgentSessionRuntimeSnapshot;
    OpencodeSdkAdapter.prototype.subscribeEvents = originalSubscribeEvents;
    OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
    OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
  };
};

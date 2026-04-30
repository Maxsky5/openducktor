import type { RuntimeInfo } from "../runtime/runtime";
import type { StartSessionDependencies } from "./start-session";

const ensureRuntimeWithKind = async (
  ...args: Parameters<StartSessionDependencies["runtime"]["ensureRuntime"]>
): Promise<RuntimeInfo> => {
  const [, , , options] = args;
  const runtimeKind = options?.runtimeKind ?? "opencode";
  const workingDirectory = options?.targetWorkingDirectory ?? "/tmp/repo";

  return {
    kind: runtimeKind,
    runtimeKind,
    runtimeId: "runtime-1",
    workingDirectory,
  };
};

const withRuntimeKind = async (
  ensureRuntime: StartSessionDependencies["runtime"]["ensureRuntime"],
  ...args: Parameters<StartSessionDependencies["runtime"]["ensureRuntime"]>
): Promise<RuntimeInfo> => {
  const [, , , options] = args;
  const runtime = await ensureRuntime(...args);
  const runtimeKind = runtime.runtimeKind ?? options?.runtimeKind ?? runtime.kind;

  return runtimeKind ? { ...runtime, runtimeKind } : runtime;
};

export type FlatStartSessionDependencies = Omit<
  StartSessionDependencies["repo"],
  "activeWorkspaceRef" | "activeWorkspace"
> & {
  activeWorkspaceRef?: {
    current: { repoPath: string; workspaceId: string; workspaceName: string } | null;
  };
  activeRepo?: string | null;
  activeWorkspaceId?: string | null;
  loadRepoDefaultModel?: unknown;
} & StartSessionDependencies["session"] &
  Omit<StartSessionDependencies["runtime"], "resolveTaskWorktree"> &
  Partial<Pick<StartSessionDependencies["runtime"], "resolveTaskWorktree">> &
  StartSessionDependencies["task"] &
  StartSessionDependencies["model"];

export const toStartSessionDependencies = (
  deps: FlatStartSessionDependencies,
): StartSessionDependencies => {
  return {
    repo: {
      activeWorkspace:
        deps.activeRepo == null
          ? null
          : {
              repoPath: deps.activeRepo,
              workspaceId: deps.activeWorkspaceId ?? "workspace-1",
              workspaceName: "Active Workspace",
            },
      repoEpochRef: deps.repoEpochRef,
      currentWorkspaceRepoPathRef: deps.currentWorkspaceRepoPathRef,
      ...(deps.activeWorkspaceRef ? { activeWorkspaceRef: deps.activeWorkspaceRef } : {}),
    },
    session: {
      setSessionsById: deps.setSessionsById,
      sessionsRef: deps.sessionsRef,
      inFlightStartsByWorkspaceTaskRef: deps.inFlightStartsByWorkspaceTaskRef,
      loadAgentSessions: deps.loadAgentSessions,
      persistSessionRecord: deps.persistSessionRecord,
      attachSessionListener: deps.attachSessionListener,
    },
    runtime: {
      adapter: deps.adapter,
      resolveTaskWorktree:
        deps.resolveTaskWorktree ??
        (async () => ({
          workingDirectory: "/tmp/repo/worktree",
          source: "active_build_run",
        })),
      ensureRuntime: (...args) =>
        withRuntimeKind(deps.ensureRuntime ?? ensureRuntimeWithKind, ...args),
    },
    task: {
      taskRef: deps.taskRef,
      loadTaskDocuments: deps.loadTaskDocuments,
      refreshTaskData: deps.refreshTaskData,
      sendAgentMessage: deps.sendAgentMessage,
    },
    model: {
      loadRepoPromptOverrides: deps.loadRepoPromptOverrides,
      ...(deps.loadRepoDefaultTargetBranch
        ? { loadRepoDefaultTargetBranch: deps.loadRepoDefaultTargetBranch }
        : {}),
    },
  };
};

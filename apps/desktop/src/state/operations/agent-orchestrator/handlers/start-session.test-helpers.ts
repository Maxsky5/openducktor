import type { StartSessionDependencies } from "./start-session";

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
  Omit<StartSessionDependencies["runtime"], "resolveBuildContinuationTarget"> &
  Partial<Pick<StartSessionDependencies["runtime"], "resolveBuildContinuationTarget">> &
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
      resolveBuildContinuationTarget:
        deps.resolveBuildContinuationTarget ??
        (async () => ({
          workingDirectory: "/tmp/repo/worktree",
          source: "active_build_run",
        })),
      ensureRuntime: deps.ensureRuntime,
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

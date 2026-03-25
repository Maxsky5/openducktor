import type { StartSessionDependencies } from "./start-session";

export type FlatStartSessionDependencies = Omit<
  StartSessionDependencies["repo"],
  "activeRepoRef"
> & {
  activeRepoRef?: { current: string | null };
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
      activeRepo: deps.activeRepo,
      repoEpochRef: deps.repoEpochRef,
      previousRepoRef: deps.previousRepoRef,
      ...(deps.activeRepoRef ? { activeRepoRef: deps.activeRepoRef } : {}),
    },
    session: {
      setSessionsById: deps.setSessionsById,
      sessionsRef: deps.sessionsRef,
      inFlightStartsByRepoTaskRef: deps.inFlightStartsByRepoTaskRef,
      loadAgentSessions: deps.loadAgentSessions,
      persistSessionRecord: deps.persistSessionRecord,
      attachSessionListener: deps.attachSessionListener,
    },
    runtime: {
      adapter: deps.adapter,
      resolveBuildContinuationTarget:
        deps.resolveBuildContinuationTarget ?? (async () => "/tmp/repo/worktree"),
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
    },
  };
};

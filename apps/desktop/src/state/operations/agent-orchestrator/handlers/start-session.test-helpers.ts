import type { StartSessionDependencies } from "./start-session";

export type FlatStartSessionDependencies = StartSessionDependencies["repo"] &
  StartSessionDependencies["session"] &
  Omit<StartSessionDependencies["runtime"], "resolveQaReviewTarget"> &
  Partial<Pick<StartSessionDependencies["runtime"], "resolveQaReviewTarget">> &
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
    },
    session: {
      setSessionsById: deps.setSessionsById,
      sessionsRef: deps.sessionsRef,
      inFlightStartsByRepoTaskRef: deps.inFlightStartsByRepoTaskRef,
      loadAgentSessions: deps.loadAgentSessions,
      persistSessionSnapshot: deps.persistSessionSnapshot,
      attachSessionListener: deps.attachSessionListener,
    },
    runtime: {
      adapter: deps.adapter,
      resolveQaReviewTarget: deps.resolveQaReviewTarget ?? (async () => "/tmp/repo/worktree"),
      ensureRuntime: deps.ensureRuntime,
    },
    task: {
      taskRef: deps.taskRef,
      loadTaskDocuments: deps.loadTaskDocuments,
      refreshTaskData: deps.refreshTaskData,
      sendAgentMessage: deps.sendAgentMessage,
    },
    model: {
      loadRepoDefaultModel: deps.loadRepoDefaultModel,
      loadRepoPromptOverrides: deps.loadRepoPromptOverrides,
      loadSessionTodos: deps.loadSessionTodos,
      loadSessionModelCatalog: deps.loadSessionModelCatalog,
    },
  };
};

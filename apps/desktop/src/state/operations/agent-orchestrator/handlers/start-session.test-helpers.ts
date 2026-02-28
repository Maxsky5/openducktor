import type { StartSessionDependencies } from "./start-session";

export type FlatStartSessionDependencies = StartSessionDependencies["repo"] &
  StartSessionDependencies["session"] &
  StartSessionDependencies["runtime"] &
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
      loadSessionTodos: deps.loadSessionTodos,
      loadSessionModelCatalog: deps.loadSessionModelCatalog,
    },
  };
};

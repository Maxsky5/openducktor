import type {
  AgentModelCatalog,
  AgentRuntimeConnection,
  AgentSessionTodoItem,
} from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  SESSION_MODEL_CATALOG_STALE_TIME_MS,
  SESSION_TODOS_STALE_TIME_MS,
  sessionModelCatalogQueryOptions,
  sessionTodosQueryOptions,
} from "@/state/queries/agent-session-runtime";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  hasAttachedSessionRuntime,
  toAttachedSessionRuntimeConnection,
} from "./agent-studio-session-runtime";
import type { AgentStudioReadinessState } from "./agent-studio-task-hydration-state";

type UseAgentStudioActiveSessionRuntimeDataArgs = {
  session: AgentSessionState | null;
  agentStudioReadinessState: AgentStudioReadinessState;
  readSessionModelCatalog: (
    runtimeKind: NonNullable<AgentSessionState["runtimeKind"]>,
    runtimeConnection: AgentRuntimeConnection,
  ) => Promise<AgentModelCatalog>;
  readSessionTodos: (
    runtimeKind: NonNullable<AgentSessionState["runtimeKind"]>,
    runtimeConnection: AgentRuntimeConnection,
    externalSessionId: string,
  ) => Promise<AgentSessionTodoItem[]>;
};

const toRuntimeQueryInput = (session: AgentSessionState | null) => {
  const runtimeKind = session?.runtimeKind ?? session?.selectedModel?.runtimeKind;
  const hasRuntimeAttachment = hasAttachedSessionRuntime(session);
  const runtimeConnection = session ? toAttachedSessionRuntimeConnection(session) : null;
  if (!session || !runtimeKind || !hasRuntimeAttachment || runtimeConnection === null) {
    return null;
  }
  return {
    runtimeKind,
    runtimeConnection,
  };
};

export const useAgentStudioActiveSessionRuntimeData = ({
  session,
  agentStudioReadinessState,
  readSessionModelCatalog,
  readSessionTodos,
}: UseAgentStudioActiveSessionRuntimeDataArgs): AgentSessionState | null => {
  const runtimeQueryInput = toRuntimeQueryInput(session);
  const shouldHydrateRuntimeData =
    agentStudioReadinessState === "ready" &&
    runtimeQueryInput !== null &&
    session?.status !== "starting";
  const catalogQuery = useQuery({
    queryKey:
      shouldHydrateRuntimeData && runtimeQueryInput
        ? sessionModelCatalogQueryOptions(
            runtimeQueryInput.runtimeKind,
            runtimeQueryInput.runtimeConnection,
            readSessionModelCatalog,
          ).queryKey
        : (["agent-session-runtime", "model-catalog", "", "", ""] as const),
    queryFn: async (): Promise<AgentModelCatalog> => {
      if (!runtimeQueryInput) {
        throw new Error("Session runtime catalog query is disabled.");
      }
      return readSessionModelCatalog(
        runtimeQueryInput.runtimeKind,
        runtimeQueryInput.runtimeConnection,
      );
    },
    enabled: shouldHydrateRuntimeData,
    staleTime: SESSION_MODEL_CATALOG_STALE_TIME_MS,
  });
  const todosQuery = useQuery({
    queryKey:
      shouldHydrateRuntimeData && runtimeQueryInput && session
        ? sessionTodosQueryOptions(
            runtimeQueryInput.runtimeKind,
            runtimeQueryInput.runtimeConnection,
            session.externalSessionId,
            readSessionTodos,
          ).queryKey
        : (["agent-session-runtime", "todos", "", "", "", ""] as const),
    queryFn: async (): Promise<AgentSessionTodoItem[]> => {
      if (!runtimeQueryInput || !session) {
        throw new Error("Session todos query is disabled.");
      }
      return readSessionTodos(
        runtimeQueryInput.runtimeKind,
        runtimeQueryInput.runtimeConnection,
        session.externalSessionId,
      );
    },
    enabled: shouldHydrateRuntimeData && session !== null,
    staleTime: SESSION_TODOS_STALE_TIME_MS,
  });

  return useMemo(() => {
    if (!session) {
      return null;
    }

    const resolvedCatalog = session.modelCatalog ?? catalogQuery.data ?? null;
    const resolvedTodos = session.todos.length > 0 ? session.todos : (todosQuery.data ?? []);
    const isLoadingModelCatalog = shouldHydrateRuntimeData
      ? resolvedCatalog === null && catalogQuery.isPending
      : session.isLoadingModelCatalog && resolvedCatalog === null;

    if (
      resolvedCatalog === session.modelCatalog &&
      resolvedTodos === session.todos &&
      isLoadingModelCatalog === session.isLoadingModelCatalog
    ) {
      return session;
    }

    return {
      ...session,
      modelCatalog: resolvedCatalog,
      todos: resolvedTodos,
      isLoadingModelCatalog,
    };
  }, [
    catalogQuery.data,
    catalogQuery.isPending,
    session,
    shouldHydrateRuntimeData,
    todosQuery.data,
  ]);
};

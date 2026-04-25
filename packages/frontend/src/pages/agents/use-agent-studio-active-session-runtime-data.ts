import type {
  AgentModelCatalog,
  AgentRuntimeConnection,
  AgentSessionTodoItem,
} from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  type AgentSessionViewLifecyclePhase,
  deriveAgentSessionViewLifecycle,
} from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import {
  SESSION_MODEL_CATALOG_STALE_TIME_MS,
  SESSION_TODOS_STALE_TIME_MS,
  sessionModelCatalogQueryOptions,
  sessionTodosQueryOptions,
} from "@/state/queries/agent-session-runtime";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { resolveAttachedSessionRuntimeQueryState } from "./agent-studio-session-runtime";
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

export type AgentStudioSessionRuntimeDataState = {
  session: AgentSessionState | null;
  runtimeDataError: string | null;
  sessionViewLifecyclePhase: AgentSessionViewLifecyclePhase;
};

export const useAgentStudioActiveSessionRuntimeData = ({
  session,
  agentStudioReadinessState,
  readSessionModelCatalog,
  readSessionTodos,
}: UseAgentStudioActiveSessionRuntimeDataArgs): AgentStudioSessionRuntimeDataState => {
  const { runtimeQueryInput, runtimeQueryError: runtimeDataSupportError } = useMemo(
    () => resolveAttachedSessionRuntimeQueryState(session, "active session runtime data access"),
    [session],
  );
  const sessionViewLifecycle = useMemo(
    () =>
      deriveAgentSessionViewLifecycle({
        session,
        repoReadinessState: agentStudioReadinessState,
      }),
    [agentStudioReadinessState, session],
  );
  const shouldHydrateRuntimeData =
    sessionViewLifecycle.canReadRuntimeData &&
    runtimeQueryInput !== null &&
    runtimeDataSupportError === null &&
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
      return {
        session: null,
        runtimeDataError: null,
        sessionViewLifecyclePhase: sessionViewLifecycle.phase,
      };
    }

    const catalogQueryError =
      catalogQuery.error instanceof Error ? catalogQuery.error.message : null;
    const todosQueryError = todosQuery.error instanceof Error ? todosQuery.error.message : null;
    const runtimeDataQueryError = catalogQueryError ?? todosQueryError;
    const runtimeDataError = runtimeDataSupportError ?? runtimeDataQueryError;
    const resolvedCatalog = session.modelCatalog ?? catalogQuery.data ?? null;
    const resolvedTodos = session.todos.length > 0 ? session.todos : (todosQuery.data ?? []);
    const isLoadingModelCatalog =
      runtimeDataSupportError || catalogQueryError
        ? false
        : shouldHydrateRuntimeData
          ? resolvedCatalog === null && catalogQuery.isPending
          : session.isLoadingModelCatalog && resolvedCatalog === null;

    if (
      resolvedCatalog === session.modelCatalog &&
      resolvedTodos === session.todos &&
      isLoadingModelCatalog === session.isLoadingModelCatalog
    ) {
      return {
        session,
        runtimeDataError,
        sessionViewLifecyclePhase: sessionViewLifecycle.phase,
      };
    }

    return {
      session: {
        ...session,
        modelCatalog: resolvedCatalog,
        todos: resolvedTodos,
        isLoadingModelCatalog,
      },
      runtimeDataError,
      sessionViewLifecyclePhase: sessionViewLifecycle.phase,
    };
  }, [
    catalogQuery.data,
    catalogQuery.error,
    catalogQuery.isPending,
    session,
    shouldHydrateRuntimeData,
    todosQuery.data,
    todosQuery.error,
    runtimeDataSupportError,
    sessionViewLifecycle.phase,
  ]);
};

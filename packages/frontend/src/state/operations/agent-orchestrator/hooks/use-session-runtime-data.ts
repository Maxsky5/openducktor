import type { RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentSessionRef, AgentSessionTodoItem } from "@openducktor/core";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { SessionRepoReadinessState } from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import { deriveSessionRuntimeDataPlan } from "@/state/operations/agent-orchestrator/support/session-runtime-data-plan";
import {
  agentSessionRuntimeQueryKeys,
  SESSION_MODEL_CATALOG_STALE_TIME_MS,
  SESSION_TODOS_STALE_TIME_MS,
} from "@/state/queries/agent-session-runtime";
import type { AgentSessionState } from "@/types/agent-orchestrator";

type UseSessionRuntimeDataArgs = {
  repoPath: string | null;
  session: AgentSessionState | null;
  runtimeDefinitions: RuntimeDescriptor[];
  repoReadinessState: SessionRepoReadinessState;
  readSessionModelCatalog: (
    repoPath: string,
    runtimeKind: NonNullable<AgentSessionState["runtimeKind"]>,
  ) => Promise<AgentModelCatalog>;
  readSessionTodos: (session: AgentSessionRef) => Promise<AgentSessionTodoItem[]>;
};

export type SessionRuntimeDataState = {
  runtimeData: {
    modelCatalog: AgentModelCatalog | null;
    todos: AgentSessionTodoItem[];
    isLoadingModelCatalog: boolean;
  };
  runtimeDataError: string | null;
};

const emptyRuntimeData: SessionRuntimeDataState["runtimeData"] = Object.freeze({
  modelCatalog: null,
  todos: [],
  isLoadingModelCatalog: false,
});

export const useSessionRuntimeData = ({
  repoPath,
  session,
  runtimeDefinitions,
  repoReadinessState,
  readSessionModelCatalog,
  readSessionTodos,
}: UseSessionRuntimeDataArgs): SessionRuntimeDataState => {
  const runtimeDataPlan = useMemo(
    () =>
      deriveSessionRuntimeDataPlan({
        repoPath,
        session,
        runtimeDefinitions,
        repoReadinessState,
      }),
    [repoPath, repoReadinessState, runtimeDefinitions, session],
  );
  const runtimeRef = runtimeDataPlan.runtimeRef;
  const sessionRef = runtimeDataPlan.sessionRef;

  const catalogQuery = useQuery({
    queryKey: runtimeRef
      ? agentSessionRuntimeQueryKeys.modelCatalog(runtimeRef.repoPath, runtimeRef.runtimeKind)
      : agentSessionRuntimeQueryKeys.modelCatalogUnavailable(),
    queryFn: runtimeRef
      ? (): Promise<AgentModelCatalog> =>
          readSessionModelCatalog(runtimeRef.repoPath, runtimeRef.runtimeKind)
      : skipToken,
    enabled: runtimeDataPlan.canReadModelCatalog,
    staleTime: SESSION_MODEL_CATALOG_STALE_TIME_MS,
  });

  const todosQuery = useQuery({
    queryKey: sessionRef
      ? agentSessionRuntimeQueryKeys.todos(sessionRef)
      : agentSessionRuntimeQueryKeys.todosUnavailable(),
    queryFn: sessionRef
      ? (): Promise<AgentSessionTodoItem[]> => readSessionTodos(sessionRef)
      : skipToken,
    enabled: runtimeDataPlan.canReadTodos,
    staleTime: SESSION_TODOS_STALE_TIME_MS,
  });

  return useMemo(() => {
    if (!session) {
      return {
        runtimeData: emptyRuntimeData,
        runtimeDataError: null,
      };
    }

    const catalogQueryError =
      catalogQuery.error instanceof Error ? catalogQuery.error.message : null;
    const todosQueryError = todosQuery.error instanceof Error ? todosQuery.error.message : null;
    const runtimeDataQueryError = catalogQueryError ?? todosQueryError;
    const runtimeDataError = runtimeDataPlan.runtimeDataSupportError ?? runtimeDataQueryError;
    const resolvedCatalog = catalogQuery.data ?? null;
    const resolvedTodos = todosQuery.data ?? [];
    const isLoadingModelCatalog =
      runtimeDataPlan.runtimeDataSupportError || catalogQueryError
        ? false
        : runtimeDataPlan.canReadModelCatalog
          ? resolvedCatalog === null && catalogQuery.isPending
          : false;

    return {
      runtimeData: {
        modelCatalog: resolvedCatalog,
        todos: resolvedTodos,
        isLoadingModelCatalog,
      },
      runtimeDataError,
    };
  }, [
    catalogQuery.data,
    catalogQuery.error,
    catalogQuery.isPending,
    session,
    runtimeDataPlan.canReadModelCatalog,
    runtimeDataPlan.runtimeDataSupportError,
    todosQuery.data,
    todosQuery.error,
  ]);
};

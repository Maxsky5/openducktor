import type { RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentSessionRef, AgentSessionTodoItem } from "@openducktor/core";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { findRuntimeDefinition, runtimeSupportsCapability } from "@/lib/agent-runtime";
import { resolveRuntimeWorkingDirectoryRefState } from "@/state/operations/agent-orchestrator/support/session-runtime-ref";
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
  canReadRuntimeData: boolean;
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
  canReadRuntimeData,
  readSessionModelCatalog,
  readSessionTodos,
}: UseSessionRuntimeDataArgs): SessionRuntimeDataState => {
  const { runtimeRef, runtimeRefError: runtimeDataSupportError } = useMemo(
    () => resolveRuntimeWorkingDirectoryRefState({ repoPath, session }),
    [repoPath, session],
  );
  const canReadSessionRuntimeData =
    canReadRuntimeData &&
    runtimeRef !== null &&
    runtimeDataSupportError === null &&
    session?.status !== "starting";
  const runtimeDefinition = session?.runtimeKind
    ? findRuntimeDefinition(runtimeDefinitions, session.runtimeKind)
    : null;
  const supportsTodos = runtimeDefinition
    ? runtimeSupportsCapability(runtimeDefinition, "optionalSurfaces.supportsTodos")
    : false;
  const runtimeSessionRef =
    runtimeRef && session
      ? {
          ...runtimeRef,
          externalSessionId: session.externalSessionId,
        }
      : null;
  const shouldLoadTodos = canReadSessionRuntimeData && runtimeSessionRef !== null && supportsTodos;

  const catalogQuery = useQuery({
    queryKey: runtimeRef
      ? agentSessionRuntimeQueryKeys.modelCatalog(runtimeRef.repoPath, runtimeRef.runtimeKind)
      : agentSessionRuntimeQueryKeys.modelCatalogUnavailable(),
    queryFn: runtimeRef
      ? (): Promise<AgentModelCatalog> =>
          readSessionModelCatalog(runtimeRef.repoPath, runtimeRef.runtimeKind)
      : skipToken,
    enabled: canReadSessionRuntimeData,
    staleTime: SESSION_MODEL_CATALOG_STALE_TIME_MS,
  });

  const todosQuery = useQuery({
    queryKey: runtimeSessionRef
      ? agentSessionRuntimeQueryKeys.todos(runtimeSessionRef)
      : agentSessionRuntimeQueryKeys.todosUnavailable(),
    queryFn: runtimeSessionRef
      ? (): Promise<AgentSessionTodoItem[]> => readSessionTodos(runtimeSessionRef)
      : skipToken,
    enabled: shouldLoadTodos,
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
    const runtimeDataError = runtimeDataSupportError ?? runtimeDataQueryError;
    const resolvedCatalog = catalogQuery.data ?? null;
    const resolvedTodos = todosQuery.data ?? [];
    const isLoadingModelCatalog =
      runtimeDataSupportError || catalogQueryError
        ? false
        : canReadSessionRuntimeData
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
    canReadSessionRuntimeData,
    todosQuery.data,
    todosQuery.error,
    runtimeDataSupportError,
  ]);
};

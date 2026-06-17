import type { RepoRuntimeRef, RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentSessionRef, AgentSessionTodoItem } from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-health";
import {
  agentSessionTodosQueryKeys,
  SESSION_TODOS_STALE_TIME_MS,
  sessionTodosQueryOptions,
} from "@/state/queries/agent-session-todos";
import {
  RUNTIME_CATALOG_STALE_TIME_MS,
  repoRuntimeCatalogQueryOptions,
  runtimeCatalogQueryKeys,
} from "@/state/queries/runtime-catalog";
import { skippedQueryOptions } from "@/state/queries/skipped-query";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import {
  EMPTY_SELECTED_SESSION_RUNTIME_DATA,
  type SelectedSessionRuntimeData,
} from "@/types/selected-session-runtime-data";
import { resolveSessionRuntimeDataRefs } from "../support/session-runtime-data-refs";

type UseSessionRuntimeDataArgs = {
  repoPath: string | null;
  selectedSessionIdentity: AgentSessionIdentity | null;
  canReadSessionTodos: boolean;
  runtimeDefinitions: RuntimeDescriptor[];
  repoReadinessState: RepoRuntimeReadinessState;
  loadRuntimeCatalog: (runtimeRef: RepoRuntimeRef) => Promise<AgentModelCatalog>;
  readSessionTodos: (session: AgentSessionRef) => Promise<AgentSessionTodoItem[]>;
};

const skippedSessionTodosQueryOptions = (session: AgentSessionRef | null) =>
  skippedQueryOptions<AgentSessionTodoItem[]>({
    queryKey: session ? agentSessionTodosQueryKeys.todos(session) : agentSessionTodosQueryKeys.all,
    staleTime: SESSION_TODOS_STALE_TIME_MS,
  });

const skippedRuntimeCatalogQueryOptions = (runtimeRef: RepoRuntimeRef | null) =>
  skippedQueryOptions<AgentModelCatalog>({
    queryKey: runtimeRef
      ? runtimeCatalogQueryKeys.repo(runtimeRef.repoPath, runtimeRef.runtimeKind)
      : runtimeCatalogQueryKeys.all,
    staleTime: RUNTIME_CATALOG_STALE_TIME_MS,
  });

export const useSessionRuntimeData = ({
  repoPath,
  selectedSessionIdentity,
  canReadSessionTodos,
  runtimeDefinitions,
  repoReadinessState,
  loadRuntimeCatalog,
  readSessionTodos,
}: UseSessionRuntimeDataArgs): SelectedSessionRuntimeData => {
  const runtimeDataRefs = useMemo(
    () =>
      resolveSessionRuntimeDataRefs({
        repoPath,
        selectedSessionIdentity,
        runtimeDefinitions,
      }),
    [repoPath, runtimeDefinitions, selectedSessionIdentity],
  );
  const canReadRuntimeData = selectedSessionIdentity !== null && repoReadinessState === "ready";
  const canReadTodos = canReadRuntimeData && canReadSessionTodos;

  const catalogQuery = useQuery(
    runtimeDataRefs.catalogRef && canReadRuntimeData
      ? repoRuntimeCatalogQueryOptions(runtimeDataRefs.catalogRef, loadRuntimeCatalog)
      : skippedRuntimeCatalogQueryOptions(runtimeDataRefs.catalogRef),
  );

  const todosQuery = useQuery(
    runtimeDataRefs.todosRef && canReadTodos
      ? sessionTodosQueryOptions(runtimeDataRefs.todosRef, readSessionTodos)
      : skippedSessionTodosQueryOptions(runtimeDataRefs.todosRef),
  );

  return useMemo(() => {
    if (!selectedSessionIdentity) {
      return EMPTY_SELECTED_SESSION_RUNTIME_DATA;
    }

    const catalogQueryError =
      catalogQuery.error instanceof Error ? catalogQuery.error.message : null;
    const todosQueryError = todosQuery.error instanceof Error ? todosQuery.error.message : null;
    const runtimeDataQueryError = catalogQueryError ?? todosQueryError;
    const error = runtimeDataRefs.error ?? runtimeDataQueryError;
    const resolvedCatalog = catalogQuery.data ?? null;
    const resolvedTodos = todosQuery.data ?? [];
    const canShowModelCatalogLoading =
      canReadRuntimeData &&
      runtimeDataRefs.catalogRef !== null &&
      !runtimeDataRefs.error &&
      !catalogQueryError;
    const isLoadingModelCatalog =
      canShowModelCatalogLoading && resolvedCatalog === null && catalogQuery.isPending;

    return {
      modelCatalog: resolvedCatalog,
      todos: resolvedTodos,
      isLoadingModelCatalog,
      error,
    };
  }, [
    catalogQuery.data,
    catalogQuery.error,
    catalogQuery.isPending,
    canReadRuntimeData,
    runtimeDataRefs.catalogRef,
    runtimeDataRefs.error,
    selectedSessionIdentity,
    todosQuery.data,
    todosQuery.error,
  ]);
};

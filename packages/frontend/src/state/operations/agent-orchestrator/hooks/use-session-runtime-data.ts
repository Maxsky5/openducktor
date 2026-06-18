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
  runtimeDefinitions,
  repoReadinessState,
  loadRuntimeCatalog,
  readSessionTodos,
}: UseSessionRuntimeDataArgs): SelectedSessionRuntimeData => {
  const selectedSessionExternalSessionId = selectedSessionIdentity?.externalSessionId ?? null;
  const selectedSessionRuntimeKind = selectedSessionIdentity?.runtimeKind ?? null;
  const selectedSessionWorkingDirectory = selectedSessionIdentity?.workingDirectory ?? null;
  const stableSelectedSessionIdentity = useMemo(() => {
    if (
      selectedSessionExternalSessionId === null ||
      selectedSessionRuntimeKind === null ||
      selectedSessionWorkingDirectory === null
    ) {
      return null;
    }

    return {
      externalSessionId: selectedSessionExternalSessionId,
      runtimeKind: selectedSessionRuntimeKind,
      workingDirectory: selectedSessionWorkingDirectory,
    };
  }, [
    selectedSessionExternalSessionId,
    selectedSessionRuntimeKind,
    selectedSessionWorkingDirectory,
  ]);
  const runtimeDataRefs = useMemo(() => {
    return resolveSessionRuntimeDataRefs({
      repoPath,
      selectedSessionIdentity: stableSelectedSessionIdentity,
      runtimeDefinitions,
    });
  }, [repoPath, runtimeDefinitions, stableSelectedSessionIdentity]);
  const isRuntimeReady = repoReadinessState === "ready";
  const catalogRef = runtimeDataRefs.kind === "available" ? runtimeDataRefs.catalogRef : null;
  const todosRef = runtimeDataRefs.kind === "available" ? runtimeDataRefs.todosRef : null;

  const catalogQuery = useQuery(
    catalogRef && isRuntimeReady
      ? repoRuntimeCatalogQueryOptions(catalogRef, loadRuntimeCatalog)
      : skippedRuntimeCatalogQueryOptions(catalogRef),
  );

  const todosQuery = useQuery(
    todosRef && isRuntimeReady
      ? sessionTodosQueryOptions(todosRef, readSessionTodos)
      : skippedSessionTodosQueryOptions(todosRef),
  );

  return useMemo(() => {
    if (runtimeDataRefs.kind === "none") {
      return EMPTY_SELECTED_SESSION_RUNTIME_DATA;
    }

    const catalogQueryError =
      catalogQuery.error instanceof Error ? catalogQuery.error.message : null;
    const todosQueryError = todosQuery.error instanceof Error ? todosQuery.error.message : null;
    const runtimeDataQueryError = catalogQueryError ?? todosQueryError;
    const error =
      runtimeDataRefs.kind === "unavailable" ? runtimeDataRefs.error : runtimeDataQueryError;
    const resolvedCatalog = catalogQuery.data ?? null;
    const resolvedTodos = todosQuery.data ?? [];
    const canShowModelCatalogLoading =
      isRuntimeReady && runtimeDataRefs.kind === "available" && !catalogQueryError;
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
    isRuntimeReady,
    runtimeDataRefs,
    todosQuery.data,
    todosQuery.error,
  ]);
};

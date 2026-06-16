import type { RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentSessionRef, AgentSessionTodoItem } from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-health";
import { resolveSessionRuntimeDataTarget } from "@/state/operations/agent-orchestrator/support/session-runtime-data-target";
import {
  sessionModelCatalogQueryOptions,
  sessionTodosQueryOptions,
} from "@/state/queries/agent-session-runtime";
import type { AgentSessionState } from "@/types/agent-orchestrator";

type UseSessionRuntimeDataArgs = {
  repoPath: string | null;
  session: AgentSessionState | null;
  runtimeDefinitions: RuntimeDescriptor[];
  repoReadinessState: RepoRuntimeReadinessState;
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
  const runtimeDataTarget = useMemo(
    () =>
      resolveSessionRuntimeDataTarget({
        repoPath,
        session,
        runtimeDefinitions,
        repoReadinessState,
      }),
    [repoPath, runtimeDefinitions, repoReadinessState, session],
  );
  const modelCatalogRuntimeRef =
    runtimeDataTarget.kind === "modelCatalog" || runtimeDataTarget.kind === "modelCatalogAndTodos"
      ? runtimeDataTarget.runtimeRef
      : null;
  const todosSessionRef =
    runtimeDataTarget.kind === "modelCatalogAndTodos" ? runtimeDataTarget.todosSessionRef : null;
  const supportError = runtimeDataTarget.kind === "blocked" ? runtimeDataTarget.supportError : null;

  const catalogQuery = useQuery({
    ...sessionModelCatalogQueryOptions(modelCatalogRuntimeRef, readSessionModelCatalog),
    enabled: modelCatalogRuntimeRef !== null,
  });

  const todosQuery = useQuery({
    ...sessionTodosQueryOptions(todosSessionRef, readSessionTodos),
    enabled: todosSessionRef !== null,
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
    const runtimeDataError = supportError ?? runtimeDataQueryError;
    const resolvedCatalog = catalogQuery.data ?? null;
    const resolvedTodos = todosQuery.data ?? [];
    const canShowModelCatalogLoading =
      modelCatalogRuntimeRef !== null && !supportError && !catalogQueryError;
    const isLoadingModelCatalog =
      canShowModelCatalogLoading && resolvedCatalog === null && catalogQuery.isPending;

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
    modelCatalogRuntimeRef,
    session,
    supportError,
    todosQuery.data,
    todosQuery.error,
  ]);
};

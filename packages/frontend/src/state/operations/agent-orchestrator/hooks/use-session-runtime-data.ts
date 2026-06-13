import type { RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentSessionTodoItem } from "@openducktor/core";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { findRuntimeDefinition, runtimeSupportsCapability } from "@/lib/agent-runtime";
import {
  deriveAgentSessionViewLifecycle,
  type SessionRepoReadinessState,
} from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import { resolveSessionRuntimeQueryState } from "@/state/operations/agent-orchestrator/support/session-runtime-query-state";
import {
  agentSessionRuntimeQueryKeys,
  SESSION_MODEL_CATALOG_STALE_TIME_MS,
  SESSION_TODOS_STALE_TIME_MS,
} from "@/state/queries/agent-session-runtime";
import type { AgentSessionState } from "@/types/agent-orchestrator";

type UseSessionRuntimeDataArgs = {
  session: AgentSessionState | null;
  runtimeDefinitions: RuntimeDescriptor[];
  repoReadinessState: SessionRepoReadinessState;
  readSessionModelCatalog: (
    repoPath: string,
    runtimeKind: NonNullable<AgentSessionState["runtimeKind"]>,
  ) => Promise<AgentModelCatalog>;
  readSessionTodos: (
    repoPath: string,
    runtimeKind: NonNullable<AgentSessionState["runtimeKind"]>,
    workingDirectory: string,
    externalSessionId: string,
  ) => Promise<AgentSessionTodoItem[]>;
};

export type SessionRuntimeDataState = {
  session: AgentSessionState | null;
  runtimeDataError: string | null;
};

export const useSessionRuntimeData = ({
  session,
  runtimeDefinitions,
  repoReadinessState,
  readSessionModelCatalog,
  readSessionTodos,
}: UseSessionRuntimeDataArgs): SessionRuntimeDataState => {
  const { runtimeQueryInput, runtimeQueryError: runtimeDataSupportError } = useMemo(
    () => resolveSessionRuntimeQueryState(session),
    [session],
  );
  const sessionViewLifecycle = useMemo(
    () =>
      deriveAgentSessionViewLifecycle({
        session,
        repoReadinessState,
      }),
    [repoReadinessState, session],
  );
  const shouldHydrateRuntimeData =
    sessionViewLifecycle.canReadRuntimeData &&
    runtimeQueryInput !== null &&
    runtimeDataSupportError === null &&
    session?.status !== "starting";
  const runtimeDefinition = session?.runtimeKind
    ? findRuntimeDefinition(runtimeDefinitions, session.runtimeKind)
    : null;
  const supportsTodos = runtimeDefinition
    ? runtimeSupportsCapability(runtimeDefinition, "optionalSurfaces.supportsTodos")
    : false;
  const shouldHydrateTodos =
    shouldHydrateRuntimeData && session !== null && session.todos.length === 0 && supportsTodos;

  const catalogQuery = useQuery({
    queryKey: runtimeQueryInput
      ? agentSessionRuntimeQueryKeys.modelCatalog(
          runtimeQueryInput.repoPath,
          runtimeQueryInput.runtimeKind,
        )
      : agentSessionRuntimeQueryKeys.modelCatalogUnavailable(),
    queryFn: runtimeQueryInput
      ? (): Promise<AgentModelCatalog> =>
          readSessionModelCatalog(runtimeQueryInput.repoPath, runtimeQueryInput.runtimeKind)
      : skipToken,
    enabled: shouldHydrateRuntimeData,
    staleTime: SESSION_MODEL_CATALOG_STALE_TIME_MS,
  });

  const todosQuery = useQuery({
    queryKey:
      runtimeQueryInput && session
        ? agentSessionRuntimeQueryKeys.todos(
            runtimeQueryInput.repoPath,
            runtimeQueryInput.runtimeKind,
            runtimeQueryInput.workingDirectory,
            session.externalSessionId,
          )
        : agentSessionRuntimeQueryKeys.todosUnavailable(),
    queryFn:
      runtimeQueryInput && session
        ? (): Promise<AgentSessionTodoItem[]> =>
            readSessionTodos(
              runtimeQueryInput.repoPath,
              runtimeQueryInput.runtimeKind,
              runtimeQueryInput.workingDirectory,
              session.externalSessionId,
            )
        : skipToken,
    enabled: shouldHydrateTodos,
    staleTime: SESSION_TODOS_STALE_TIME_MS,
  });

  return useMemo(() => {
    if (!session) {
      return {
        session: null,
        runtimeDataError: null,
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
  ]);
};

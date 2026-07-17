import type { RepoRuntimeRef, RuntimeDescriptor } from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentSessionTodoItem,
  PolicyBoundSessionRef,
} from "@openducktor/core";
import { workflowAgentSessionScope } from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-readiness";
import { useStableAgentSessionIdentity } from "@/lib/use-stable-agent-session-identity";
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
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import {
  EMPTY_SELECTED_SESSION_RUNTIME_DATA,
  type SelectedSessionRuntimeData,
} from "@/types/selected-session-runtime-data";
import { resolveSessionRuntimeDataRefs } from "../support/session-runtime-data-refs";
import {
  resolveAgentSessionRuntimePolicyFromSnapshot,
  resolveSettingsIndependentAgentSessionRuntimePolicy,
} from "../support/session-runtime-policy";

type UseSessionRuntimeDataArgs = {
  repoPath: string | null;
  selectedSessionIdentity: (AgentSessionIdentity | AgentSessionState) | null;
  runtimeDefinitions: RuntimeDescriptor[];
  repoReadinessState: RepoRuntimeReadinessState;
  loadRuntimeCatalog: (runtimeRef: RepoRuntimeRef) => Promise<AgentModelCatalog>;
  readSessionTodos: (session: PolicyBoundSessionRef) => Promise<AgentSessionTodoItem[]>;
};

const skippedSessionTodosQueryOptions = (session: PolicyBoundSessionRef | null) =>
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
  const stableSelectedSessionIdentity = useStableAgentSessionIdentity(selectedSessionIdentity);
  const selectedRuntimeContext =
    selectedSessionIdentity && "role" in selectedSessionIdentity ? selectedSessionIdentity : null;
  const hasSelectedRuntimeContext = selectedRuntimeContext !== null;
  const selectedExternalSessionId = selectedSessionIdentity?.externalSessionId ?? null;
  const selectedRuntimeKind = selectedSessionIdentity?.runtimeKind ?? null;
  const selectedWorkingDirectory = selectedSessionIdentity?.workingDirectory ?? null;
  const selectedTaskId = selectedRuntimeContext?.taskId ?? null;
  const selectedRole = selectedRuntimeContext?.role ?? null;
  const selectedModel = selectedRuntimeContext?.selectedModel ?? null;
  const stableSelectedSessionRuntimeContext = useMemo(() => {
    if (
      !hasSelectedRuntimeContext ||
      selectedExternalSessionId === null ||
      selectedRuntimeKind === null ||
      selectedWorkingDirectory === null
    ) {
      return null;
    }

    return {
      externalSessionId: selectedExternalSessionId,
      runtimeKind: selectedRuntimeKind,
      workingDirectory: selectedWorkingDirectory,
      selectedModel,
      ...(selectedTaskId !== null ? { taskId: selectedTaskId } : {}),
      ...(selectedRole !== null ? { role: selectedRole } : {}),
    };
  }, [
    hasSelectedRuntimeContext,
    selectedExternalSessionId,
    selectedRuntimeKind,
    selectedWorkingDirectory,
    selectedTaskId,
    selectedRole,
    selectedModel,
  ]);
  const sessionForRuntimeData =
    stableSelectedSessionRuntimeContext ?? stableSelectedSessionIdentity;
  const runtimePolicyTarget = useMemo(() => {
    if (stableSelectedSessionRuntimeContext === null) {
      return null;
    }
    return {
      runtimeKind: stableSelectedSessionRuntimeContext.runtimeKind,
      sessionScope:
        "taskId" in stableSelectedSessionRuntimeContext &&
        "role" in stableSelectedSessionRuntimeContext
          ? workflowAgentSessionScope(
              stableSelectedSessionRuntimeContext.taskId,
              stableSelectedSessionRuntimeContext.role,
            )
          : null,
    };
  }, [stableSelectedSessionRuntimeContext]);
  const settingsSnapshotQuery = useQuery({
    ...settingsSnapshotQueryOptions(),
    enabled: runtimePolicyTarget?.runtimeKind === "codex",
  });
  const runtimePolicyResult = useMemo(() => {
    if (!runtimePolicyTarget) {
      return { runtimePolicy: null, error: null };
    }
    const settingsIndependentPolicy = resolveSettingsIndependentAgentSessionRuntimePolicy(
      runtimePolicyTarget.runtimeKind,
    );
    if (settingsIndependentPolicy) {
      return { runtimePolicy: settingsIndependentPolicy, error: null };
    }
    const settingsSnapshot = settingsSnapshotQuery.data;
    if (!settingsSnapshot) {
      return { runtimePolicy: null, error: null };
    }
    try {
      return {
        runtimePolicy: resolveAgentSessionRuntimePolicyFromSnapshot({
          ...runtimePolicyTarget,
          snapshot: settingsSnapshot,
        }),
        error: null,
      };
    } catch (error) {
      return {
        runtimePolicy: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [runtimePolicyTarget, settingsSnapshotQuery.data]);
  const runtimePolicyError =
    runtimePolicyResult.error ??
    (settingsSnapshotQuery.error instanceof Error ? settingsSnapshotQuery.error.message : null);
  const runtimePolicy = runtimePolicyResult.runtimePolicy;
  const runtimeDataRefs = useMemo(() => {
    return resolveSessionRuntimeDataRefs({
      repoPath,
      selectedSessionIdentity: sessionForRuntimeData,
      runtimePolicy,
      runtimeDefinitions,
    });
  }, [repoPath, runtimeDefinitions, runtimePolicy, sessionForRuntimeData]);
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
      runtimeDataRefs.kind === "unavailable"
        ? runtimeDataRefs.error
        : (runtimePolicyError ?? runtimeDataQueryError);
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
    runtimePolicyError,
    todosQuery.data,
    todosQuery.error,
  ]);
};

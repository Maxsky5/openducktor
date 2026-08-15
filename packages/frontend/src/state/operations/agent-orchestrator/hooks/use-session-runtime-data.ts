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
import type { AgentTaskSessionBinding } from "@/types/agent-orchestrator";
import {
  EMPTY_SELECTED_SESSION_RUNTIME_DATA,
  type SelectedSessionRuntimeData,
} from "@/types/selected-session-runtime-data";
import type { SessionRuntimeDataTarget } from "../support/session-runtime-data-refs";
import { resolveSessionRuntimeDataRefs } from "../support/session-runtime-data-refs";
import {
  resolveAgentSessionRuntimePolicyFromSnapshot,
  resolveSettingsIndependentAgentSessionRuntimePolicy,
} from "../support/session-runtime-policy";

type UseSessionRuntimeDataArgs = {
  repoPath: string | null;
  selectedSession: SessionRuntimeDataTarget | null;
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
  selectedSession,
  runtimeDefinitions,
  repoReadinessState,
  loadRuntimeCatalog,
  readSessionTodos,
}: UseSessionRuntimeDataArgs): SelectedSessionRuntimeData => {
  const stableSelectedSessionIdentity = useStableAgentSessionIdentity(selectedSession?.identity);
  const selectedTaskId = selectedSession?.taskBinding?.taskId ?? null;
  const selectedRole = selectedSession?.taskBinding?.role ?? null;
  const selectedModel = selectedSession?.selectedModel ?? null;
  const stableSelectedSession = useMemo<SessionRuntimeDataTarget | null>(() => {
    if (!stableSelectedSessionIdentity) {
      return null;
    }
    const taskBinding: AgentTaskSessionBinding | null =
      selectedTaskId && selectedRole ? { taskId: selectedTaskId, role: selectedRole } : null;
    return { identity: stableSelectedSessionIdentity, taskBinding, selectedModel };
  }, [stableSelectedSessionIdentity, selectedModel, selectedRole, selectedTaskId]);
  const runtimePolicyTarget = useMemo(() => {
    if (stableSelectedSession === null) {
      return null;
    }
    return {
      runtimeKind: stableSelectedSession.identity.runtimeKind,
      sessionScope: stableSelectedSession.taskBinding
        ? workflowAgentSessionScope(
            stableSelectedSession.taskBinding.taskId,
            stableSelectedSession.taskBinding.role,
          )
        : null,
    };
  }, [stableSelectedSession]);
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
      selectedSession: stableSelectedSession,
      runtimePolicy,
      runtimeDefinitions,
    });
  }, [repoPath, runtimeDefinitions, runtimePolicy, stableSelectedSession]);
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

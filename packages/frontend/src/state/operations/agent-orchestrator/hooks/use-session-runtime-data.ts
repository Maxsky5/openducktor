import type {
  AgentSessionAssociation,
  RepoRuntimeRef,
  RuntimeDescriptor,
} from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentSessionTodoItem,
  PolicyBoundSessionRef,
} from "@openducktor/core";
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
import { resolveSessionRuntimeScope } from "../support/session-runtime-scope";

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
  const selectedAssociationKind = selectedSession?.sessionAssociation.kind ?? null;
  const selectedTaskId =
    selectedSession?.sessionAssociation.kind === "workflow"
      ? selectedSession.sessionAssociation.taskId
      : null;
  const selectedRole =
    selectedSession?.sessionAssociation.kind === "workflow"
      ? selectedSession.sessionAssociation.role
      : null;
  const selectedModel = selectedSession?.selectedModel ?? null;
  const stableSelectedSession = useMemo<SessionRuntimeDataTarget | null>(() => {
    if (!stableSelectedSessionIdentity || !selectedAssociationKind) {
      return null;
    }
    let sessionAssociation: AgentSessionAssociation;
    if (selectedAssociationKind === "workflow") {
      if (!selectedTaskId || !selectedRole) {
        throw new Error("Workflow session runtime data requires a task id and role.");
      }
      sessionAssociation = { kind: "workflow", taskId: selectedTaskId, role: selectedRole };
    } else if (selectedAssociationKind === "repository") {
      sessionAssociation = { kind: "repository" };
    } else {
      sessionAssociation = { kind: "unbound" };
    }
    return {
      identity: stableSelectedSessionIdentity,
      sessionAssociation,
      selectedModel,
    };
  }, [
    selectedAssociationKind,
    stableSelectedSessionIdentity,
    selectedModel,
    selectedRole,
    selectedTaskId,
  ]);
  const runtimePolicyTarget = useMemo(() => {
    if (stableSelectedSession === null) {
      return null;
    }
    return {
      runtimeKind: stableSelectedSession.identity.runtimeKind,
      sessionScope: resolveSessionRuntimeScope(stableSelectedSession.sessionAssociation),
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

  const catalogQuery = useQuery({
    ...(catalogRef && isRuntimeReady
      ? repoRuntimeCatalogQueryOptions(catalogRef, loadRuntimeCatalog)
      : skippedRuntimeCatalogQueryOptions(catalogRef)),
    notifyOnChangeProps: ["data", "error", "isFetching"],
  });

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
      !catalogQuery.isFetching && catalogQuery.error instanceof Error
        ? catalogQuery.error.message
        : null;
    const todosQueryError = todosQuery.error instanceof Error ? todosQuery.error.message : null;
    const contextError = runtimeDataRefs.kind === "unavailable" ? runtimeDataRefs.error : null;
    const resolvedCatalog = catalogQuery.data ?? null;
    const resolvedTodos = todosQuery.data ?? [];
    const isLoadingModelCatalog =
      isRuntimeReady && runtimeDataRefs.kind === "available" && catalogQuery.isFetching;

    return {
      modelCatalog: resolvedCatalog,
      todos: resolvedTodos,
      isLoadingModelCatalog,
      catalogError: catalogQueryError,
      todosError: todosQueryError,
      runtimePolicyError,
      contextError,
    };
  }, [
    catalogQuery.data,
    catalogQuery.error,
    catalogQuery.isFetching,
    isRuntimeReady,
    runtimeDataRefs,
    runtimePolicyError,
    todosQuery.data,
    todosQuery.error,
  ]);
};

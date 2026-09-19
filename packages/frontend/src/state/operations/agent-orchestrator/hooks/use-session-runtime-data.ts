import type { AgentSessionAssociation, RuntimeDescriptor } from "@openducktor/contracts";
import type {
  AgentRuntimeCatalog,
  AgentSessionTodoItem,
  PolicyBoundSessionRef,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-readiness";
import { useStableAgentSessionIdentity } from "@/lib/use-stable-agent-session-identity";
import {
  sessionTodosQueryOptions,
  skippedSessionTodosQueryOptions,
} from "@/state/queries/agent-session-todos";
import {
  resolveRuntimeCatalogSurface,
  runtimeCatalogQueryOptions,
  skippedRuntimeCatalogQueryOptions,
} from "@/state/queries/runtime-catalog";
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
  loadRuntimeCatalog: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentRuntimeCatalog>;
  readSessionTodos: (session: PolicyBoundSessionRef) => Promise<AgentSessionTodoItem[]>;
};

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
    ...(catalogRef
      ? runtimeCatalogQueryOptions(catalogRef, loadRuntimeCatalog)
      : skippedRuntimeCatalogQueryOptions()),
    enabled: catalogRef !== null && isRuntimeReady,
    notifyOnChangeProps: ["data", "error", "isFetching"],
  });

  const todosQuery = useQuery({
    ...(todosRef
      ? sessionTodosQueryOptions(todosRef, readSessionTodos)
      : skippedSessionTodosQueryOptions()),
    enabled: todosRef !== null && isRuntimeReady,
  });

  return useMemo(() => {
    if (runtimeDataRefs.kind === "none") {
      return EMPTY_SELECTED_SESSION_RUNTIME_DATA;
    }

    const modelSurface = resolveRuntimeCatalogSurface(
      catalogQuery.data?.models,
      catalogQuery.error,
    );
    const catalogQueryError = modelSurface.error;
    const todosQueryError = todosQuery.error instanceof Error ? todosQuery.error.message : null;
    const contextError = runtimeDataRefs.kind === "unavailable" ? runtimeDataRefs.error : null;
    const resolvedCatalog = modelSurface.catalog;
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

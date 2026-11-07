import type { AgentSessionAssociation, RuntimeDescriptor } from "@openducktor/contracts";
import type {
  AgentRuntimeCatalog,
  AgentSessionTodoItem,
  PolicyBoundSessionRef,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { RuntimeReadinessState } from "../../../lib/runtime-readiness";
import { useStableAgentSessionIdentity } from "../../../lib/use-stable-agent-session-identity";
import { useStableAgentSessionScope } from "../../../lib/use-stable-agent-session-scope";
import {
  sessionTodosQueryOptions,
  skippedSessionTodosQueryOptions,
} from "../../../queries/agent-session-todos";
import { useRuntimeModelCatalogQuery } from "../../../queries/use-runtime-model-catalogs";
import { settingsSnapshotQueryOptions } from "../../../queries/workspace";
import { taskWorkflowContextQueryOptions } from "../../../queries/task-workflow-context";
import {
  EMPTY_SELECTED_SESSION_RUNTIME_DATA,
  type SelectedSessionRuntimeData,
} from "../../../types/selected-session-runtime-data";
import type { SessionRuntimeDataTarget } from "../support/session-runtime-data-refs";
import { isMatchingFreshCodexSessionAwaitingKickoff } from "../support/fresh-codex-session";
import type { AgentSessionState } from "../../../types/agent-orchestrator";
import { resolveSessionRuntimeDataRefs } from "../support/session-runtime-data-refs";
import {
  resolveAgentSessionRuntimePolicyFromSnapshot,
  resolveSettingsIndependentAgentSessionRuntimePolicy,
} from "../support/session-runtime-policy";
import { resolveSessionRuntimeScope } from "../support/session-runtime-scope";

const UNBOUND_ASSOCIATION: AgentSessionAssociation = { kind: "unbound" };

type UseSessionRuntimeDataArgs = {
  repoPath: string | null;
  selectedSession: SessionRuntimeDataTarget | null;
  sessionState?: AgentSessionState | null;
  runtimeDefinitions: RuntimeDescriptor[];
  runtimeReadinessState: RuntimeReadinessState;
  loadRuntimeCatalog: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentRuntimeCatalog>;
  readSessionTodos: (session: PolicyBoundSessionRef) => Promise<AgentSessionTodoItem[]>;
};

export const useSessionRuntimeData = ({
  repoPath,
  selectedSession,
  sessionState,
  runtimeDefinitions,
  runtimeReadinessState,
  loadRuntimeCatalog,
  readSessionTodos,
}: UseSessionRuntimeDataArgs): SelectedSessionRuntimeData => {
  const stableSelectedSessionIdentity = useStableAgentSessionIdentity(selectedSession?.identity);
  const stableSelectedScope = useStableAgentSessionScope(
    selectedSession ? resolveSessionRuntimeScope(selectedSession.sessionAssociation) : null,
  );
  const selectedModel = selectedSession?.selectedModel ?? null;
  const stableSelectedSession = useMemo<SessionRuntimeDataTarget | null>(() => {
    if (!stableSelectedSessionIdentity) {
      return null;
    }
    return {
      identity: stableSelectedSessionIdentity,
      sessionAssociation: stableSelectedScope ?? UNBOUND_ASSOCIATION,
      selectedModel,
    };
  }, [stableSelectedScope, stableSelectedSessionIdentity, selectedModel]);
  const runtimePolicyTarget = useMemo(() => {
    if (stableSelectedSession === null) {
      return null;
    }
    return {
      runtimeKind: stableSelectedSession.identity.runtimeKind,
      sessionScope: stableSelectedScope,
    };
  }, [stableSelectedScope, stableSelectedSession]);
  const workflowScope = stableSelectedScope?.kind === "workflow" ? stableSelectedScope : null;
  const { runtimePolicy, runtimePolicyError } = useWorkflowSessionRuntimePolicy(
    stableSelectedScope?.workspaceId ?? null,
    repoPath,
    workflowScope?.taskId ?? null,
    workflowScope?.role ?? null,
    runtimePolicyTarget,
  );
  const runtimeDataRefs = useMemo(() => {
    return resolveSessionRuntimeDataRefs({
      repoPath,
      selectedSession: stableSelectedSession,
      runtimePolicy,
      runtimeDefinitions,
    });
  }, [repoPath, runtimeDefinitions, runtimePolicy, stableSelectedSession]);
  const isRuntimeReady = runtimeReadinessState === "ready";
  const catalogRef = runtimeDataRefs.kind === "available" ? runtimeDataRefs.catalogRef : null;
  const todosRef = runtimeDataRefs.kind === "available" ? runtimeDataRefs.todosRef : null;
  const ownsFreshCodexEmptyState = isMatchingFreshCodexSessionAwaitingKickoff(
    sessionState,
    stableSelectedSessionIdentity,
  );

  const modelCatalog = useRuntimeModelCatalogQuery({
    runtimeRef: catalogRef,
    loadRuntimeCatalog,
    enabled: isRuntimeReady,
  });

  const todosQuery = useQuery({
    ...(todosRef
      ? sessionTodosQueryOptions(todosRef, readSessionTodos)
      : skippedSessionTodosQueryOptions()),
    enabled: todosRef !== null && isRuntimeReady && !ownsFreshCodexEmptyState,
  });

  return useMemo(() => {
    if (runtimeDataRefs.kind === "none") {
      return EMPTY_SELECTED_SESSION_RUNTIME_DATA;
    }

    const todosQueryError = todosQuery.error instanceof Error ? todosQuery.error.message : null;
    const contextError = runtimeDataRefs.kind === "unavailable" ? runtimeDataRefs.error : null;

    return {
      modelCatalog: modelCatalog.catalog,
      todos: todosQuery.data ?? [],
      isLoadingModelCatalog: modelCatalog.isLoading,
      catalogError: modelCatalog.error,
      todosError: todosQueryError,
      runtimePolicyError,
      contextError,
    };
  }, [
    modelCatalog.catalog,
    modelCatalog.error,
    modelCatalog.isLoading,
    runtimeDataRefs,
    runtimePolicyError,
    todosQuery.data,
    todosQuery.error,
  ]);
};

function useWorkflowSessionRuntimePolicy(
  selectedWorkspaceId: string | null,
  repoPath: string | null,
  selectedTaskId: string | null,
  selectedRole: string | null,
  runtimePolicyTarget: {
    runtimeKind: SessionRuntimeDataTarget["identity"]["runtimeKind"];
    sessionScope: ReturnType<typeof resolveSessionRuntimeScope>;
  } | null,
) {
  const settingsSnapshotQuery = useQuery({
    ...settingsSnapshotQueryOptions(),
    enabled: runtimePolicyTarget?.runtimeKind === "codex",
  });
  const taskQuery = useQuery({
    ...taskWorkflowContextQueryOptions(
      selectedWorkspaceId && repoPath ? { workspaceId: selectedWorkspaceId, repoPath } : null,
      selectedTaskId ?? "",
    ),
    enabled: runtimePolicyTarget?.runtimeKind === "codex" && !!repoPath && !!selectedTaskId,
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
    if (runtimePolicyTarget.sessionScope?.kind === "workflow" && !taskQuery.data)
      return { runtimePolicy: null, error: null };
    try {
      const workflowRole = taskQuery.data?.taskWorkflow.roles.find(({ id }) => id === selectedRole);
      const policyInput: Parameters<typeof resolveAgentSessionRuntimePolicyFromSnapshot>[0] = {
        ...runtimePolicyTarget,
        snapshot: settingsSnapshot,
      };
      if (workflowRole) policyInput.workflowRole = workflowRole;
      return {
        runtimePolicy: resolveAgentSessionRuntimePolicyFromSnapshot(policyInput),
        error: null,
      };
    } catch (error) {
      return {
        runtimePolicy: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [runtimePolicyTarget, settingsSnapshotQuery.data, taskQuery.data, selectedRole]);
  const runtimePolicyError =
    runtimePolicyResult.error ??
    taskQuery.error?.message ??
    settingsSnapshotQuery.error?.message ??
    null;
  const runtimePolicy = runtimePolicyResult.runtimePolicy;
  return { runtimePolicy, runtimePolicyError };
}

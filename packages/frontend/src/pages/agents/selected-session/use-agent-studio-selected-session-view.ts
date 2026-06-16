import type { RuntimeDescriptor, TaskCard } from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentRole,
  AgentSessionRef,
  AgentSessionTodoItem,
} from "@openducktor/core";
import { useMemo } from "react";
import {
  firstLaunchAction,
  resolveBuildContinuationLaunchAction,
  type SessionLaunchActionId,
} from "@/features/session-start";
import type { RepoRuntimeReadiness } from "@/lib/use-repo-runtime-readiness";
import { useRepoRuntimeReadiness } from "@/lib/use-repo-runtime-readiness";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { useAgentSession } from "@/state/app-state-provider";
import { useSelectedSessionHistoryLoader } from "@/state/operations/agent-orchestrator/history/session-history-loader";
import type { SessionRuntimeDataState } from "@/state/operations/agent-orchestrator/hooks/use-session-runtime-data";
import { useSessionRuntimeData } from "@/state/operations/agent-orchestrator/hooks/use-session-runtime-data";
import {
  type AgentSessionTranscriptState,
  deriveSelectedAgentSessionTranscriptState,
} from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentSessionReadModelLoadState } from "@/types/agent-session-read-model";
import type { ChecksStateContextValue } from "@/types/state-slices";
import {
  type AgentStudioViewSessionSelectionIntent,
  resolveAgentStudioViewSessionSelection,
} from "../agents-page-selection";

type UseAgentStudioSelectedSessionViewArgs = {
  workspaceRepoPath: string | null;
  selectedTask: TaskCard | null;
  sessionSummaries: AgentSessionSummary[];
  sessionKey: string | null;
  hasExplicitRoleSelection: boolean;
  roleSelection: AgentRole;
  fallbackRole: AgentRole;
  keepExplicitRoleSessionless: boolean;
  selectionIntent: AgentStudioViewSessionSelectionIntent | null;
  sessionIdentityFromRoute: AgentSessionIdentity | null;
  sessionReadModelLoadState: AgentSessionReadModelLoadState;
  runtimeDefinitions: RuntimeDescriptor[];
  isLoadingRuntimeDefinitions: boolean;
  runtimeDefinitionsError: string | null;
  runtimeHealthByRuntime: ChecksStateContextValue["runtimeHealthByRuntime"];
  isLoadingChecks: boolean;
  refreshChecks: () => Promise<void>;
  loadAgentSessionHistory: (session: AgentSessionIdentity) => Promise<void>;
  readSessionModelCatalog: (
    repoPath: string,
    runtimeKind: NonNullable<AgentSessionState["runtimeKind"]>,
  ) => Promise<AgentModelCatalog>;
  readSessionTodos: (session: AgentSessionRef) => Promise<AgentSessionTodoItem[]>;
};

export type AgentStudioSelectedSessionView = {
  sessionSummary: AgentSessionSummary | null;
  session: AgentSessionState | null;
  runtimeData: SessionRuntimeDataState["runtimeData"];
  runtimeDataError: string | null;
  runtimeReadiness: RepoRuntimeReadiness;
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
  transcriptState: AgentSessionTranscriptState;
};

export function useAgentStudioSelectedSessionView({
  workspaceRepoPath,
  selectedTask,
  sessionSummaries,
  sessionKey,
  hasExplicitRoleSelection,
  roleSelection,
  fallbackRole,
  keepExplicitRoleSessionless,
  selectionIntent,
  sessionIdentityFromRoute,
  sessionReadModelLoadState,
  runtimeDefinitions,
  isLoadingRuntimeDefinitions,
  runtimeDefinitionsError,
  runtimeHealthByRuntime,
  isLoadingChecks,
  refreshChecks,
  loadAgentSessionHistory,
  readSessionModelCatalog,
  readSessionTodos,
}: UseAgentStudioSelectedSessionViewArgs): AgentStudioSelectedSessionView {
  const selection = useMemo(() => {
    return resolveAgentStudioViewSessionSelection({
      sessionSummaries,
      sessionKey,
      sessionIdentity: sessionIdentityFromRoute,
      hasExplicitRoleParam: hasExplicitRoleSelection,
      roleFromQuery: roleSelection,
      selectedTask,
      fallbackRole,
      keepExplicitRoleSessionless,
      selectionIntent,
    });
  }, [
    sessionKey,
    fallbackRole,
    hasExplicitRoleSelection,
    keepExplicitRoleSessionless,
    roleSelection,
    sessionIdentityFromRoute,
    selectionIntent,
    selectedTask,
    sessionSummaries,
  ]);

  const selectedSessionIdentity = selection.sessionIdentity;
  const session = useAgentSession(selectedSessionIdentity);
  const runtimeReadiness = useRepoRuntimeReadiness({
    hasWorkspace: workspaceRepoPath !== null,
    runtimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
    runtimeHealthByRuntime,
    isLoadingChecks,
    refreshChecks,
    runtimeKind: selectedSessionIdentity?.runtimeKind ?? null,
  });
  const repoReadinessState = runtimeReadiness.readinessState;

  const launchActionId: SessionLaunchActionId =
    selection.role === "build"
      ? resolveBuildContinuationLaunchAction(selectedTask)
      : firstLaunchAction(selection.role);

  const transcriptState = useMemo(() => {
    return deriveSelectedAgentSessionTranscriptState({
      selectedSessionIdentity,
      session,
      hasSelectedTask: selectedTask !== null,
      repoReadinessState,
      sessionReadModelLoadState,
    });
  }, [
    repoReadinessState,
    selectedTask,
    session,
    sessionReadModelLoadState,
    selectedSessionIdentity,
  ]);
  const runtimeData = useSessionRuntimeData({
    repoPath: workspaceRepoPath,
    session,
    runtimeDefinitions,
    repoReadinessState,
    readSessionModelCatalog,
    readSessionTodos,
  });

  useSelectedSessionHistoryLoader({
    selectedSessionIdentity,
    repoReadinessState,
    session,
    loadAgentSessionHistory,
  });

  return useMemo<AgentStudioSelectedSessionView>(
    () => ({
      sessionSummary: selection.sessionSummary,
      session,
      runtimeData: runtimeData.runtimeData,
      runtimeDataError: runtimeData.runtimeDataError,
      runtimeReadiness,
      role: selection.role,
      launchActionId,
      transcriptState,
    }),
    [
      launchActionId,
      transcriptState,
      runtimeReadiness,
      runtimeData.runtimeData,
      runtimeData.runtimeDataError,
      selection.role,
      selection.sessionSummary,
      session,
    ],
  );
}

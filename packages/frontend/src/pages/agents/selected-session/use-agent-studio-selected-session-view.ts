import type { RepoRuntimeRef, RuntimeDescriptor, TaskCard } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentRole } from "@openducktor/core";
import { useMemo } from "react";
import {
  firstLaunchAction,
  resolveBuildContinuationLaunchAction,
  type SessionLaunchActionId,
} from "@/features/session-start";
import type { RepoRuntimeReadiness } from "@/lib/use-repo-runtime-readiness";
import { useRepoRuntimeReadiness } from "@/lib/use-repo-runtime-readiness";
import type { WorkflowAgentSessionSummary } from "@/state/agent-sessions-store";
import {
  useAgentOperations,
  useAgentSession,
  useAgentSessionReadModelState,
} from "@/state/app-state-provider";
import { useSessionRuntimeData } from "@/state/operations/agent-orchestrator/hooks/use-session-runtime-data";
import {
  deriveSelectedAgentSessionTranscriptState,
  type SelectedAgentSessionTranscriptState,
} from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentSessionActivityState } from "@/types/agent-session-activity";
import type { SelectedSessionRuntimeData } from "@/types/selected-session-runtime-data";
import type { ChecksStateContextValue, RepoSettingsInput } from "@/types/state-slices";
import {
  type AgentStudioViewSessionSelectionIntent,
  resolveAgentStudioViewSessionSelection,
} from "../agents-page-selection";
import {
  resolveSelectedSessionActivityState,
  resolveSelectedSessionModel,
} from "./selected-session-facts";
import { resolveSelectedSessionRuntimeTarget } from "./selected-session-runtime-target";

type UseAgentStudioSelectedSessionViewArgs = {
  workspaceRepoPath: string | null;
  selectedTask: TaskCard | null;
  sessionSummaries: WorkflowAgentSessionSummary[];
  sessionKey: string | null;
  hasExplicitRoleSelection: boolean;
  roleSelection: AgentRole;
  sessionlessRole: AgentRole;
  keepExplicitRoleSessionless: boolean;
  selectionIntent: AgentStudioViewSessionSelectionIntent | null;
  sessionIdentityFromRoute: AgentSessionIdentity | null;
  repoSettings: RepoSettingsInput | null;
  isLoadingRepoSettings: boolean;
  runtimeDefinitions: RuntimeDescriptor[];
  isLoadingRuntimeDefinitions: boolean;
  runtimeDefinitionsError: string | null;
  runtimeHealthByRuntime: ChecksStateContextValue["runtimeHealthByRuntime"];
  isLoadingChecks: boolean;
  refreshChecks: () => Promise<void>;
  loadRepoRuntimeCatalog: (runtimeRef: RepoRuntimeRef) => Promise<AgentModelCatalog>;
};

export type AgentStudioSelectedSessionView = {
  selectedSessionIdentity: AgentSessionIdentity | null;
  selectedSessionActivityState: AgentSessionActivityState | null;
  selectedSessionModel: AgentSessionState["selectedModel"];
  loadedSession: AgentSessionState | null;
  sessionRuntimeData: SelectedSessionRuntimeData;
  runtimeReadiness: RepoRuntimeReadiness;
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
  transcriptState: SelectedAgentSessionTranscriptState;
};

export function useAgentStudioSelectedSessionView({
  workspaceRepoPath,
  selectedTask,
  sessionSummaries,
  sessionKey,
  hasExplicitRoleSelection,
  roleSelection,
  sessionlessRole,
  keepExplicitRoleSessionless,
  selectionIntent,
  sessionIdentityFromRoute,
  repoSettings,
  isLoadingRepoSettings,
  runtimeDefinitions,
  isLoadingRuntimeDefinitions,
  runtimeDefinitionsError,
  runtimeHealthByRuntime,
  isLoadingChecks,
  refreshChecks,
  loadRepoRuntimeCatalog,
}: UseAgentStudioSelectedSessionViewArgs): AgentStudioSelectedSessionView {
  const { readSessionTodos } = useAgentOperations();
  const selection = useMemo(() => {
    return resolveAgentStudioViewSessionSelection({
      sessionSummaries,
      sessionKey,
      sessionIdentity: sessionIdentityFromRoute,
      hasExplicitRoleParam: hasExplicitRoleSelection,
      roleFromQuery: roleSelection,
      selectedTask,
      sessionlessRole,
      keepExplicitRoleSessionless,
      selectionIntent,
    });
  }, [
    sessionKey,
    hasExplicitRoleSelection,
    keepExplicitRoleSessionless,
    roleSelection,
    sessionlessRole,
    sessionIdentityFromRoute,
    selectionIntent,
    selectedTask,
    sessionSummaries,
  ]);

  const selectedSessionIdentity = selection.sessionIdentity;
  const session = useAgentSession(selectedSessionIdentity);
  const selectedSessionActivityState = selectedSessionIdentity
    ? resolveSelectedSessionActivityState({
        selectedSessionSummary: selection.sessionSummary,
        loadedSession: session,
      })
    : null;
  const selectedSessionModel = selectedSessionIdentity
    ? resolveSelectedSessionModel({
        selectedSessionSummary: selection.sessionSummary,
        loadedSession: session,
      })
    : null;
  const { sessionReadModelLoadState } = useAgentSessionReadModelState();
  const runtimeTarget = resolveSelectedSessionRuntimeTarget({
    hasSelectedTask: selectedTask !== null,
    selectedSessionIdentity,
    role: selection.role,
    repoSettings,
    isLoadingRepoSettings,
  });
  const runtimeReadiness = useRepoRuntimeReadiness({
    hasWorkspace: workspaceRepoPath !== null,
    runtimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
    runtimeHealthByRuntime,
    isLoadingChecks,
    refreshChecks,
    runtimeTarget,
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
    selectedSessionIdentity,
    runtimeDefinitions,
    repoReadinessState,
    loadRuntimeCatalog: loadRepoRuntimeCatalog,
    readSessionTodos,
  });

  return useMemo<AgentStudioSelectedSessionView>(
    () => ({
      selectedSessionIdentity,
      selectedSessionActivityState,
      selectedSessionModel,
      loadedSession: session,
      sessionRuntimeData: runtimeData,
      runtimeReadiness,
      role: selection.role,
      launchActionId,
      transcriptState,
    }),
    [
      launchActionId,
      transcriptState,
      runtimeReadiness,
      runtimeData,
      selectedSessionActivityState,
      selectedSessionIdentity,
      selectedSessionModel,
      selection.role,
      session,
    ],
  );
}

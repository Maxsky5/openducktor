import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useMemo } from "react";
import {
  firstLaunchAction,
  resolveBuildContinuationLaunchAction,
  type SessionLaunchActionId,
} from "@/features/session-start";
import type { RepoRuntimeReadiness } from "@/lib/use-repo-runtime-readiness";
import { useRepoRuntimeReadiness } from "@/lib/use-repo-runtime-readiness";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { useRuntimeAvailabilityContext } from "@/state/app-state-contexts";
import {
  useAgentOperations,
  useAgentSession,
  useAgentSessionReadModelState,
  useChecksState,
} from "@/state/app-state-provider";
import { useSessionRuntimeData } from "@/state/operations/agent-orchestrator/hooks/use-session-runtime-data";
import type { AgentSessionTranscriptState } from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentSessionActivityState } from "@/types/agent-session-activity";
import type { SelectedSessionRuntimeData } from "@/types/selected-session-runtime-data";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  type AgentStudioViewSessionSelectionIntent,
  resolveAgentStudioViewSessionSelection,
} from "../agents-page-selection";
import {
  deriveSelectedSessionTranscriptState,
  projectSelectedSessionViewSource,
  resolveSelectedSessionViewSource,
} from "./selected-session-view-source";

type UseAgentStudioSelectedSessionViewArgs = {
  workspaceRepoPath: string | null;
  selectedTask: TaskCard | null;
  sessionSummaries: AgentSessionSummary[];
  sessionKey: string | null;
  hasExplicitRoleSelection: boolean;
  roleSelection: AgentRole;
  sessionlessRole: AgentRole;
  keepExplicitRoleSessionless: boolean;
  selectionIntent: AgentStudioViewSessionSelectionIntent | null;
  sessionIdentityFromRoute: AgentSessionIdentity | null;
  repoSettings: RepoSettingsInput | null;
  isLoadingRepoSettings: boolean;
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
  transcriptState: AgentSessionTranscriptState;
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
}: UseAgentStudioSelectedSessionViewArgs): AgentStudioSelectedSessionView {
  const { readSessionTodos } = useAgentOperations();
  const {
    availableRuntimeDefinitions: runtimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
    loadRepoRuntimeCatalog,
  } = useRuntimeAvailabilityContext();
  const { runtimeHealthByRuntime, isLoadingChecks, refreshChecks } = useChecksState();
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
  const { sessionReadModelLoadState } = useAgentSessionReadModelState();
  const selectedSessionViewSource = useMemo(
    () =>
      resolveSelectedSessionViewSource({
        selectedSessionIdentity,
        session,
        sessionSummary: selection.sessionSummary,
        selectedTask,
        readModelLoadState: sessionReadModelLoadState,
      }),
    [
      selectedSessionIdentity,
      selectedTask,
      session,
      selection.sessionSummary,
      sessionReadModelLoadState,
    ],
  );
  const selectedSessionViewProjection = useMemo(
    () =>
      projectSelectedSessionViewSource({
        source: selectedSessionViewSource,
        role: selection.role,
        repoSettings,
        isLoadingRepoSettings,
      }),
    [isLoadingRepoSettings, repoSettings, selectedSessionViewSource, selection.role],
  );
  const selectedSessionActivityState = selectedSessionViewProjection.activityState;
  const selectedSessionModel = selectedSessionViewProjection.selectedModel;
  const runtimeTarget = selectedSessionViewProjection.runtimeTarget;
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
    return deriveSelectedSessionTranscriptState({
      source: selectedSessionViewSource,
      repoReadinessState,
    });
  }, [repoReadinessState, selectedSessionViewSource]);
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

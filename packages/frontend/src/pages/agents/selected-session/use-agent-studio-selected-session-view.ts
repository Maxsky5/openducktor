import type { RepoRuntimeRef, RuntimeDescriptor, TaskCard } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentRole } from "@openducktor/core";
import { useMemo } from "react";
import {
  firstLaunchAction,
  resolveBuildContinuationLaunchAction,
  type SessionLaunchActionId,
} from "@/features/session-start";
import { getAgentSessionActivityStateFromSession } from "@/lib/agent-session-activity-state";
import type { RepoRuntimeReadiness } from "@/lib/use-repo-runtime-readiness";
import { useRepoRuntimeReadiness } from "@/lib/use-repo-runtime-readiness";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import {
  useAgentOperations,
  useAgentSession,
  useAgentSessionReadModelState,
} from "@/state/app-state-provider";
import { useSessionRuntimeData } from "@/state/operations/agent-orchestrator/hooks/use-session-runtime-data";
import {
  type AgentSessionTranscriptState,
  deriveSelectedAgentSessionTranscriptState,
  type SelectedAgentSessionTranscriptSource,
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
  resolveSelectedSessionRuntimeTarget,
  type SelectedSessionRuntimeTargetSource,
} from "./selected-session-runtime-target";

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
  let selectedSessionActivityState: AgentSessionActivityState | null = null;
  let selectedSessionModel: AgentSessionState["selectedModel"] = null;
  if (selectedSessionIdentity) {
    selectedSessionActivityState = session
      ? getAgentSessionActivityStateFromSession(session)
      : (selection.sessionSummary?.activityState ?? null);
    selectedSessionModel =
      session?.selectedModel ?? selection.sessionSummary?.selectedModel ?? null;
  }
  const { sessionReadModelLoadState } = useAgentSessionReadModelState();
  let runtimeTargetSource: SelectedSessionRuntimeTargetSource;
  if (selectedSessionIdentity) {
    runtimeTargetSource = {
      kind: "selected_session",
      runtimeKind: selectedSessionIdentity.runtimeKind,
    };
  } else if (selectedTask) {
    runtimeTargetSource = { kind: "selected_task" };
  } else {
    runtimeTargetSource = { kind: "inactive" };
  }
  const runtimeTarget = resolveSelectedSessionRuntimeTarget({
    source: runtimeTargetSource,
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
    let transcriptSource: SelectedAgentSessionTranscriptSource;
    if (session) {
      transcriptSource = { kind: "loaded_session", session };
    } else if (selectedSessionIdentity) {
      transcriptSource = {
        kind: "selected_session",
        readModelLoadState: sessionReadModelLoadState,
      };
    } else if (selectedTask) {
      transcriptSource = { kind: "selected_task", readModelLoadState: sessionReadModelLoadState };
    } else {
      transcriptSource = { kind: "inactive" };
    }

    return deriveSelectedAgentSessionTranscriptState({
      source: transcriptSource,
      repoReadinessState,
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

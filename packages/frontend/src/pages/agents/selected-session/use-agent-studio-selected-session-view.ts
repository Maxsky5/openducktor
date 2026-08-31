import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useMemo } from "react";
import {
  firstLaunchAction,
  resolveBuildContinuationLaunchAction,
  type SessionLaunchActionId,
} from "@/features/session-start";
import { matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import { inactiveRepoRuntimeReadinessTarget } from "@/lib/repo-runtime-readiness";
import { useRepoRuntimeReadiness } from "@/lib/use-repo-runtime-readiness";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { useRuntimeAvailabilityContext } from "@/state/app-state-contexts";
import {
  useAgentOperations,
  useAgentSession,
  useAgentSessionReadModelState,
} from "@/state/app-state-provider";
import { useSessionRuntimeData } from "@/state/operations/agent-orchestrator/hooks/use-session-runtime-data";
import type { SessionRuntimeDataTarget } from "@/state/operations/agent-orchestrator/support/session-runtime-data-refs";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  type AgentStudioRouteSessionResolution,
  resolveAgentStudioViewSessionSelection,
} from "../agents-page-selection";
import type { AgentStudioSelectedSessionState } from "./selected-session-state";
import {
  deriveSelectedSessionRuntimeTarget,
  deriveSelectedSessionViewProjection,
} from "./selected-session-view-projection";

type UseAgentStudioSelectedSessionViewArgs = {
  workspaceRepoPath: string | null;
  selectedTask: TaskCard | null;
  sessionSummaries: AgentSessionSummary[];
  sessionExternalId: string | null;
  routeSessionResolution: AgentStudioRouteSessionResolution;
  hasExplicitRoleSelection: boolean;
  roleSelection: AgentRole;
  sessionlessRole: AgentRole;
  keepExplicitRoleSessionless: boolean;
  sessionIdentityFromRoute: AgentSessionIdentity | null;
  repoSettings: RepoSettingsInput | null;
  isLoadingRepoSettings: boolean;
};

export type AgentStudioSelectedSessionView = {
  selectedSession: AgentStudioSelectedSessionState;
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
};

const toSessionRuntimeDataTarget = (
  session: AgentSessionState | null,
  identity: AgentSessionIdentity | null,
  summary: AgentSessionSummary | null,
  workspaceRepoPath: string | null,
): SessionRuntimeDataTarget | null => {
  if (session) {
    return {
      identity: session,
      repoPath: session.repoPath,
      sessionAssociation: session.sessionAssociation,
      selectedModel: session.selectedModel,
    };
  }
  if (
    !identity ||
    !summary ||
    !workspaceRepoPath ||
    !matchesAgentSessionIdentity(summary, identity)
  ) {
    return null;
  }
  return {
    identity,
    repoPath: workspaceRepoPath,
    sessionAssociation: {
      kind: "workflow",
      taskId: summary.taskId,
      role: summary.role,
    },
    selectedModel: summary.selectedModel,
  };
};

export function useAgentStudioSelectedSessionView({
  workspaceRepoPath,
  selectedTask,
  sessionSummaries,
  sessionExternalId,
  routeSessionResolution,
  hasExplicitRoleSelection,
  roleSelection,
  sessionlessRole,
  keepExplicitRoleSessionless,
  sessionIdentityFromRoute,
  repoSettings,
  isLoadingRepoSettings,
}: UseAgentStudioSelectedSessionViewArgs): AgentStudioSelectedSessionView {
  const { readSessionTodos } = useAgentOperations();
  const { allRuntimeDefinitions: runtimeDefinitions, loadRepoRuntimeCatalog } =
    useRuntimeAvailabilityContext();
  const selection = useMemo(() => {
    return resolveAgentStudioViewSessionSelection({
      sessionSummaries,
      sessionExternalId,
      sessionIdentity: sessionIdentityFromRoute,
      hasExplicitRoleParam: hasExplicitRoleSelection,
      roleFromQuery: roleSelection,
      selectedTask,
      sessionlessRole,
      keepExplicitRoleSessionless,
    });
  }, [
    sessionExternalId,
    hasExplicitRoleSelection,
    keepExplicitRoleSessionless,
    roleSelection,
    sessionlessRole,
    sessionIdentityFromRoute,
    selectedTask,
    sessionSummaries,
  ]);

  const unresolvedRouteSessionExternalId =
    routeSessionResolution.kind === "pending" ||
    routeSessionResolution.kind === "missing" ||
    routeSessionResolution.kind === "failed"
      ? routeSessionResolution.sessionExternalId
      : null;
  const isUnresolvedExplicitRouteSession =
    sessionExternalId !== null && sessionExternalId === unresolvedRouteSessionExternalId;
  const selectedSessionIdentity = isUnresolvedExplicitRouteSession
    ? null
    : selection.sessionIdentity;
  const session = useAgentSession(selectedSessionIdentity);
  const loadedSession = useMemo(
    () => (matchesAgentSessionIdentity(session, selectedSessionIdentity) ? session : null),
    [selectedSessionIdentity, session],
  );
  const { getSessionFault, sessionReadModelLoadState } = useAgentSessionReadModelState();
  const selectedSessionFault = getSessionFault(selectedSessionIdentity);
  const runtimeTarget = useMemo(
    () =>
      isUnresolvedExplicitRouteSession
        ? inactiveRepoRuntimeReadinessTarget
        : deriveSelectedSessionRuntimeTarget({
            selectedSessionIdentity,
            selectedTask,
            role: selection.role,
            repoSettings,
            isLoadingRepoSettings,
          }),
    [
      isLoadingRepoSettings,
      isUnresolvedExplicitRouteSession,
      repoSettings,
      selectedSessionIdentity,
      selectedTask,
      selection.role,
    ],
  );
  const runtimeReadiness = useRepoRuntimeReadiness({
    hasWorkspace: workspaceRepoPath !== null,
    runtimeTarget,
  });
  const repoReadinessState = runtimeReadiness.state;
  const selectedSessionViewProjection = useMemo(() => {
    if (isUnresolvedExplicitRouteSession && routeSessionResolution.kind === "pending") {
      return {
        activityState: null,
        selectedModel: null,
        transcriptState: { kind: "session_loading", reason: "preparing" } as const,
        sessionAuxiliaryError: null,
      };
    }
    if (isUnresolvedExplicitRouteSession && routeSessionResolution.kind === "missing") {
      const missingSessionTask = selectedTask ? `task "${selectedTask.id}"` : "the selected task";
      return {
        activityState: null,
        selectedModel: null,
        transcriptState: {
          kind: "failed",
          message: `Agent session "${routeSessionResolution.sessionExternalId}" was not found for ${missingSessionTask}.`,
        } as const,
        sessionAuxiliaryError: null,
      };
    }
    if (isUnresolvedExplicitRouteSession && routeSessionResolution.kind === "failed") {
      return {
        activityState: null,
        selectedModel: null,
        transcriptState: {
          kind: "failed",
          message: routeSessionResolution.message,
        } as const,
        sessionAuxiliaryError: null,
      };
    }

    return deriveSelectedSessionViewProjection({
      session: loadedSession,
      selectedSessionIdentity,
      sessionSummary: selection.sessionSummary,
      selectedTask,
      sessionFault: selectedSessionFault,
      readModelLoadState: sessionReadModelLoadState,
      repoReadinessState,
    });
  }, [
    repoReadinessState,
    isUnresolvedExplicitRouteSession,
    routeSessionResolution,
    selectedSessionIdentity,
    selectedTask,
    loadedSession,
    selection.sessionSummary,
    selectedSessionFault,
    sessionReadModelLoadState,
  ]);
  const selectedSessionActivityState = selectedSessionViewProjection.activityState;
  const selectedSessionModel = selectedSessionViewProjection.selectedModel;
  const transcriptState = selectedSessionViewProjection.transcriptState;

  const launchActionId: SessionLaunchActionId =
    selection.role === "build"
      ? resolveBuildContinuationLaunchAction(selectedTask)
      : firstLaunchAction(selection.role);

  const runtimeData = useSessionRuntimeData({
    readinessRepoPath: workspaceRepoPath,
    selectedSession: toSessionRuntimeDataTarget(
      loadedSession,
      selectedSessionIdentity,
      selection.sessionSummary,
      workspaceRepoPath,
    ),
    runtimeDefinitions,
    repoReadinessState,
    loadRuntimeCatalog: loadRepoRuntimeCatalog,
    readSessionTodos,
  });

  const selectedSession = useMemo<AgentStudioSelectedSessionState>(
    () => ({
      identity: selectedSessionIdentity,
      activityState: selectedSessionActivityState,
      selectedModel: selectedSessionModel,
      loadedSession,
      runtimeData,
      runtimeReadiness,
      transcriptState,
      sessionAuxiliaryError: selectedSessionViewProjection.sessionAuxiliaryError,
    }),
    [
      transcriptState,
      runtimeReadiness,
      runtimeData,
      selectedSessionActivityState,
      selectedSessionIdentity,
      selectedSessionModel,
      selectedSessionViewProjection.sessionAuxiliaryError,
      loadedSession,
    ],
  );

  return useMemo<AgentStudioSelectedSessionView>(
    () => ({
      selectedSession,
      role: selection.role,
      launchActionId,
    }),
    [launchActionId, selectedSession, selection.role],
  );
}

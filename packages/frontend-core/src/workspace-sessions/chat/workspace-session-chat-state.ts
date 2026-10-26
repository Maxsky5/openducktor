import type { RuntimeReadinessState } from "../../lib/runtime-readiness";
import type { RuntimeDescriptor, WorkspaceSession } from "@openducktor/contracts";
import { agentSessionIdentityKey } from "../../lib/agent-session-identity";
import { workspaceSessionTitle } from "../../sessions/agent-orchestrator/session-read-model/workspace-session-records";
import { canResumeInterruptedTurn } from "../../lib/agent-session-interrupted-turn";
import {
  getAgentSessionActivityStateFromSession,
  isAgentSessionActivityWorking,
  isAgentSessionForegroundActive,
  visibleSessionActivity,
} from "../../lib/agent-session-activity-state";
import type { OptionalAgentSessionActivityState } from "../../types/agent-session-activity";
import type {
  AgentChatMessage,
  AgentSessionIdentity,
  AgentSessionState,
} from "../../types/agent-orchestrator";
import type { AgentSessionReadModelLoadState } from "../../types/agent-session-read-model";
import type { AgentSessionTransientFault } from "../../types/agent-session-transient-fault";
import {
  deriveLoadedAgentSessionTranscriptState,
  derivePendingSelectedSessionTranscriptState,
  type AgentSessionTranscriptState,
} from "../../sessions/agent-orchestrator/transcript/session-transcript-state";

export const resolveRuntimeDefinition = (
  runtimeDefinitions: readonly RuntimeDescriptor[],
  runtimeKind: WorkspaceSession["runtimeKind"],
): RuntimeDescriptor | null =>
  runtimeDefinitions.find((definition) => definition.kind === runtimeKind) ?? null;

export const canResumeWorkspaceSession = ({
  identity,
  isStarting,
  activityState,
  messages,
  runtimeDefinitions,
  runtimeKind,
}: {
  identity: AgentSessionIdentity | null;
  isStarting: boolean;
  activityState: OptionalAgentSessionActivityState;
  messages: readonly AgentChatMessage[];
  runtimeDefinitions: readonly RuntimeDescriptor[];
  runtimeKind: WorkspaceSession["runtimeKind"];
}): boolean =>
  identity !== null &&
  !isStarting &&
  canResumeInterruptedTurn({
    activityState,
    messages,
    runtimeDescriptor: resolveRuntimeDefinition(runtimeDefinitions, runtimeKind),
  });

export const canInteractWithWorkspaceSession = ({
  runtimeInteractionEnabled,
  observationReady,
  recordsError,
  targetFault,
}: {
  runtimeInteractionEnabled: boolean;
  observationReady: boolean;
  recordsError: string | null;
  targetFault: AgentSessionTransientFault | null;
}): boolean => runtimeInteractionEnabled && observationReady && !recordsError && !targetFault;

export function projectWorkspaceSessionChatState({
  record,
  identity,
  session,
  readModelLoadState,
  runtimeReadinessState,
  fault,
}: {
  record: WorkspaceSession;
  identity: AgentSessionIdentity | null;
  session: AgentSessionState | null;
  readModelLoadState: AgentSessionReadModelLoadState;
  runtimeReadinessState: RuntimeReadinessState;
  fault: AgentSessionTransientFault | null;
}) {
  const observationReady = readModelLoadState.kind === "ready";
  const targetFault = fault?.source === "workspace-target" ? fault : null;
  const observedActivity =
    session && observationReady ? getAgentSessionActivityStateFromSession(session) : null;
  const statusUnavailableReason =
    session?.statusUnavailableReason ?? (fault?.statusUnavailable ? fault.message : null);
  const activityState = visibleSessionActivity(observedActivity, statusUnavailableReason);
  const isWorking = isAgentSessionActivityWorking(activityState);
  let transcriptState: AgentSessionTranscriptState;
  if (!identity) {
    transcriptState = { kind: "empty", reason: "sessionless" };
  } else if (session) {
    transcriptState = deriveLoadedAgentSessionTranscriptState({ session, runtimeReadinessState });
  } else {
    transcriptState = derivePendingSelectedSessionTranscriptState({
      readModelLoadState,
      runtimeReadinessState,
    });
  }
  return {
    sessionKey: identity ? agentSessionIdentityKey(identity) : null,
    selectedModel: record.selectedModel ?? session?.selectedModel ?? null,
    transcriptSession:
      session && identity
        ? {
            ...identity,
            title: workspaceSessionTitle(record),
            activityState,
            runtimeStatusMessage: session.runtimeStatusMessage,
            messages: session.messages,
            pendingQuestions: session.pendingQuestions,
          }
        : null,
    transcriptTarget: identity
      ? { ...identity, sessionScope: { kind: "repository" as const } }
      : null,
    canStopSession:
      isAgentSessionActivityWorking(observedActivity) || observedActivity === "waiting_input",
    observationReady,
    targetFault,
    statusUnavailableReason,
    activityState,
    isWorking,
    foregroundTurnActive:
      session?.foregroundTurnActive === undefined
        ? undefined
        : isAgentSessionForegroundActive(session),
    transcriptState,
    pendingApprovals: session?.pendingApprovals ?? [],
    pendingQuestions: session?.pendingQuestions ?? [],
    isReadOnly:
      Boolean(targetFault) ||
      Boolean(session?.statusUnavailableReason) ||
      transcriptState.kind === "failed",
    readOnlyReason:
      targetFault?.message ??
      session?.statusUnavailableReason ??
      session?.runtimeStatusMessage ??
      (transcriptState.kind === "failed" ? "Retry loading this session before sending." : null),
  };
}

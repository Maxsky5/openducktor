import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-readiness";
import type { RuntimeDescriptor, WorkspaceSession } from "@openducktor/contracts";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { workspaceSessionTitle } from "@/state/operations/agent-orchestrator/session-read-model/workspace-session-records";
import { canResumeInterruptedTurn } from "@/lib/agent-session-interrupted-turn";
import {
  getAgentSessionActivityStateFromSession,
  isAgentSessionActivityWorking,
} from "@/lib/agent-session-activity-state";
import type { OptionalAgentSessionActivityState } from "@/types/agent-session-activity";
import type {
  AgentChatMessage,
  AgentSessionIdentity,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import type { AgentSessionReadModelLoadState } from "@/types/agent-session-read-model";
import type { AgentSessionTransientFault } from "@/types/agent-session-transient-fault";
import {
  deriveLoadedAgentSessionTranscriptState,
  derivePendingSelectedSessionTranscriptState,
  type AgentSessionTranscriptState,
} from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";

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
  isSavingModel,
}: {
  runtimeInteractionEnabled: boolean;
  observationReady: boolean;
  recordsError: string | null;
  targetFault: AgentSessionTransientFault | null;
  isSavingModel: boolean;
}): boolean =>
  runtimeInteractionEnabled && observationReady && !recordsError && !targetFault && !isSavingModel;

export function projectWorkspaceSessionChatState({
  record,
  identity,
  session,
  readModelLoadState,
  repoReadinessState,
  fault,
}: {
  record: WorkspaceSession;
  identity: AgentSessionIdentity | null;
  session: AgentSessionState | null;
  readModelLoadState: AgentSessionReadModelLoadState;
  repoReadinessState: RepoRuntimeReadinessState;
  fault: AgentSessionTransientFault | null;
}) {
  const observationReady = readModelLoadState.kind === "ready";
  const targetFault = fault?.source === "workspace-target" ? fault : null;
  const activityState =
    session && observationReady ? getAgentSessionActivityStateFromSession(session) : null;
  const isWorking = isAgentSessionActivityWorking(activityState);
  let transcriptState: AgentSessionTranscriptState;
  if (!identity) {
    transcriptState = { kind: "empty", reason: "sessionless" };
  } else if (session) {
    transcriptState = deriveLoadedAgentSessionTranscriptState({ session, repoReadinessState });
  } else {
    transcriptState = derivePendingSelectedSessionTranscriptState({
      readModelLoadState,
      repoReadinessState,
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
          }
        : null,
    transcriptTarget: identity
      ? { ...identity, sessionScope: { kind: "repository" as const } }
      : null,
    canStopSession: isWorking || activityState === "waiting_input",
    observationReady,
    targetFault,
    activityState,
    isWorking,
    transcriptState,
    pendingApprovals: session?.pendingApprovals ?? [],
    pendingQuestions: session?.pendingQuestions ?? [],
    isReadOnly: Boolean(targetFault) || transcriptState.kind === "failed",
    readOnlyReason:
      targetFault?.message ??
      session?.runtimeStatusMessage ??
      (transcriptState.kind === "failed" ? "Retry loading this session before sending." : null),
  };
}

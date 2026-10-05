import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { getAgentSessionActivityStateFromSession } from "@/lib/agent-session-activity-state";
import { matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import { resolveConfiguredAgentRuntimeKind } from "@/lib/repo-agent-defaults";
import {
  inactiveRuntimeReadinessTarget,
  type RuntimeReadinessState,
  type RuntimeReadinessTarget,
  runtimeReadinessTargetForRuntime,
  resolvingRuntimeReadinessTarget,
} from "@/lib/runtime-readiness";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import {
  type AgentSessionTranscriptState,
  deriveLoadedAgentSessionTranscriptState,
  derivePendingSelectedSessionTranscriptState,
  deriveSessionlessTaskTranscriptState,
} from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentSessionActivityState } from "@/types/agent-session-activity";
import type { AgentSessionReadModelLoadState } from "@/types/agent-session-read-model";
import type { AgentSessionTransientFault } from "@/types/agent-session-transient-fault";
import type { RepoSettingsInput } from "@/types/state-slices";

export type SelectedSessionViewProjection = {
  activityState: AgentSessionActivityState | null;
  selectedModel: AgentSessionState["selectedModel"];
  transcriptState: AgentSessionTranscriptState;
  sessionAuxiliaryError: string | null;
};

export const deriveSelectedSessionRuntimeTarget = ({
  selectedSessionIdentity,
  selectedTask,
  role,
  repoSettings,
  isLoadingRepoSettings,
}: {
  selectedSessionIdentity: AgentSessionIdentity | null;
  selectedTask: TaskCard | null;
  role: AgentRole;
  repoSettings: RepoSettingsInput | null;
  isLoadingRepoSettings: boolean;
}): RuntimeReadinessTarget => {
  if (selectedSessionIdentity) {
    return runtimeReadinessTargetForRuntime(selectedSessionIdentity.runtimeKind);
  }

  if (selectedTask) {
    return isLoadingRepoSettings
      ? resolvingRuntimeReadinessTarget
      : runtimeReadinessTargetForRuntime(resolveConfiguredAgentRuntimeKind(repoSettings, role));
  }

  return inactiveRuntimeReadinessTarget;
};

export const deriveSelectedSessionViewProjection = ({
  selectedSessionIdentity,
  session,
  sessionSummary,
  selectedTask,
  sessionFault,
  readModelLoadState,
  runtimeReadinessState,
}: {
  selectedSessionIdentity: AgentSessionIdentity | null;
  session: AgentSessionState | null;
  sessionSummary: AgentSessionSummary | null;
  selectedTask: TaskCard | null;
  sessionFault: AgentSessionTransientFault | null;
  readModelLoadState: AgentSessionReadModelLoadState;
  runtimeReadinessState: RuntimeReadinessState;
}): SelectedSessionViewProjection => {
  const readModelFailureMessage =
    readModelLoadState.kind === "failed" ? readModelLoadState.message : null;
  let sessionAuxiliaryError = readModelFailureMessage;

  if (sessionFault) {
    sessionAuxiliaryError = readModelFailureMessage
      ? `${sessionFault.message} ${readModelFailureMessage}`
      : sessionFault.message;
  }

  if (selectedSessionIdentity && matchesAgentSessionIdentity(session, selectedSessionIdentity)) {
    return {
      activityState: getAgentSessionActivityStateFromSession(session),
      selectedModel: session.selectedModel,
      transcriptState: deriveLoadedAgentSessionTranscriptState({
        session,
        runtimeReadinessState,
      }),
      sessionAuxiliaryError,
    };
  }

  if (selectedSessionIdentity) {
    return {
      activityState: sessionSummary?.activityState ?? null,
      selectedModel: sessionSummary?.selectedModel ?? null,
      transcriptState: sessionFault
        ? { kind: "failed", message: sessionFault.message }
        : derivePendingSelectedSessionTranscriptState({
            readModelLoadState,
            runtimeReadinessState,
          }),
      sessionAuxiliaryError,
    };
  }

  if (selectedTask) {
    return {
      activityState: null,
      selectedModel: null,
      transcriptState: deriveSessionlessTaskTranscriptState({
        readModelLoadState,
        runtimeReadinessState,
      }),
      sessionAuxiliaryError: null,
    };
  }

  return {
    activityState: null,
    selectedModel: null,
    transcriptState: { kind: "empty", reason: "inactive" },
    sessionAuxiliaryError: null,
  };
};

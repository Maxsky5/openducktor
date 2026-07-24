import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { getAgentSessionActivityStateFromSession } from "@/lib/agent-session-activity-state";
import { matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import { resolveConfiguredAgentRuntimeKind } from "@/lib/repo-agent-defaults";
import {
  inactiveRepoRuntimeReadinessTarget,
  type RepoRuntimeReadinessState,
  type RepoRuntimeReadinessTarget,
  repoRuntimeReadinessTargetForRuntime,
  resolvingRepoRuntimeReadinessTarget,
} from "@/lib/repo-runtime-readiness";
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
import type { RepoSettingsInput } from "@/types/state-slices";

export type SelectedSessionViewProjection = {
  activityState: AgentSessionActivityState | null;
  selectedModel: AgentSessionState["selectedModel"];
  transcriptState: AgentSessionTranscriptState;
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
}): RepoRuntimeReadinessTarget => {
  if (selectedSessionIdentity) {
    return repoRuntimeReadinessTargetForRuntime(selectedSessionIdentity.runtimeKind);
  }

  if (selectedTask) {
    return isLoadingRepoSettings
      ? resolvingRepoRuntimeReadinessTarget
      : repoRuntimeReadinessTargetForRuntime(resolveConfiguredAgentRuntimeKind(repoSettings, role));
  }

  return inactiveRepoRuntimeReadinessTarget;
};

export const deriveSelectedSessionViewProjection = ({
  selectedSessionIdentity,
  session,
  sessionSummary,
  selectedTask,
  readModelLoadState,
  repoReadinessState,
}: {
  selectedSessionIdentity: AgentSessionIdentity | null;
  session: AgentSessionState | null;
  sessionSummary: AgentSessionSummary | null;
  selectedTask: TaskCard | null;
  readModelLoadState: AgentSessionReadModelLoadState;
  repoReadinessState: RepoRuntimeReadinessState;
}): SelectedSessionViewProjection => {
  if (selectedSessionIdentity && matchesAgentSessionIdentity(session, selectedSessionIdentity)) {
    return {
      activityState: getAgentSessionActivityStateFromSession(session),
      selectedModel: session.selectedModel,
      transcriptState: deriveLoadedAgentSessionTranscriptState({
        session,
        repoReadinessState,
      }),
    };
  }

  if (selectedSessionIdentity) {
    return {
      activityState: sessionSummary?.activityState ?? null,
      selectedModel: sessionSummary?.selectedModel ?? null,
      transcriptState: derivePendingSelectedSessionTranscriptState({
        readModelLoadState,
        repoReadinessState,
      }),
    };
  }

  if (selectedTask) {
    return {
      activityState: null,
      selectedModel: null,
      transcriptState: deriveSessionlessTaskTranscriptState({
        readModelLoadState,
        repoReadinessState,
      }),
    };
  }

  return {
    activityState: null,
    selectedModel: null,
    transcriptState: { kind: "empty", reason: "inactive" },
  };
};

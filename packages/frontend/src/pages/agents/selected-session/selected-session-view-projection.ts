import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { getAgentSessionActivityStateFromSession } from "@/lib/agent-session-activity-state";
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
  deriveRuntimeBoundTranscriptEmptyState,
  deriveRuntimeBoundTranscriptLoadingState,
} from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentSessionActivityState } from "@/types/agent-session-activity";
import type { AgentSessionReadModelLoadState } from "@/types/agent-session-read-model";
import type { RepoSettingsInput } from "@/types/state-slices";

export type SelectedSessionViewProjection = {
  activityState: AgentSessionActivityState | null;
  selectedModel: AgentSessionState["selectedModel"];
  runtimeTarget: RepoRuntimeReadinessTarget;
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
  runtimeTarget,
  repoReadinessState,
}: {
  selectedSessionIdentity: AgentSessionIdentity | null;
  session: AgentSessionState | null;
  sessionSummary: AgentSessionSummary | null;
  selectedTask: TaskCard | null;
  readModelLoadState: AgentSessionReadModelLoadState;
  runtimeTarget: RepoRuntimeReadinessTarget;
  repoReadinessState: RepoRuntimeReadinessState;
}): SelectedSessionViewProjection => {
  if (selectedSessionIdentity && session) {
    return {
      activityState: getAgentSessionActivityStateFromSession(session),
      selectedModel: session.selectedModel,
      runtimeTarget,
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
      runtimeTarget,
      transcriptState:
        readModelLoadState.kind === "failed"
          ? { kind: "failed", message: readModelLoadState.message }
          : deriveRuntimeBoundTranscriptLoadingState({
              reason: "preparing",
              repoReadinessState,
            }),
    };
  }

  if (selectedTask) {
    return {
      activityState: null,
      selectedModel: null,
      runtimeTarget,
      transcriptState:
        readModelLoadState.kind === "failed"
          ? { kind: "failed", message: readModelLoadState.message }
          : readModelLoadState.kind === "loading"
            ? deriveRuntimeBoundTranscriptLoadingState({
                reason: "preparing",
                repoReadinessState,
              })
            : deriveRuntimeBoundTranscriptEmptyState({
                reason: "sessionless",
                repoReadinessState,
              }),
    };
  }

  return {
    activityState: null,
    selectedModel: null,
    runtimeTarget,
    transcriptState: { kind: "empty", reason: "inactive" },
  };
};

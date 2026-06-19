import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { getAgentSessionActivityStateFromSession } from "@/lib/agent-session-activity-state";
import { resolveConfiguredAgentRuntimeKind } from "@/lib/repo-agent-defaults";
import {
  inactiveRepoRuntimeReadinessTarget,
  type RepoRuntimeReadinessTarget,
  repoRuntimeReadinessTargetForRuntime,
  resolvingRepoRuntimeReadinessTarget,
} from "@/lib/repo-runtime-readiness";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import {
  type AgentSessionTranscriptSource,
  deriveLoadedAgentSessionTranscriptSource,
} from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentSessionActivityState } from "@/types/agent-session-activity";
import type { AgentSessionReadModelLoadState } from "@/types/agent-session-read-model";
import type { RepoSettingsInput } from "@/types/state-slices";

export type SelectedSessionViewProjection = {
  activityState: AgentSessionActivityState | null;
  selectedModel: AgentSessionState["selectedModel"];
  runtimeTarget: RepoRuntimeReadinessTarget;
  transcriptSource: AgentSessionTranscriptSource;
};

export const deriveSelectedSessionViewProjection = ({
  selectedSessionIdentity,
  session,
  sessionSummary,
  selectedTask,
  readModelLoadState,
  role,
  repoSettings,
  isLoadingRepoSettings,
}: {
  selectedSessionIdentity: AgentSessionIdentity | null;
  session: AgentSessionState | null;
  sessionSummary: AgentSessionSummary | null;
  selectedTask: TaskCard | null;
  readModelLoadState: AgentSessionReadModelLoadState;
  role: AgentRole;
  repoSettings: RepoSettingsInput | null;
  isLoadingRepoSettings: boolean;
}): SelectedSessionViewProjection => {
  if (selectedSessionIdentity && session) {
    return {
      activityState: getAgentSessionActivityStateFromSession(session),
      selectedModel: session.selectedModel,
      runtimeTarget: repoRuntimeReadinessTargetForRuntime(selectedSessionIdentity.runtimeKind),
      transcriptSource: deriveLoadedAgentSessionTranscriptSource(session),
    };
  }

  if (selectedSessionIdentity) {
    return {
      activityState: sessionSummary?.activityState ?? null,
      selectedModel: sessionSummary?.selectedModel ?? null,
      runtimeTarget: repoRuntimeReadinessTargetForRuntime(selectedSessionIdentity.runtimeKind),
      transcriptSource:
        readModelLoadState.kind === "failed"
          ? { kind: "failed", message: readModelLoadState.message }
          : { kind: "runtime_gated_loading", reason: "preparing" },
    };
  }

  if (selectedTask) {
    return {
      activityState: null,
      selectedModel: null,
      runtimeTarget: isLoadingRepoSettings
        ? resolvingRepoRuntimeReadinessTarget
        : repoRuntimeReadinessTargetForRuntime(
            resolveConfiguredAgentRuntimeKind(repoSettings, role),
          ),
      transcriptSource:
        readModelLoadState.kind === "failed"
          ? { kind: "failed", message: readModelLoadState.message }
          : readModelLoadState.kind === "loading"
            ? { kind: "runtime_gated_loading", reason: "preparing" }
            : { kind: "runtime_gated_empty", reason: "sessionless" },
    };
  }

  return {
    activityState: null,
    selectedModel: null,
    runtimeTarget: inactiveRepoRuntimeReadinessTarget,
    transcriptSource: { kind: "empty", reason: "inactive" },
  };
};

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

export type SelectedSessionViewSource =
  | {
      kind: "loaded_session";
      identity: AgentSessionIdentity;
      session: AgentSessionState;
    }
  | {
      kind: "selected_session";
      identity: AgentSessionIdentity;
      summary: AgentSessionSummary | null;
      readModelLoadState: AgentSessionReadModelLoadState;
    }
  | {
      kind: "selected_task";
      readModelLoadState: AgentSessionReadModelLoadState;
    }
  | { kind: "inactive" };

export type SelectedSessionViewProjection = {
  activityState: AgentSessionActivityState | null;
  selectedModel: AgentSessionState["selectedModel"];
  runtimeTarget: RepoRuntimeReadinessTarget;
  transcriptSource: AgentSessionTranscriptSource;
};

export const resolveSelectedSessionViewSource = ({
  selectedSessionIdentity,
  session,
  sessionSummary,
  selectedTask,
  readModelLoadState,
}: {
  selectedSessionIdentity: AgentSessionIdentity | null;
  session: AgentSessionState | null;
  sessionSummary: AgentSessionSummary | null;
  selectedTask: TaskCard | null;
  readModelLoadState: AgentSessionReadModelLoadState;
}): SelectedSessionViewSource => {
  if (selectedSessionIdentity && session) {
    return {
      kind: "loaded_session",
      identity: selectedSessionIdentity,
      session,
    };
  }

  if (selectedSessionIdentity) {
    return {
      kind: "selected_session",
      identity: selectedSessionIdentity,
      summary: sessionSummary,
      readModelLoadState,
    };
  }

  if (selectedTask) {
    return {
      kind: "selected_task",
      readModelLoadState,
    };
  }

  return { kind: "inactive" };
};

export const projectSelectedSessionViewSource = ({
  source,
  role,
  repoSettings,
  isLoadingRepoSettings,
}: {
  source: SelectedSessionViewSource;
  role: AgentRole;
  repoSettings: RepoSettingsInput | null;
  isLoadingRepoSettings: boolean;
}): SelectedSessionViewProjection => {
  if (source.kind === "loaded_session") {
    return {
      activityState: getAgentSessionActivityStateFromSession(source.session),
      selectedModel: source.session.selectedModel,
      runtimeTarget: repoRuntimeReadinessTargetForRuntime(source.identity.runtimeKind),
      transcriptSource: deriveLoadedAgentSessionTranscriptSource(source.session),
    };
  }

  if (source.kind === "selected_session") {
    return {
      activityState: source.summary?.activityState ?? null,
      selectedModel: source.summary?.selectedModel ?? null,
      runtimeTarget: repoRuntimeReadinessTargetForRuntime(source.identity.runtimeKind),
      transcriptSource:
        source.readModelLoadState.kind === "failed"
          ? { kind: "failed", message: source.readModelLoadState.message }
          : { kind: "runtime_gated_loading", reason: "preparing" },
    };
  }

  if (source.kind === "selected_task") {
    return {
      activityState: null,
      selectedModel: null,
      runtimeTarget: isLoadingRepoSettings
        ? resolvingRepoRuntimeReadinessTarget
        : repoRuntimeReadinessTargetForRuntime(
            resolveConfiguredAgentRuntimeKind(repoSettings, role),
          ),
      transcriptSource:
        source.readModelLoadState.kind === "failed"
          ? { kind: "failed", message: source.readModelLoadState.message }
          : source.readModelLoadState.kind === "loading"
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

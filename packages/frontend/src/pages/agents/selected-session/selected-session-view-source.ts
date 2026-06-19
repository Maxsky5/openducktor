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
  emptyAfterRuntimeReadyAgentSessionTranscriptState,
  emptyAgentSessionTranscriptState,
  failedAgentSessionTranscriptState,
  loadingAgentSessionTranscriptState,
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
    };
  }

  if (source.kind === "selected_session") {
    return {
      activityState: source.summary?.activityState ?? null,
      selectedModel: source.summary?.selectedModel ?? null,
      runtimeTarget: repoRuntimeReadinessTargetForRuntime(source.identity.runtimeKind),
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
    };
  }

  return {
    activityState: null,
    selectedModel: null,
    runtimeTarget: inactiveRepoRuntimeReadinessTarget,
  };
};

export const deriveSelectedSessionTranscriptState = ({
  source,
  repoReadinessState,
}: {
  source: SelectedSessionViewSource;
  repoReadinessState: RepoRuntimeReadinessState;
}): AgentSessionTranscriptState => {
  if (source.kind === "loaded_session") {
    return deriveLoadedAgentSessionTranscriptState({
      session: source.session,
      repoReadinessState,
    });
  }

  if (source.kind === "inactive") {
    return emptyAgentSessionTranscriptState("inactive");
  }

  if (source.readModelLoadState.kind === "failed") {
    return failedAgentSessionTranscriptState(source.readModelLoadState.message);
  }

  if (source.kind === "selected_session" || source.readModelLoadState.kind === "loading") {
    return loadingAgentSessionTranscriptState({
      reason: "preparing",
      repoReadinessState,
    });
  }

  return emptyAfterRuntimeReadyAgentSessionTranscriptState({
    reason: "sessionless",
    repoReadinessState,
  });
};

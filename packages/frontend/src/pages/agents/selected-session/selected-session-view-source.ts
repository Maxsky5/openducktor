import type { TaskCard } from "@openducktor/contracts";
import { getAgentSessionActivityStateFromSession } from "@/lib/agent-session-activity-state";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { SelectedAgentSessionTranscriptSource } from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentSessionActivityState } from "@/types/agent-session-activity";
import type { AgentSessionReadModelLoadState } from "@/types/agent-session-read-model";
import type { SelectedSessionRuntimeTargetSource } from "./selected-session-runtime-target";

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
  runtimeTargetSource: SelectedSessionRuntimeTargetSource;
  transcriptSource: SelectedAgentSessionTranscriptSource;
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

export const projectSelectedSessionViewSource = (
  source: SelectedSessionViewSource,
): SelectedSessionViewProjection => {
  if (source.kind === "loaded_session") {
    return {
      activityState: getAgentSessionActivityStateFromSession(source.session),
      selectedModel: source.session.selectedModel,
      runtimeTargetSource: {
        kind: "selected_session",
        runtimeKind: source.identity.runtimeKind,
      },
      transcriptSource: { kind: "loaded_session", session: source.session },
    };
  }

  if (source.kind === "selected_session") {
    return {
      activityState: source.summary?.activityState ?? null,
      selectedModel: source.summary?.selectedModel ?? null,
      runtimeTargetSource: {
        kind: "selected_session",
        runtimeKind: source.identity.runtimeKind,
      },
      transcriptSource: {
        kind: "selected_session",
        readModelLoadState: source.readModelLoadState,
      },
    };
  }

  if (source.kind === "selected_task") {
    return {
      activityState: null,
      selectedModel: null,
      runtimeTargetSource: { kind: "selected_task" },
      transcriptSource: {
        kind: "selected_task",
        readModelLoadState: source.readModelLoadState,
      },
    };
  }

  return {
    activityState: null,
    selectedModel: null,
    runtimeTargetSource: { kind: "inactive" },
    transcriptSource: { kind: "inactive" },
  };
};

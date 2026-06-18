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

export const selectedSessionActivityStateFromSource = (
  source: SelectedSessionViewSource,
): AgentSessionActivityState | null => {
  if (source.kind === "loaded_session") {
    return getAgentSessionActivityStateFromSession(source.session);
  }

  if (source.kind === "selected_session") {
    return source.summary?.activityState ?? null;
  }

  return null;
};

export const selectedSessionModelFromSource = (
  source: SelectedSessionViewSource,
): AgentSessionState["selectedModel"] => {
  if (source.kind === "loaded_session") {
    return source.session.selectedModel;
  }

  if (source.kind === "selected_session") {
    return source.summary?.selectedModel ?? null;
  }

  return null;
};

export const selectedSessionRuntimeTargetSourceFromViewSource = (
  source: SelectedSessionViewSource,
): SelectedSessionRuntimeTargetSource => {
  if (source.kind === "loaded_session" || source.kind === "selected_session") {
    return {
      kind: "selected_session",
      runtimeKind: source.identity.runtimeKind,
    };
  }

  if (source.kind === "selected_task") {
    return { kind: "selected_task" };
  }

  return { kind: "inactive" };
};

export const selectedSessionTranscriptSourceFromViewSource = (
  source: SelectedSessionViewSource,
): SelectedAgentSessionTranscriptSource => {
  if (source.kind === "loaded_session") {
    return { kind: "loaded_session", session: source.session };
  }

  if (source.kind === "selected_session") {
    return {
      kind: "selected_session",
      readModelLoadState: source.readModelLoadState,
    };
  }

  if (source.kind === "selected_task") {
    return {
      kind: "selected_task",
      readModelLoadState: source.readModelLoadState,
    };
  }

  return { kind: "inactive" };
};

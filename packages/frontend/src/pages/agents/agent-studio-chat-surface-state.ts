import type { AgentChatEmptyStateModel } from "@/components/features/agents/agent-chat/agent-chat.types";
import type { AgentSessionTranscriptState } from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import type { AgentStudioSelectedSessionContext } from "./selected-session/selected-session-context";

export type AgentStudioChatSurfaceState = {
  emptyState: AgentChatEmptyStateModel | null;
  composerReadOnly: boolean;
  composerReadOnlyReason: string | null;
};

type AgentStudioChatSurfaceSelectedSession = {
  taskId: string;
  activeSession: AgentStudioSelectedSessionContext["activeSession"];
  workflow: Pick<
    AgentStudioSelectedSessionContext["workflow"],
    "selectedRoleAvailable" | "selectedRoleReadOnlyReason"
  >;
};

type AgentStudioChatSurfaceSessionActions = {
  isStarting: boolean;
  canKickoffNewSession: boolean;
  kickoffLabel: string;
  startLaunchKickoff: () => Promise<void>;
};

type DeriveAgentStudioChatSurfaceStateInput = {
  selectedSession: AgentStudioChatSurfaceSelectedSession;
  transcriptState: AgentStudioSelectedSessionContext["runtime"]["transcriptState"];
  sessionActions: AgentStudioChatSurfaceSessionActions;
};

const deriveAgentStudioChatEmptyState = ({
  taskId,
  transcriptStateKind,
  isStarting,
  canKickoff,
  kickoffLabel,
  startLaunchKickoff,
}: {
  taskId: string;
  transcriptStateKind: AgentSessionTranscriptState["kind"];
  isStarting: boolean;
  canKickoff: boolean;
  kickoffLabel: string;
  startLaunchKickoff: () => Promise<void>;
}): AgentChatEmptyStateModel | null => {
  if (!taskId) {
    return {
      title: "Select a task to begin.",
    };
  }

  if (transcriptStateKind !== "empty") {
    return null;
  }

  if (isStarting) {
    return {
      title: "Initializing session...",
    };
  }

  if (canKickoff) {
    return {
      title: "Send a message to start a new session automatically.",
      actionLabel: kickoffLabel,
      onAction: (): void => {
        void startLaunchKickoff();
      },
    };
  }

  return {
    title: "Send a message to start a new session automatically.",
  };
};

export const deriveAgentStudioChatSurfaceState = ({
  selectedSession,
  transcriptState,
  sessionActions,
}: DeriveAgentStudioChatSurfaceStateInput): AgentStudioChatSurfaceState => {
  const composerReadOnly =
    !selectedSession.activeSession && !selectedSession.workflow.selectedRoleAvailable;

  return {
    emptyState: deriveAgentStudioChatEmptyState({
      taskId: selectedSession.taskId,
      transcriptStateKind: transcriptState.kind,
      isStarting: sessionActions.isStarting,
      canKickoff: sessionActions.canKickoffNewSession,
      kickoffLabel: sessionActions.kickoffLabel,
      startLaunchKickoff: sessionActions.startLaunchKickoff,
    }),
    composerReadOnly,
    composerReadOnlyReason: composerReadOnly
      ? selectedSession.workflow.selectedRoleReadOnlyReason
      : null,
  };
};

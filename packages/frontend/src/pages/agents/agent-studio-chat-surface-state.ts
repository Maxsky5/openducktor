import type { AgentChatEmptyStateModel } from "@/components/features/agents/agent-chat/agent-chat.types";
import type { AgentSessionTranscriptState } from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";
import type { AgentStudioSelectedSessionContext } from "./selected-session/selected-session-context";

export type AgentStudioChatSurfaceState = {
  emptyState: AgentChatEmptyStateModel | null;
  composerReadOnly: boolean;
  composerReadOnlyReason: string | null;
};

type DeriveAgentStudioChatSurfaceStateInput = {
  taskId: string;
  selectedSessionKey: string | null;
  transcriptState: AgentStudioSelectedSessionContext["transcriptState"];
  workflow: Pick<
    AgentStudioSelectedSessionContext["workflow"],
    "selectedRoleAvailable" | "selectedRoleReadOnlyReason"
  >;
  isStarting: boolean;
  canKickoffNewSession: boolean;
  kickoffLabel: string;
  startLaunchKickoff: () => Promise<void>;
};

const deriveAgentStudioChatEmptyState = ({
  taskId,
  transcriptState,
  isStarting,
  canKickoff,
  kickoffLabel,
  startLaunchKickoff,
}: {
  taskId: string;
  transcriptState: AgentSessionTranscriptState;
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

  if (transcriptState.kind !== "empty") {
    return null;
  }

  if (transcriptState.reason === "unavailable") {
    return {
      title: "Conversation unavailable.",
    };
  }

  if (isStarting) {
    return {
      title: "Initializing session...",
    };
  }

  if (transcriptState.reason !== "sessionless") {
    return null;
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
  taskId,
  selectedSessionKey,
  transcriptState,
  workflow,
  isStarting,
  canKickoffNewSession,
  kickoffLabel,
  startLaunchKickoff,
}: DeriveAgentStudioChatSurfaceStateInput): AgentStudioChatSurfaceState => {
  const composerReadOnly = selectedSessionKey === null && !workflow.selectedRoleAvailable;

  return {
    emptyState: deriveAgentStudioChatEmptyState({
      taskId,
      transcriptState,
      isStarting,
      canKickoff: canKickoffNewSession,
      kickoffLabel,
      startLaunchKickoff,
    }),
    composerReadOnly,
    composerReadOnlyReason: composerReadOnly ? workflow.selectedRoleReadOnlyReason : null,
  };
};

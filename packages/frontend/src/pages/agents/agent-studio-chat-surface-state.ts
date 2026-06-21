import type { AgentChatEmptyStateModel } from "@/components/features/agents/agent-chat/agent-chat.types";
import type { AgentSessionTranscriptState } from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";

export type AgentStudioChatSurfaceState = {
  emptyState: AgentChatEmptyStateModel | null;
  composerReadOnly: boolean;
  composerReadOnlyReason: string | null;
};

type AgentStudioChatWorkflowState = {
  selectedRoleAvailable: boolean;
  selectedRoleReadOnlyReason: string | null;
};

type DeriveAgentStudioChatSurfaceStateInput = {
  taskId: string;
  selectedSessionKey: string | null;
  transcriptState: AgentSessionTranscriptState;
  workflow: AgentStudioChatWorkflowState;
  isStarting: boolean;
  canUseKickoffPrompt: boolean;
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
  canUseKickoffPrompt,
  kickoffLabel,
  startLaunchKickoff,
}: DeriveAgentStudioChatSurfaceStateInput): AgentStudioChatSurfaceState => {
  const composerReadOnly = selectedSessionKey === null && !workflow.selectedRoleAvailable;

  return {
    emptyState: deriveAgentStudioChatEmptyState({
      taskId,
      transcriptState,
      isStarting,
      canKickoff: canUseKickoffPrompt,
      kickoffLabel,
      startLaunchKickoff,
    }),
    composerReadOnly,
    composerReadOnlyReason: composerReadOnly ? workflow.selectedRoleReadOnlyReason : null,
  };
};

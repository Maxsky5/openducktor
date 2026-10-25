import type { AgentChatEmptyStateModel } from "@/components/features/agents/agent-chat/agent-chat.types";
import type { AgentSessionTranscriptState } from "@openducktor/frontend-core/sessions/agent-orchestrator/transcript/session-transcript-state";
import type { AgentStudioSelectedSessionState } from "./selected-session/selected-session-state";

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
  const hasTask = taskId.length > 0;
  const composerReadOnly =
    !hasTask || (selectedSessionKey === null && !workflow.selectedRoleAvailable);
  const composerReadOnlyReason = hasTask
    ? workflow.selectedRoleReadOnlyReason
    : "Select a task to begin.";

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
    composerReadOnlyReason: composerReadOnly ? composerReadOnlyReason : null,
  };
};

export const resolveAgentStudioChatAuxiliaryError = ({
  forkError,
  transcriptRecoveryError,
  session,
  canResumeSession,
  persistentResumeError,
}: {
  forkError: string | null;
  transcriptRecoveryError: string | null;
  session: Pick<AgentStudioSelectedSessionState, "sessionAuxiliaryError" | "runtimeData">;
  canResumeSession: boolean;
  persistentResumeError: string | null;
}): string | null =>
  forkError ??
  transcriptRecoveryError ??
  session.sessionAuxiliaryError ??
  session.runtimeData.contextError ??
  session.runtimeData.runtimePolicyError ??
  session.runtimeData.todosError ??
  session.runtimeData.catalogError ??
  (canResumeSession ? null : persistentResumeError);

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
      title: "Choose a runtime and model, then send your first message to start a session.",
      actionLabel: kickoffLabel,
      onAction: (): void => {
        void startLaunchKickoff();
      },
    };
  }

  return {
    title: "Choose a runtime and model, then send your first message to start a session.",
  };
};

import { toast } from "sonner";
import { NEW_BUILDER_SESSION_TARGET } from "@/features/human-review-feedback/human-review-feedback-state";
import type { HumanReviewFeedbackState } from "@/features/human-review-feedback/human-review-feedback-types";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { KanbanSessionStartIntent } from "./kanban-page-model-types";

type ConfirmHumanReviewFeedbackFlowInput = {
  state: HumanReviewFeedbackState;
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
  loadAgentSessions: (
    taskId: string,
    options?: { hydrateHistoryForSessionId?: string },
  ) => Promise<void>;
  openSessionStartModal: (intent: KanbanSessionStartIntent) => void;
  openAgentStudioSession: (taskId: string, session: AgentSessionState) => void;
  sendAgentMessage: (sessionId: string, message: string) => Promise<void>;
  onDismiss: () => void;
};

export const confirmHumanReviewFeedbackFlow = async ({
  state,
  humanRequestChangesTask,
  loadAgentSessions,
  openSessionStartModal,
  openAgentStudioSession,
  sendAgentMessage,
  onDismiss,
}: ConfirmHumanReviewFeedbackFlowInput): Promise<void> => {
  const trimmedMessage = state.message.trim();
  if (trimmedMessage.length === 0) {
    toast.error("Feedback message is required.");
    return;
  }

  if (state.selectedTarget === NEW_BUILDER_SESSION_TARGET) {
    onDismiss();
    openSessionStartModal({
      taskId: state.taskId,
      role: "build",
      scenario: state.scenario,
      startMode: "fresh",
      postStartAction: "send_message",
      message: trimmedMessage,
      beforeStartAction: {
        action: "human_request_changes",
        note: trimmedMessage,
      },
    });
    return;
  }

  const existingBuilderSession = state.builderSessions.find(
    (session) => session.sessionId === state.selectedTarget,
  );
  if (!existingBuilderSession) {
    toast.error("The selected builder session is no longer available for this task.");
    return;
  }

  await humanRequestChangesTask(state.taskId, trimmedMessage);
  await loadAgentSessions(state.taskId, {
    hydrateHistoryForSessionId: existingBuilderSession.sessionId,
  });
  onDismiss();
  openAgentStudioSession(state.taskId, existingBuilderSession);

  try {
    await sendAgentMessage(existingBuilderSession.sessionId, trimmedMessage);
  } catch {
    toast.error("Changes requested, but feedback message failed.");
  }
};

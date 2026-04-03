import type { AgentUserMessagePart } from "@openducktor/core";
import { toast } from "sonner";
import { NEW_BUILDER_SESSION_TARGET } from "@/features/human-review-feedback/human-review-feedback-state";
import type { HumanReviewFeedbackState } from "@/features/human-review-feedback/human-review-feedback-types";
import { buildReusableSessionOptions } from "@/features/session-start";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { KanbanSessionStartIntent } from "./kanban-page-model-types";

type ConfirmHumanReviewFeedbackFlowInput = {
  state: HumanReviewFeedbackState;
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
  hydrateRequestedTaskSessionHistory: (input: {
    taskId: string;
    sessionId: string;
  }) => Promise<void>;
  openSessionStartModal: (intent: KanbanSessionStartIntent) => void;
  openAgentStudioSession: (taskId: string, session: AgentSessionSummary) => void;
  sendAgentMessage: (sessionId: string, parts: AgentUserMessagePart[]) => Promise<void>;
  onDismiss: () => void;
};

export const confirmHumanReviewFeedbackFlow = async ({
  state,
  humanRequestChangesTask,
  hydrateRequestedTaskSessionHistory,
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
      initialStartMode: "fresh",
      existingSessionOptions: buildReusableSessionOptions({
        sessions: state.builderSessions,
        role: "build",
      }),
      ...(state.builderSessions[0]?.sessionId
        ? { sourceSessionId: state.builderSessions[0].sessionId }
        : {}),
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
  onDismiss();
  openAgentStudioSession(state.taskId, existingBuilderSession);

  try {
    await hydrateRequestedTaskSessionHistory({
      taskId: state.taskId,
      sessionId: existingBuilderSession.sessionId,
    });
  } catch {
    toast.error("Changes requested, but refreshing Builder sessions failed.");
  }

  try {
    await sendAgentMessage(existingBuilderSession.sessionId, [
      { kind: "text", text: trimmedMessage },
    ]);
  } catch {
    toast.error("Changes requested, but feedback message failed.");
  }
};

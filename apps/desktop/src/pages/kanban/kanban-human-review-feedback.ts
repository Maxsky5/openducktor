import type { TaskCard } from "@openducktor/contracts";
import { toast } from "sonner";
import type { BuildRequestChangesScenario } from "@/lib/build-scenarios";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type {
  HumanReviewFeedbackModalModel,
  KanbanSessionStartIntent,
} from "./kanban-page-model-types";
import {
  buildHumanReviewMessage,
  resolveRequestChangesScenario,
} from "./kanban-session-start-actions";

export const NEW_BUILDER_SESSION_TARGET = "new_session";

export type HumanReviewFeedbackState = {
  taskId: string;
  scenario: BuildRequestChangesScenario;
  message: string;
  builderSessions: AgentSessionState[];
  selectedTarget: string;
};

export type PendingHumanReviewHydration = {
  taskId: string;
  baselineSessions: AgentSessionState[];
};

export const createHumanReviewFeedbackState = (
  tasks: TaskCard[],
  taskId: string,
  builderSessions: AgentSessionState[],
): HumanReviewFeedbackState => {
  const task = tasks.find((entry) => entry.id === taskId);
  const scenario = resolveRequestChangesScenario(task);

  return {
    taskId,
    scenario,
    message: buildHumanReviewMessage(task, taskId, scenario),
    builderSessions,
    selectedTarget: builderSessions[0]?.sessionId ?? NEW_BUILDER_SESSION_TARGET,
  };
};

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

type BuildHumanReviewFeedbackModalModelInput = {
  state: HumanReviewFeedbackState;
  isSubmitting: boolean;
  onDismiss: () => void;
  onTargetChange: (selectedTarget: string) => void;
  onMessageChange: (message: string) => void;
  onConfirm: () => void;
};

export const buildHumanReviewFeedbackModalModel = ({
  state,
  isSubmitting,
  onDismiss,
  onTargetChange,
  onMessageChange,
  onConfirm,
}: BuildHumanReviewFeedbackModalModelInput): HumanReviewFeedbackModalModel => {
  const targetOptions = [
    {
      value: NEW_BUILDER_SESSION_TARGET,
      label: "Start a new builder session",
      description:
        "Open session setup, pick the model, then send this feedback as the first message.",
    },
    ...state.builderSessions.map((session, index) => ({
      value: session.sessionId,
      label: `Builder session ${session.sessionId.slice(0, 8)}`,
      description: `Started ${new Date(session.startedAt).toLocaleString()} (${session.status}).`,
      ...(index === 0 ? { secondaryLabel: "Latest" } : {}),
    })),
  ];

  return {
    open: true,
    taskId: state.taskId,
    selectedTarget: state.selectedTarget,
    targetOptions,
    message: state.message,
    isSubmitting,
    onOpenChange: (nextOpen: boolean) => {
      if (!nextOpen) {
        onDismiss();
      }
    },
    onTargetChange,
    onMessageChange,
    onConfirm,
  };
};

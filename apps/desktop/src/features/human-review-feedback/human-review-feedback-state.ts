import type { TaskCard } from "@openducktor/contracts";
import { kickoffPromptForScenario } from "@/features/session-start";
import {
  type BuildRequestChangesScenario,
  resolveBuildRequestChangesScenario,
} from "@/lib/build-scenarios";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type {
  HumanReviewFeedbackModalModel,
  HumanReviewFeedbackState,
} from "./human-review-feedback-types";

export const NEW_BUILDER_SESSION_TARGET = "new_session";

const toPromptTaskContext = (task: TaskCard | undefined) => {
  if (!task) {
    return {};
  }

  return {
    title: task.title,
    issueType: task.issueType,
    status: task.status,
    qaRequired: task.aiReviewEnabled,
    description: task.description,
  };
};

const resolveRequestChangesScenario = (task: TaskCard | undefined): BuildRequestChangesScenario => {
  return resolveBuildRequestChangesScenario(task);
};

const buildHumanReviewMessage = (
  task: TaskCard | undefined,
  taskId: string,
  scenario: BuildRequestChangesScenario,
): string => {
  return kickoffPromptForScenario("build", scenario, taskId, {
    task: toPromptTaskContext(task),
  });
};

export const createHumanReviewFeedbackState = (
  tasks: TaskCard[],
  taskId: string,
  builderSessions: AgentSessionSummary[],
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

type BuildHumanReviewFeedbackModalModelInput = {
  state: HumanReviewFeedbackState;
  isSubmitting: boolean;
  onDismiss: () => void;
  onTargetChange: (selectedTarget: string) => void;
  onMessageChange: (message: string) => void;
  onConfirm: () => Promise<void>;
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

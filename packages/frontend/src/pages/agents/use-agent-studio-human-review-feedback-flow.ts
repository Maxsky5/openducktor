import type { ResolvedTaskCard as TaskCard } from "@openducktor/workflows";
import { useCallback, useMemo } from "react";
import { sonnerFeedback } from "@/lib/sonner-feedback";
import type { HumanReviewFeedbackStartRequest } from "@openducktor/frontend-core/tasks/workflow/human-review-feedback-flow";
import type { HumanReviewFeedbackModalModel } from "@openducktor/frontend-core/tasks/workflow/human-review-feedback-types";
import {
  useHumanReviewFeedbackForm,
  useHumanReviewFeedbackState,
} from "@openducktor/frontend-core/tasks/workflow/use-human-review-feedback";
import type { AgentSessionSummary } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import type { SessionCreateOption } from "./agents-page-session-tabs";

type UseAgentStudioHumanReviewFeedbackFlowArgs = {
  taskId: string;
  workspaceRepoPath: string | null;
  workspaceId: string | null;
  sessionsForTask: AgentSessionSummary[];
  selectedTask: TaskCard | null;
  startSessionRequest: (
    request: HumanReviewFeedbackStartRequest,
  ) => Promise<AgentSessionIdentity | undefined>;
};

type UseAgentStudioHumanReviewFeedbackFlowResult = {
  humanReviewFeedbackModal: HumanReviewFeedbackModalModel | null;
  shouldInterceptCreateSession: (option: SessionCreateOption) => boolean;
  openHumanReviewFeedback: (launchActionId: string) => void;
};

/** The shared human feedback form for the selected task of Agent Studio. */
export function useAgentStudioHumanReviewFeedbackFlow({
  taskId,
  workspaceRepoPath,
  workspaceId,
  sessionsForTask,
  selectedTask,
  startSessionRequest,
}: UseAgentStudioHumanReviewFeedbackFlowArgs): UseAgentStudioHumanReviewFeedbackFlowResult {
  const tasks = useMemo(() => (selectedTask ? [selectedTask] : []), [selectedTask]);
  const feedbackForm = useHumanReviewFeedbackState(tasks);
  const scope = useMemo(
    () => (workspaceId && workspaceRepoPath ? { workspaceId, repoPath: workspaceRepoPath } : null),
    [workspaceId, workspaceRepoPath],
  );
  const humanReviewFeedbackModal = useHumanReviewFeedbackForm(feedbackForm, {
    scope,
    feedback: sonnerFeedback,
    sessions: sessionsForTask,
    startSession: startSessionRequest,
  });

  const shouldInterceptCreateSession = useCallback(
    (option: SessionCreateOption): boolean =>
      selectedTask !== null &&
      selectedTask.taskWorkflow.launchAction(option.launchActionId).context === "human_feedback",
    [selectedTask],
  );
  const { open } = feedbackForm;
  const openHumanReviewFeedback = useCallback(
    (launchActionId: string): void => {
      if (taskId) open(taskId, launchActionId);
    },
    [open, taskId],
  );

  return { humanReviewFeedbackModal, shouldInterceptCreateSession, openHumanReviewFeedback };
}

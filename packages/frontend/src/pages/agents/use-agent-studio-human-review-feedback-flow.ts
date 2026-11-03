import {
  type WorkflowLaunchActionId as SessionLaunchActionId,
  type ResolvedTaskCard as TaskCard,
} from "@openducktor/workflows";
import type { SessionCreateOption } from "./agents-page-session-tabs";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { sonnerFeedback } from "@/lib/sonner-feedback";
import { useQueryClient } from "@tanstack/react-query";
import {
  requestHumanReviewChanges,
  submitHumanReviewFeedback,
} from "@openducktor/frontend-core/tasks/workflow/human-review-feedback-flow";
import {
  buildHumanReviewFeedbackModalModel,
  createHumanReviewFeedbackState,
} from "@openducktor/frontend-core/tasks/workflow/human-review-feedback-state";
import type { HumanReviewFeedbackModalModel } from "@openducktor/frontend-core/tasks/workflow/human-review-feedback-types";
import { useHumanReviewFeedbackController } from "@openducktor/frontend-core/tasks/workflow/use-human-review-feedback-controller";
import type { SessionStartExistingSessionOption } from "@openducktor/frontend-core/sessions/start/session-start-types";
import type { SessionStartLaunchRequest } from "@openducktor/frontend-core/sessions/start/session-start-orchestration";
import type {
  SessionStartPostAction,
  SessionStartWorkflowResult,
} from "@openducktor/frontend-core/sessions/start/session-start-workflow";
import type { AgentSessionSummary } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";

type UseAgentStudioHumanReviewFeedbackFlowArgs = {
  taskId: string;
  workspaceRepoPath: string | null;
  workspaceId: string | null;
  sessionsForTask: AgentSessionSummary[];
  selectedTask: TaskCard | null;
  startSessionRequest: (
    request: HumanReviewSessionStartRequest,
  ) => Promise<SessionStartWorkflowResult | undefined>;
};

type HumanReviewSessionStartRequest = SessionStartLaunchRequest & {
  role: string;
  launchActionId: SessionLaunchActionId;
  existingSessionOptions: SessionStartExistingSessionOption[];
  initialSourceSession?: AgentSessionIdentity | null;
  postStartAction: SessionStartPostAction;
};

type UseAgentStudioHumanReviewFeedbackFlowResult = {
  humanReviewFeedbackModal: HumanReviewFeedbackModalModel | null;
  shouldInterceptCreateSession: (option: SessionCreateOption) => boolean;
  openHumanReviewFeedback: (launchActionId: string) => void;
};

export function useAgentStudioHumanReviewFeedbackFlow({
  taskId,
  workspaceRepoPath,
  workspaceId,
  sessionsForTask,
  selectedTask,
  startSessionRequest,
}: UseAgentStudioHumanReviewFeedbackFlowArgs): UseAgentStudioHumanReviewFeedbackFlowResult {
  const queryClient = useQueryClient();
  const selectedTaskRef = useRef(selectedTask);
  const [isSubmittingHumanReviewFeedback, setIsSubmittingHumanReviewFeedback] = useState(false);

  useLayoutEffect(() => {
    selectedTaskRef.current = selectedTask;
  }, [selectedTask]);

  const {
    clearHumanReviewFeedback,
    humanReviewFeedbackState,
    openHumanReviewFeedback,
    setHumanReviewFeedbackState,
  } = useHumanReviewFeedbackController({
    createState: (feedbackTaskId, launchActionId, requestChangesBeforeStart) =>
      createHumanReviewFeedbackState(
        selectedTaskRef.current ? [selectedTaskRef.current] : [],
        feedbackTaskId,
        launchActionId,
        requestChangesBeforeStart,
      ),
  });

  const shouldInterceptCreateSession = useCallback(
    (option: SessionCreateOption): boolean => {
      return (
        selectedTask !== null &&
        selectedTask.taskWorkflow.launchAction(option.launchActionId).context === "human_feedback"
      );
    },
    [selectedTask],
  );

  const dismissHumanReviewFeedback = useCallback((): void => {
    if (isSubmittingHumanReviewFeedback) {
      return;
    }

    clearHumanReviewFeedback();
  }, [clearHumanReviewFeedback, isSubmittingHumanReviewFeedback]);

  const openHumanReviewFeedbackForCurrentTask = useCallback(
    (launchActionId: string): void => {
      if (!taskId) {
        return;
      }

      openHumanReviewFeedback(taskId, launchActionId);
    },
    [openHumanReviewFeedback, taskId],
  );

  const confirmHumanReviewFeedback = useCallback(async (): Promise<void> => {
    if (!humanReviewFeedbackState) {
      return;
    }

    setIsSubmittingHumanReviewFeedback(true);
    try {
      const result = await submitHumanReviewFeedback({
        feedback: sonnerFeedback,
        state: humanReviewFeedbackState,
        requestChangesTask: (taskId, note) =>
          requestHumanReviewChanges(
            queryClient,
            workspaceId && workspaceRepoPath ? { workspaceId, repoPath: workspaceRepoPath } : null,
            taskId,
            note,
          ),
        builderSessions: sessionsForTask,
        startRequestChangesSession: async (request) => {
          const startRequest: HumanReviewSessionStartRequest = {
            taskId: request.taskId,
            role: request.role,
            launchActionId: request.launchActionId,
            existingSessionOptions: request.existingSessionOptions,
            postStartAction: request.postStartAction,
            humanFeedback: request.humanFeedback,
          };
          if (request.initialSourceSession !== undefined) {
            startRequest.initialSourceSession = request.initialSourceSession;
          }
          if (request.initialStartMode) {
            startRequest.initialStartMode = request.initialStartMode;
          }

          return startSessionRequest(startRequest);
        },
      });
      if (result.outcome !== "cancelled") {
        clearHumanReviewFeedback();
      }
    } catch (error) {
      toast.error("Failed to submit feedback.", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsSubmittingHumanReviewFeedback(false);
    }
  }, [
    clearHumanReviewFeedback,
    humanReviewFeedbackState,
    sessionsForTask,
    startSessionRequest,
    queryClient,
    workspaceRepoPath,
    workspaceId,
  ]);

  const humanReviewFeedbackModal = useMemo<HumanReviewFeedbackModalModel | null>(() => {
    if (!humanReviewFeedbackState) {
      return null;
    }

    return buildHumanReviewFeedbackModalModel({
      state: humanReviewFeedbackState,
      isSubmitting: isSubmittingHumanReviewFeedback,
      onDismiss: dismissHumanReviewFeedback,
      onMessageChange: (message: string) => {
        setHumanReviewFeedbackState((current) => (current ? { ...current, message } : current));
      },
      onConfirm: confirmHumanReviewFeedback,
    });
  }, [
    confirmHumanReviewFeedback,
    dismissHumanReviewFeedback,
    humanReviewFeedbackState,
    isSubmittingHumanReviewFeedback,
    setHumanReviewFeedbackState,
  ]);

  return {
    humanReviewFeedbackModal,
    shouldInterceptCreateSession,
    openHumanReviewFeedback: openHumanReviewFeedbackForCurrentTask,
  };
}

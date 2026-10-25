import type { TaskCard } from "@openducktor/contracts";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { sonnerFeedback } from "@/lib/sonner-feedback";
import { submitHumanReviewFeedback } from "@openducktor/frontend-core/tasks/workflow/human-review-feedback-flow";
import {
  buildHumanReviewFeedbackModalModel,
  createHumanReviewFeedbackState,
} from "@openducktor/frontend-core/tasks/workflow/human-review-feedback-state";
import type { HumanReviewFeedbackModalModel } from "@openducktor/frontend-core/tasks/workflow/human-review-feedback-types";
import { useHumanReviewFeedbackController } from "@openducktor/frontend-core/tasks/workflow/use-human-review-feedback-controller";
import type { SessionLaunchActionId } from "@openducktor/frontend-core/lib/session-launch-actions";
import type { SessionStartExistingSessionOption } from "@openducktor/frontend-core/sessions/start/session-start-types";
import type { SessionStartLaunchRequest } from "@openducktor/frontend-core/sessions/start/session-start-orchestration";
import type {
  SessionStartPostAction,
  SessionStartWorkflowResult,
} from "@openducktor/frontend-core/sessions/start/session-start-workflow";
import type { AgentSessionSummary } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import type { SessionCreateOption } from "./agents-page-session-tabs";

type UseAgentStudioHumanReviewFeedbackFlowArgs = {
  taskId: string;
  sessionsForTask: AgentSessionSummary[];
  selectedTask: TaskCard | null;
  startSessionRequest: (
    request: HumanReviewSessionStartRequest,
  ) => Promise<SessionStartWorkflowResult | undefined>;
};

type HumanReviewSessionStartRequest = SessionStartLaunchRequest & {
  role: "build";
  launchActionId: SessionLaunchActionId;
  existingSessionOptions: SessionStartExistingSessionOption[];
  initialSourceSession?: AgentSessionIdentity | null;
  postStartAction: SessionStartPostAction;
};

type UseAgentStudioHumanReviewFeedbackFlowResult = {
  humanReviewFeedbackModal: HumanReviewFeedbackModalModel | null;
  shouldInterceptCreateSession: (option: SessionCreateOption) => boolean;
  openHumanReviewFeedback: () => void;
};

export function useAgentStudioHumanReviewFeedbackFlow({
  taskId,
  sessionsForTask,
  selectedTask,
  startSessionRequest,
}: UseAgentStudioHumanReviewFeedbackFlowArgs): UseAgentStudioHumanReviewFeedbackFlowResult {
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
    createState: (feedbackTaskId) =>
      createHumanReviewFeedbackState(
        selectedTaskRef.current ? [selectedTaskRef.current] : [],
        feedbackTaskId,
      ),
  });

  const shouldInterceptCreateSession = useCallback((option: SessionCreateOption): boolean => {
    return option.role === "build" && option.launchActionId === "build_after_human_request_changes";
  }, []);

  const dismissHumanReviewFeedback = useCallback((): void => {
    if (isSubmittingHumanReviewFeedback) {
      return;
    }

    clearHumanReviewFeedback();
  }, [clearHumanReviewFeedback, isSubmittingHumanReviewFeedback]);

  const openHumanReviewFeedbackForCurrentTask = useCallback((): void => {
    if (!taskId) {
      return;
    }

    openHumanReviewFeedback(taskId);
  }, [openHumanReviewFeedback, taskId]);

  const confirmHumanReviewFeedback = useCallback(async (): Promise<void> => {
    if (!humanReviewFeedbackState) {
      return;
    }

    setIsSubmittingHumanReviewFeedback(true);
    try {
      const result = await submitHumanReviewFeedback({
        feedback: sonnerFeedback,
        state: humanReviewFeedbackState,
        builderSessions: sessionsForTask,
        startRequestChangesSession: async (request) => {
          const startRequest: HumanReviewSessionStartRequest = {
            taskId: request.taskId,
            role: request.role,
            launchActionId: request.launchActionId,
            existingSessionOptions: request.existingSessionOptions,
            postStartAction: request.postStartAction,
            message: request.message,
            beforeStartAction: request.beforeStartAction,
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
      if (result.outcome === "started") {
        clearHumanReviewFeedback();
      }
    } catch (error) {
      toast.error("Failed to prepare the Builder session.", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsSubmittingHumanReviewFeedback(false);
    }
  }, [clearHumanReviewFeedback, humanReviewFeedbackState, sessionsForTask, startSessionRequest]);

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

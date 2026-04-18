import type { TaskCard } from "@openducktor/contracts";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { submitHumanReviewFeedback } from "@/features/human-review-feedback/human-review-feedback-flow";
import {
  buildHumanReviewFeedbackModalModel,
  createHumanReviewFeedbackState,
} from "@/features/human-review-feedback/human-review-feedback-state";
import type { HumanReviewFeedbackModalModel } from "@/features/human-review-feedback/human-review-feedback-types";
import { useHumanReviewFeedbackController } from "@/features/human-review-feedback/use-human-review-feedback-controller";
import type {
  SessionStartExistingSessionOption,
  SessionStartLaunchRequest,
  SessionStartPostAction,
} from "@/features/session-start";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { SessionCreateOption } from "./agents-page-session-tabs";

type UseAgentStudioHumanReviewFeedbackFlowArgs = {
  taskId: string;
  sessionsForTask: AgentSessionSummary[];
  selectedTask: TaskCard | null;
  startSessionRequest: (
    request: SessionStartLaunchRequest & {
      role: "build";
      scenario: "build_after_human_request_changes";
      reason: "create_session";
      existingSessionOptions: SessionStartExistingSessionOption[];
      initialSourceSessionId?: string | null;
      postStartAction: SessionStartPostAction;
    },
  ) => Promise<string | undefined>;
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

  selectedTaskRef.current = selectedTask;

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
    return option.role === "build" && option.scenario === "build_after_human_request_changes";
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
        state: humanReviewFeedbackState,
        builderSessions: sessionsForTask,
        startRequestChangesSession: async (request) => {
          const startRequest = {
            taskId: request.taskId,
            role: request.role,
            scenario: request.scenario,
            reason: "create_session" as const,
            existingSessionOptions: request.existingSessionOptions,
            ...(request.initialSourceSessionId
              ? { initialSourceSessionId: request.initialSourceSessionId }
              : {}),
            ...(request.initialStartMode ? { initialStartMode: request.initialStartMode } : {}),
            postStartAction: request.postStartAction,
            message: request.message,
            beforeStartAction: request.beforeStartAction,
          };

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

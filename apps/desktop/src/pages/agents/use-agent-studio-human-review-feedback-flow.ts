import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
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
  SessionStartPostAction,
} from "@/features/session-start";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { SessionCreateOption } from "./agents-page-session-tabs";
import type { QueryUpdate } from "./use-agent-studio-session-action-helpers";

type UseAgentStudioHumanReviewFeedbackFlowArgs = {
  taskId: string;
  role: AgentRole;
  activeSession: AgentSessionState | null;
  sessionsForTask: AgentSessionSummary[];
  selectedTask: TaskCard | null;
  updateQuery: (updates: QueryUpdate) => void;
  onContextSwitchIntent?: () => void;
  startSessionRequest: (request: {
    taskId: string;
    role: "build";
    scenario: "build_after_human_request_changes";
    reason: "create_session";
    existingSessionOptions: SessionStartExistingSessionOption[];
    initialSourceSessionId?: string | null;
    initialStartMode?: "fresh" | "reuse" | "fork";
    postStartAction: SessionStartPostAction;
    message?: string;
    beforeStartAction?: {
      action: "human_request_changes";
      note: string;
    };
  }) => Promise<string | undefined>;
};

type UseAgentStudioHumanReviewFeedbackFlowResult = {
  humanReviewFeedbackModal: HumanReviewFeedbackModalModel | null;
  shouldInterceptCreateSession: (option: SessionCreateOption) => boolean;
  openHumanReviewFeedback: () => void;
};

export function useAgentStudioHumanReviewFeedbackFlow({
  taskId,
  role: _role,
  activeSession: _activeSession,
  sessionsForTask,
  selectedTask,
  updateQuery: _updateQuery,
  onContextSwitchIntent: _onContextSwitchIntent,
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
            ...(request.sourceSessionId ? { initialSourceSessionId: request.sourceSessionId } : {}),
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

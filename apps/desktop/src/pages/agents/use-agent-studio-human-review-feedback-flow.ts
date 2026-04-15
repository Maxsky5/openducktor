import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  HUMAN_REVIEW_FEEDBACK_HYDRATION_FAILURE_MESSAGE,
  HUMAN_REVIEW_FEEDBACK_SEND_FAILURE_MESSAGE,
  prepareHumanReviewFeedback,
  submitHumanReviewFeedback,
} from "@/features/human-review-feedback/human-review-feedback-flow";
import {
  buildHumanReviewFeedbackModalModel,
  createHumanReviewFeedbackState,
} from "@/features/human-review-feedback/human-review-feedback-state";
import type { HumanReviewFeedbackModalModel } from "@/features/human-review-feedback/human-review-feedback-types";
import { useHumanReviewFeedbackController } from "@/features/human-review-feedback/use-human-review-feedback-controller";
import {
  type NewSessionStartDecision,
  type NewSessionStartRequest,
  startSessionWorkflow,
} from "@/features/session-start";
import { compareAgentSessionRecency } from "@/lib/agent-session-options";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStateContextValue } from "@/types/state-slices";
import type { SessionCreateOption } from "./agents-page-session-tabs";
import {
  applyAgentStudioSelectionQuery,
  type QueryUpdate,
  shouldTriggerContextSwitchIntent,
} from "./use-agent-studio-session-action-helpers";

const findBuilderSessions = (sessions: AgentSessionSummary[]): AgentSessionSummary[] => {
  return sessions.filter((session) => session.role === "build").sort(compareAgentSessionRecency);
};

type UseAgentStudioHumanReviewFeedbackFlowArgs = {
  activeRepo: string | null;
  taskId: string;
  role: AgentRole;
  activeSession: AgentSessionState | null;
  sessionsForTask: AgentSessionSummary[];
  selectedTask: TaskCard | null;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
  bootstrapTaskSessions: AgentStateContextValue["bootstrapTaskSessions"];
  hydrateRequestedTaskSessionHistory: AgentStateContextValue["hydrateRequestedTaskSessionHistory"];
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
  updateQuery: (updates: QueryUpdate) => void;
  onContextSwitchIntent?: () => void;
  executeRequestedSessionStart: <T>(
    request: Omit<NewSessionStartRequest, "selectedModel">,
    executeWithDecision: (
      decision: Exclude<NewSessionStartDecision, null>,
    ) => Promise<T | undefined>,
  ) => Promise<T | undefined>;
};

type UseAgentStudioHumanReviewFeedbackFlowResult = {
  humanReviewFeedbackModal: HumanReviewFeedbackModalModel | null;
  shouldInterceptCreateSession: (option: SessionCreateOption) => boolean;
  openHumanReviewFeedback: () => void;
};

export function useAgentStudioHumanReviewFeedbackFlow({
  activeRepo,
  taskId,
  role,
  activeSession,
  sessionsForTask,
  selectedTask,
  startAgentSession,
  sendAgentMessage,
  bootstrapTaskSessions,
  hydrateRequestedTaskSessionHistory,
  humanRequestChangesTask,
  updateQuery,
  onContextSwitchIntent,
  executeRequestedSessionStart,
}: UseAgentStudioHumanReviewFeedbackFlowArgs): UseAgentStudioHumanReviewFeedbackFlowResult {
  const queryClient = useQueryClient();
  const sessionsForTaskRef = useRef(sessionsForTask);
  const selectedTaskRef = useRef(selectedTask);
  const [isSubmittingHumanReviewFeedback, setIsSubmittingHumanReviewFeedback] = useState(false);

  sessionsForTaskRef.current = sessionsForTask;
  selectedTaskRef.current = selectedTask;

  const {
    clearHumanReviewFeedback,
    humanReviewFeedbackState,
    openHumanReviewFeedback,
    setHumanReviewFeedbackState,
  } = useHumanReviewFeedbackController({
    sessions: sessionsForTask,
    createState: (feedbackTaskId) =>
      createHumanReviewFeedbackState(
        selectedTaskRef.current ? [selectedTaskRef.current] : [],
        feedbackTaskId,
        findBuilderSessions(sessionsForTaskRef.current),
      ),
    openFeedback: async (feedbackTaskId) =>
      prepareHumanReviewFeedback({
        taskId: feedbackTaskId,
        baselineSessions: sessionsForTaskRef.current,
        bootstrapTaskSessions,
        getBuilderSessions: () => findBuilderSessions(sessionsForTaskRef.current),
        createState: (builderSessions) =>
          createHumanReviewFeedbackState(
            selectedTaskRef.current ? [selectedTaskRef.current] : [],
            feedbackTaskId,
            builderSessions,
          ),
      }),
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

  const selectSessionInAgentStudio = useCallback(
    (sessionId: string, nextRole: AgentRole): void => {
      const currentSessionId = activeSession?.sessionId ?? null;
      const currentRole = activeSession?.role ?? role;

      if (
        shouldTriggerContextSwitchIntent({
          currentSessionId,
          currentRole,
          nextSessionId: sessionId,
          nextRole,
        })
      ) {
        onContextSwitchIntent?.();
      }

      applyAgentStudioSelectionQuery(updateQuery, {
        taskId,
        sessionId,
        role: nextRole,
      });
    },
    [activeSession, onContextSwitchIntent, role, taskId, updateQuery],
  );

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
      await submitHumanReviewFeedback({
        state: humanReviewFeedbackState,
        humanRequestChangesTask,
        dismissFeedbackModal: clearHumanReviewFeedback,
        startNewSession: async (request) => {
          const workflow = await executeRequestedSessionStart(
            {
              taskId: request.taskId,
              role: request.role,
              scenario: request.scenario,
              reason: "create_session",
              existingSessionOptions: request.existingSessionOptions,
              initialSourceSessionId: request.sourceSessionId ?? null,
            },
            async (decision) =>
              startSessionWorkflow({
                activeRepo,
                queryClient,
                intent: {
                  taskId: request.taskId,
                  role: request.role,
                  scenario: request.scenario,
                  startMode: decision.startMode,
                  ...(decision.startMode === "reuse" || decision.startMode === "fork"
                    ? { sourceSessionId: decision.sourceSessionId }
                    : {}),
                  postStartAction: request.postStartAction,
                  message: request.message,
                  beforeStartAction: request.beforeStartAction,
                },
                selection: decision.startMode === "reuse" ? null : decision.selectedModel,
                task: selectedTaskRef.current,
                startAgentSession,
                sendAgentMessage,
                humanRequestChangesTask,
                postStartExecution: "detached",
                onDetachedPostStartError: (error) => {
                  toast.error(HUMAN_REVIEW_FEEDBACK_SEND_FAILURE_MESSAGE, {
                    description: error.message,
                  });
                },
              }),
          );
          if (!workflow) {
            return;
          }

          clearHumanReviewFeedback();
          selectSessionInAgentStudio(workflow.sessionId, "build");

          try {
            await hydrateRequestedTaskSessionHistory({
              taskId: request.taskId,
              sessionId: workflow.sessionId,
            });
          } catch {
            toast.error(HUMAN_REVIEW_FEEDBACK_HYDRATION_FAILURE_MESSAGE);
          }
        },
        openExistingSession: (session) => {
          selectSessionInAgentStudio(session.sessionId, "build");
        },
        hydrateExistingSession: async (session) => {
          await hydrateRequestedTaskSessionHistory({
            taskId: session.taskId,
            sessionId: session.sessionId,
          });
        },
        sendExistingSessionMessage: async (session, message) => {
          await sendAgentMessage(session.sessionId, [{ kind: "text", text: message }]);
        },
      });
    } catch (error) {
      toast.error("Failed to prepare the Builder session.", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsSubmittingHumanReviewFeedback(false);
    }
  }, [
    activeRepo,
    clearHumanReviewFeedback,
    executeRequestedSessionStart,
    humanRequestChangesTask,
    humanReviewFeedbackState,
    hydrateRequestedTaskSessionHistory,
    queryClient,
    selectSessionInAgentStudio,
    sendAgentMessage,
    startAgentSession,
  ]);

  const humanReviewFeedbackModal = useMemo<HumanReviewFeedbackModalModel | null>(() => {
    if (!humanReviewFeedbackState) {
      return null;
    }

    return buildHumanReviewFeedbackModalModel({
      state: humanReviewFeedbackState,
      isSubmitting: isSubmittingHumanReviewFeedback,
      onDismiss: dismissHumanReviewFeedback,
      onTargetChange: (selectedTarget: string) => {
        setHumanReviewFeedbackState((current) =>
          current ? { ...current, selectedTarget } : current,
        );
      },
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

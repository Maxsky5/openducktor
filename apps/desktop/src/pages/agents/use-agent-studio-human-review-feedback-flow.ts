import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type {
  HumanReviewFeedbackModalModel,
  HumanReviewFeedbackState,
  PendingHumanReviewHydration,
} from "@/features/human-review-feedback/human-review-feedback-types";
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
  const [pendingHumanReviewHydration, setPendingHumanReviewHydration] =
    useState<PendingHumanReviewHydration | null>(null);
  const [humanReviewFeedbackState, setHumanReviewFeedbackState] =
    useState<HumanReviewFeedbackState | null>(null);
  const [isSubmittingHumanReviewFeedback, setIsSubmittingHumanReviewFeedback] = useState(false);

  sessionsForTaskRef.current = sessionsForTask;
  selectedTaskRef.current = selectedTask;

  useEffect(() => {
    if (!pendingHumanReviewHydration) {
      return;
    }
    if (sessionsForTask === pendingHumanReviewHydration.baselineSessions) {
      return;
    }

    setHumanReviewFeedbackState(
      createHumanReviewFeedbackState(
        selectedTask ? [selectedTask] : [],
        taskId,
        findBuilderSessions(sessionsForTask),
      ),
    );
    setPendingHumanReviewHydration(null);
  }, [pendingHumanReviewHydration, selectedTask, sessionsForTask, taskId]);

  const shouldInterceptCreateSession = useCallback((option: SessionCreateOption): boolean => {
    return option.role === "build" && option.scenario === "build_after_human_request_changes";
  }, []);

  const dismissHumanReviewFeedback = useCallback((): void => {
    if (isSubmittingHumanReviewFeedback) {
      return;
    }
    setHumanReviewFeedbackState(null);
  }, [isSubmittingHumanReviewFeedback]);

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

  const openHumanReviewFeedback = useCallback((): void => {
    if (!taskId) {
      return;
    }

    void (async () => {
      const result = await prepareHumanReviewFeedback({
        taskId,
        baselineSessions: sessionsForTaskRef.current,
        bootstrapTaskSessions,
        getBuilderSessions: () => findBuilderSessions(sessionsForTaskRef.current),
        createState: (builderSessions) =>
          createHumanReviewFeedbackState(
            selectedTaskRef.current ? [selectedTaskRef.current] : [],
            taskId,
            builderSessions,
          ),
      });

      if (result.kind === "ready") {
        setHumanReviewFeedbackState(result.state);
        return;
      }

      if (result.kind === "pending_hydration") {
        setPendingHumanReviewHydration(result.pendingHydration);
        return;
      }

      setPendingHumanReviewHydration(null);
    })();
  }, [bootstrapTaskSessions, taskId]);

  const confirmHumanReviewFeedback = useCallback(async (): Promise<void> => {
    if (!humanReviewFeedbackState) {
      return;
    }

    setIsSubmittingHumanReviewFeedback(true);
    try {
      await submitHumanReviewFeedback({
        state: humanReviewFeedbackState,
        humanRequestChangesTask,
        dismissFeedbackModal: () => {
          setHumanReviewFeedbackState(null);
        },
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

          setHumanReviewFeedbackState(null);
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
  ]);

  return {
    humanReviewFeedbackModal,
    shouldInterceptCreateSession,
    openHumanReviewFeedback,
  };
}

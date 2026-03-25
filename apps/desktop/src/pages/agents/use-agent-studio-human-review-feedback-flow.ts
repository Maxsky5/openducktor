import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  buildHumanReviewFeedbackModalModel,
  createHumanReviewFeedbackState,
  NEW_BUILDER_SESSION_TARGET,
} from "@/features/human-review-feedback/human-review-feedback-state";
import type {
  HumanReviewFeedbackModalModel,
  HumanReviewFeedbackState,
  PendingHumanReviewHydration,
} from "@/features/human-review-feedback/human-review-feedback-types";
import {
  buildReusableSessionOptions,
  type NewSessionStartDecision,
  type NewSessionStartRequest,
  startSessionWorkflow,
} from "@/features/session-start";
import { compareAgentSessionRecency } from "@/lib/agent-session-options";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStateContextValue } from "@/types/state-slices";
import type { SessionCreateOption } from "./agents-page-session-tabs";
import {
  applyAgentStudioSelectionQuery,
  type QueryUpdate,
  shouldTriggerContextSwitchIntent,
} from "./use-agent-studio-session-action-helpers";

const findBuilderSessions = (sessions: AgentSessionState[]): AgentSessionState[] => {
  return sessions.filter((session) => session.role === "build").sort(compareAgentSessionRecency);
};

type UseAgentStudioHumanReviewFeedbackFlowArgs = {
  activeRepo: string | null;
  taskId: string;
  role: AgentRole;
  activeSession: AgentSessionState | null;
  sessionsForTask: AgentSessionState[];
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
    executeWithDecision: (decision: Exclude<NewSessionStartDecision, null>) => Promise<T | undefined>,
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
      try {
        const baselineSessions = sessionsForTaskRef.current;
        await bootstrapTaskSessions(taskId);

        const currentBuilderSessions = findBuilderSessions(sessionsForTaskRef.current);
        if (currentBuilderSessions.length > 0) {
          setHumanReviewFeedbackState(
            createHumanReviewFeedbackState(
              selectedTaskRef.current ? [selectedTaskRef.current] : [],
              taskId,
              currentBuilderSessions,
            ),
          );
          return;
        }

        setPendingHumanReviewHydration({ taskId, baselineSessions });
      } catch {
        setPendingHumanReviewHydration(null);
        toast.error("Failed to load Builder sessions for this task.");
      }
    })();
  }, [bootstrapTaskSessions, taskId]);

  const confirmHumanReviewFeedback = useCallback(async (): Promise<void> => {
    if (!humanReviewFeedbackState) {
      return;
    }

    setIsSubmittingHumanReviewFeedback(true);
    try {
      const trimmedMessage = humanReviewFeedbackState.message.trim();
      if (trimmedMessage.length === 0) {
        toast.error("Feedback message is required.");
        return;
      }

      if (humanReviewFeedbackState.selectedTarget === NEW_BUILDER_SESSION_TARGET) {
        const workflow = await executeRequestedSessionStart(
          {
          taskId: humanReviewFeedbackState.taskId,
          role: "build",
          scenario: humanReviewFeedbackState.scenario,
          reason: "create_session",
          existingSessionOptions: buildReusableSessionOptions({
            sessions: humanReviewFeedbackState.builderSessions,
            role: "build",
          }),
          initialSourceSessionId: humanReviewFeedbackState.builderSessions[0]?.sessionId ?? null,
          },
          async (decision) =>
            startSessionWorkflow({
              activeRepo,
              queryClient,
              intent: {
                taskId: humanReviewFeedbackState.taskId,
                role: "build",
                scenario: humanReviewFeedbackState.scenario,
                startMode: decision.startMode,
                ...(decision.startMode === "reuse" || decision.startMode === "fork"
                  ? { sourceSessionId: decision.sourceSessionId }
                  : {}),
                postStartAction: "send_message",
                message: trimmedMessage,
                beforeStartAction: {
                  action: "human_request_changes",
                  note: trimmedMessage,
                },
              },
              selection: decision.startMode === "reuse" ? null : decision.selectedModel,
              task: selectedTaskRef.current,
              startAgentSession,
              sendAgentMessage,
              humanRequestChangesTask,
              postStartExecution: "detached",
              onDetachedPostStartError: (error) => {
                toast.error("Changes requested, but feedback message failed.", {
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

        if (workflow.beforeStartActionError) {
          toast.error("Session started, but requesting changes failed.");
          return;
        }

        try {
          await hydrateRequestedTaskSessionHistory({
            taskId: humanReviewFeedbackState.taskId,
            sessionId: workflow.sessionId,
          });
        } catch {
          toast.error("Changes requested, but refreshing Builder sessions failed.");
        }

        return;
      }

      const existingBuilderSession = humanReviewFeedbackState.builderSessions.find(
        (session) => session.sessionId === humanReviewFeedbackState.selectedTarget,
      );
      if (!existingBuilderSession) {
        toast.error("The selected builder session is no longer available for this task.");
        return;
      }

      try {
        await humanRequestChangesTask(humanReviewFeedbackState.taskId, trimmedMessage);
      } catch {
        toast.error("Requesting changes failed.");
        return;
      }

      setHumanReviewFeedbackState(null);
      selectSessionInAgentStudio(existingBuilderSession.sessionId, "build");

      try {
        await hydrateRequestedTaskSessionHistory({
          taskId: humanReviewFeedbackState.taskId,
          sessionId: existingBuilderSession.sessionId,
        });
      } catch {
        toast.error("Changes requested, but refreshing Builder sessions failed.");
      }

      try {
        await sendAgentMessage(existingBuilderSession.sessionId, trimmedMessage);
      } catch {
        toast.error("Changes requested, but feedback message failed.");
      }
    } catch (error) {
      toast.error("Failed to prepare the Builder session.", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsSubmittingHumanReviewFeedback(false);
    }
  }, [
    humanReviewFeedbackState,
    humanRequestChangesTask,
    activeRepo,
    hydrateRequestedTaskSessionHistory,
    executeRequestedSessionStart,
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

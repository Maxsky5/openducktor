import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole } from "@openducktor/core";
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
import type { NewSessionStartRequest } from "@/features/session-start";
import { resolveBuildWorkingDirectoryOverride } from "@/lib/build-worktree-overrides";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStateContextValue } from "@/types/state-slices";
import type { SessionCreateOption } from "./agents-page-session-tabs";
import {
  applyAgentStudioSelectionQuery,
  type QueryUpdate,
  shouldTriggerContextSwitchIntent,
} from "./use-agent-studio-session-action-helpers";

const compareSessionRecency = (a: AgentSessionState, b: AgentSessionState): number => {
  if (a.startedAt !== b.startedAt) {
    return a.startedAt > b.startedAt ? -1 : 1;
  }
  if (a.sessionId === b.sessionId) {
    return 0;
  }
  return a.sessionId > b.sessionId ? -1 : 1;
};

const findBuilderSessions = (sessions: AgentSessionState[]): AgentSessionState[] => {
  return sessions.filter((session) => session.role === "build").sort(compareSessionRecency);
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
  updateAgentSessionModel: AgentStateContextValue["updateAgentSessionModel"];
  loadAgentSessions: AgentStateContextValue["loadAgentSessions"];
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
  updateQuery: (updates: QueryUpdate) => void;
  onContextSwitchIntent?: () => void;
  resolveRequestedSelection: (
    request: Omit<NewSessionStartRequest, "selectedModel">,
  ) => Promise<AgentModelSelection | null | undefined>;
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
  updateAgentSessionModel,
  loadAgentSessions,
  humanRequestChangesTask,
  updateQuery,
  onContextSwitchIntent,
  resolveRequestedSelection,
}: UseAgentStudioHumanReviewFeedbackFlowArgs): UseAgentStudioHumanReviewFeedbackFlowResult {
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
        await loadAgentSessions(taskId);

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
  }, [loadAgentSessions, taskId]);

  const confirmHumanReviewFeedback = useCallback((): void => {
    if (!humanReviewFeedbackState) {
      return;
    }

    void (async () => {
      setIsSubmittingHumanReviewFeedback(true);
      try {
        const trimmedMessage = humanReviewFeedbackState.message.trim();
        if (trimmedMessage.length === 0) {
          toast.error("Feedback message is required.");
          return;
        }

        if (humanReviewFeedbackState.selectedTarget === NEW_BUILDER_SESSION_TARGET) {
          setHumanReviewFeedbackState(null);
          const selectedModel = await resolveRequestedSelection({
            taskId: humanReviewFeedbackState.taskId,
            role: "build",
            scenario: humanReviewFeedbackState.scenario,
            startMode: "fresh",
            reason: "create_session",
          });
          if (selectedModel === undefined) {
            return;
          }

          const workingDirectoryOverride = await resolveBuildWorkingDirectoryOverride({
            activeRepo,
            taskId: humanReviewFeedbackState.taskId,
            role: "build",
            scenario: humanReviewFeedbackState.scenario,
          });
          const sessionId = await startAgentSession({
            taskId: humanReviewFeedbackState.taskId,
            role: "build",
            scenario: humanReviewFeedbackState.scenario,
            selectedModel,
            sendKickoff: false,
            startMode: "fresh",
            requireModelReady: true,
            ...(workingDirectoryOverride ? { workingDirectoryOverride } : {}),
          });
          if (selectedModel) {
            updateAgentSessionModel(sessionId, selectedModel);
          }

          selectSessionInAgentStudio(sessionId, "build");

          try {
            await humanRequestChangesTask(humanReviewFeedbackState.taskId, trimmedMessage);
          } catch {
            toast.error("Session started, but requesting changes failed.");
            return;
          }

          try {
            await sendAgentMessage(sessionId, trimmedMessage);
          } catch {
            toast.error("Changes requested, but feedback message failed.");
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
          await loadAgentSessions(humanReviewFeedbackState.taskId, {
            hydrateHistoryForSessionId: existingBuilderSession.sessionId,
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
    })();
  }, [
    humanReviewFeedbackState,
    humanRequestChangesTask,
    activeRepo,
    loadAgentSessions,
    resolveRequestedSelection,
    selectSessionInAgentStudio,
    sendAgentMessage,
    startAgentSession,
    updateAgentSessionModel,
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

import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole, AgentScenario } from "@openducktor/core";
import { isAgentKickoffScenario } from "@openducktor/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HumanReviewFeedbackModalModel } from "@/features/human-review-feedback/human-review-feedback-types";
import type { RequestNewSessionStart } from "@/features/session-start";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStateContextValue } from "@/types/state-slices";
import { SCENARIO_LABELS } from "./agents-page-constants";
import type { SessionCreateOption } from "./agents-page-session-tabs";
import {
  applyAgentStudioSelectionQuery,
  buildAgentStudioAsyncActivityContextKey,
  canStartSessionForRole,
  decrementActivityCountRecord,
  incrementActivityCountRecord,
  type QueryUpdate,
  shouldTriggerContextSwitchIntent,
} from "./use-agent-studio-session-action-helpers";
import { useAgentStudioSessionStartFlow } from "./use-agent-studio-session-start-flow";

export type { NewSessionStartDecision, NewSessionStartRequest } from "@/features/session-start";

type UseAgentStudioSessionActionsArgs = {
  activeRepo: string | null;
  taskId: string;
  role: AgentRole;
  scenario: AgentScenario;
  activeSession: AgentSessionState | null;
  sessionsForTask: AgentSessionState[];
  selectedTask: TaskCard | null;
  agentStudioReady: boolean;
  isActiveTaskHydrated: boolean;
  selectionForNewSession: AgentModelSelection | null;
  input: string;
  setInput: (value: string) => void;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
  updateAgentSessionModel: AgentStateContextValue["updateAgentSessionModel"];
  loadAgentSessions: AgentStateContextValue["loadAgentSessions"];
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
  answerAgentQuestion: AgentStateContextValue["answerAgentQuestion"];
  updateQuery: (updates: QueryUpdate) => void;
  onContextSwitchIntent?: () => void;
  requestNewSessionStart?: RequestNewSessionStart;
};

export function useAgentStudioSessionActions({
  activeRepo,
  taskId,
  role,
  scenario,
  activeSession,
  sessionsForTask,
  selectedTask,
  agentStudioReady,
  isActiveTaskHydrated,
  selectionForNewSession,
  input,
  setInput,
  startAgentSession,
  sendAgentMessage,
  updateAgentSessionModel,
  loadAgentSessions,
  humanRequestChangesTask,
  answerAgentQuestion,
  updateQuery,
  onContextSwitchIntent,
  requestNewSessionStart,
}: UseAgentStudioSessionActionsArgs): {
  isStarting: boolean;
  humanReviewFeedbackModal: HumanReviewFeedbackModalModel | null;
  isSending: boolean;
  isSubmittingQuestionByRequestId: Record<string, boolean>;
  isSessionWorking: boolean;
  canKickoffNewSession: boolean;
  kickoffLabel: string;
  canStopSession: boolean;
  startScenarioKickoff: () => Promise<void>;
  onSend: () => Promise<void>;
  onSubmitQuestionAnswers: (requestId: string, answers: string[][]) => Promise<void>;
  handleWorkflowStepSelect: (role: AgentRole, sessionId: string | null) => void;
  handleSessionSelectionChange: (nextValue: string) => void;
  handleCreateSession: (option: SessionCreateOption) => void;
} {
  const [sendingActivityCountByContext, setSendingActivityCountByContext] = useState<
    Record<string, number>
  >({});
  const [isSubmittingQuestionByRequestId, setIsSubmittingQuestionByRequestId] = useState<
    Record<string, boolean>
  >({});
  const latestInputRef = useRef(input);

  const activeSessionId = activeSession?.sessionId ?? null;
  const activeComposerContextKey = buildAgentStudioAsyncActivityContextKey({
    activeRepo,
    taskId,
    role,
    sessionId: activeSessionId,
  });
  const isSending = (sendingActivityCountByContext[activeComposerContextKey] ?? 0) > 0;
  const isSessionWorking =
    Boolean(activeSession) &&
    ((activeSession?.status ?? "stopped") === "running" ||
      (activeSession?.status ?? "stopped") === "starting" ||
      isSending);

  const {
    isStarting,
    humanReviewFeedbackModal,
    startSession,
    startScenarioKickoff,
    handleCreateSession,
  } = useAgentStudioSessionStartFlow({
    activeRepo,
    taskId,
    role,
    scenario,
    activeSession,
    sessionsForTask,
    selectedTask,
    agentStudioReady,
    isActiveTaskHydrated,
    isSessionWorking,
    selectionForNewSession,
    startAgentSession,
    sendAgentMessage,
    updateAgentSessionModel,
    loadAgentSessions,
    humanRequestChangesTask,
    updateQuery,
    ...(onContextSwitchIntent ? { onContextSwitchIntent } : {}),
    ...(requestNewSessionStart ? { requestNewSessionStart } : {}),
  });

  useEffect(() => {
    latestInputRef.current = input;
  }, [input]);

  const onSend = useCallback(async (): Promise<void> => {
    if (isSending || isStarting || !agentStudioReady) {
      return;
    }
    if (!canStartSessionForRole(selectedTask, role)) {
      return;
    }
    if (activeSession?.isLoadingModelCatalog && !activeSession.selectedModel) {
      return;
    }

    const message = input.trim();
    if (!message || !taskId) {
      return;
    }

    latestInputRef.current = "";
    setInput("");
    const restoreComposerInput = () => {
      if (latestInputRef.current.trim().length > 0) {
        return;
      }
      setInput(message);
    };
    const sendContextKeys = new Set<string>();

    try {
      let targetSessionId = activeSession?.sessionId;
      if (!targetSessionId) {
        targetSessionId = await startSession("composer_send");
      }

      if (!targetSessionId) {
        restoreComposerInput();
        return;
      }

      const targetComposerContextKey = buildAgentStudioAsyncActivityContextKey({
        activeRepo,
        taskId,
        role,
        sessionId: targetSessionId,
      });
      sendContextKeys.add(activeComposerContextKey);
      sendContextKeys.add(targetComposerContextKey);

      setSendingActivityCountByContext((current) => {
        let next = current;
        for (const contextKey of sendContextKeys) {
          next = incrementActivityCountRecord(next, contextKey);
        }
        return next;
      });
      await sendAgentMessage(targetSessionId, message);
    } catch (error) {
      restoreComposerInput();
      throw error;
    } finally {
      if (sendContextKeys.size > 0) {
        setSendingActivityCountByContext((current) => {
          let next = current;
          for (const contextKey of sendContextKeys) {
            next = decrementActivityCountRecord(next, contextKey);
          }
          return next;
        });
      }
    }
  }, [
    activeRepo,
    activeComposerContextKey,
    activeSession,
    agentStudioReady,
    input,
    isSending,
    isStarting,
    role,
    selectedTask,
    sendAgentMessage,
    setInput,
    startSession,
    taskId,
  ]);

  const onSubmitQuestionAnswers = useCallback(
    async (requestId: string, answers: string[][]): Promise<void> => {
      if (!activeSession || !agentStudioReady) {
        return;
      }

      const sessionId = activeSession.sessionId;
      setIsSubmittingQuestionByRequestId((current) => ({
        ...current,
        [requestId]: true,
      }));
      try {
        await answerAgentQuestion(sessionId, requestId, answers);
      } finally {
        setIsSubmittingQuestionByRequestId((current) => {
          if (!current[requestId]) {
            return current;
          }
          const next = { ...current };
          delete next[requestId];
          return next;
        });
      }
    },
    [activeSession, agentStudioReady, answerAgentQuestion],
  );

  useEffect(() => {
    setIsSubmittingQuestionByRequestId((current) => {
      if (activeSessionId === null && Object.keys(current).length === 0) {
        return current;
      }
      return {};
    });
  }, [activeSessionId]);

  useEffect(() => {
    const activeRequestIds = new Set(
      (activeSession?.pendingQuestions ?? []).map((entry) => entry.requestId),
    );
    setIsSubmittingQuestionByRequestId((current) => {
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const [requestId, isSubmitting] of Object.entries(current)) {
        if (!activeRequestIds.has(requestId)) {
          changed = true;
          continue;
        }
        next[requestId] = isSubmitting;
      }
      return changed ? next : current;
    });
  }, [activeSession?.pendingQuestions]);

  const handleWorkflowStepSelect = useCallback(
    (nextRole: AgentRole, sessionId: string | null): void => {
      if (!taskId) {
        return;
      }

      const currentSessionId = activeSession?.sessionId ?? null;
      const currentRole = activeSession?.role ?? role;

      if (!sessionId) {
        if (
          shouldTriggerContextSwitchIntent({
            currentSessionId,
            currentRole,
            nextSessionId: null,
            nextRole,
          })
        ) {
          onContextSwitchIntent?.();
        }

        applyAgentStudioSelectionQuery(updateQuery, {
          taskId,
          sessionId: undefined,
          role: nextRole,
        });
        return;
      }

      const session = sessionsForTask.find((entry) => entry.sessionId === sessionId);
      if (!session) {
        return;
      }

      if (
        shouldTriggerContextSwitchIntent({
          currentSessionId,
          currentRole,
          nextSessionId: session.sessionId,
          nextRole: session.role,
        })
      ) {
        onContextSwitchIntent?.();
      }

      applyAgentStudioSelectionQuery(updateQuery, {
        taskId: session.taskId,
        sessionId: session.sessionId,
        role: session.role,
      });
    },
    [activeSession, onContextSwitchIntent, role, sessionsForTask, taskId, updateQuery],
  );

  const handleSessionSelectionChange = useCallback(
    (nextValue: string): void => {
      if (!taskId) {
        return;
      }

      const selectedSession = sessionsForTask.find((entry) => entry.sessionId === nextValue);
      if (!selectedSession) {
        return;
      }

      if (
        shouldTriggerContextSwitchIntent({
          currentSessionId: activeSession?.sessionId ?? null,
          currentRole: activeSession?.role ?? role,
          nextSessionId: selectedSession.sessionId,
          nextRole: selectedSession.role,
        })
      ) {
        onContextSwitchIntent?.();
      }

      applyAgentStudioSelectionQuery(updateQuery, {
        taskId: selectedSession.taskId,
        sessionId: selectedSession.sessionId,
        role: selectedSession.role,
      });
    },
    [activeSession, onContextSwitchIntent, role, sessionsForTask, taskId, updateQuery],
  );

  const selectedRoleAvailable = selectedTask ? canStartSessionForRole(selectedTask, role) : false;
  const canKickoffNewSession =
    agentStudioReady &&
    Boolean(taskId) &&
    isActiveTaskHydrated &&
    !activeSession &&
    selectedRoleAvailable &&
    isAgentKickoffScenario(scenario);
  const kickoffLabel =
    role === "spec"
      ? "Start Spec"
      : role === "planner"
        ? "Start Planner"
        : `Start ${SCENARIO_LABELS[scenario]}`;
  const canStopSession = Boolean(activeSession && isSessionWorking);

  return {
    isStarting,
    humanReviewFeedbackModal,
    isSending,
    isSubmittingQuestionByRequestId,
    isSessionWorking,
    canKickoffNewSession,
    kickoffLabel,
    canStopSession,
    startScenarioKickoff,
    onSend,
    onSubmitQuestionAnswers,
    handleWorkflowStepSelect,
    handleSessionSelectionChange,
    handleCreateSession,
  };
}

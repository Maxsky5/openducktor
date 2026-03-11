import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole, AgentScenario } from "@openducktor/core";
import { isAgentKickoffScenario } from "@openducktor/core";
import { useCallback, useEffect, useState } from "react";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStateContextValue } from "@/types/state-slices";
import { SCENARIO_LABELS } from "./agents-page-constants";
import type { SessionCreateOption } from "./agents-page-session-tabs";
import {
  applyAgentStudioSelectionQuery,
  canStartSessionForRole,
  type QueryUpdate,
  shouldTriggerContextSwitchIntent,
} from "./use-agent-studio-session-action-helpers";
import { useAgentStudioSessionStartFlow } from "./use-agent-studio-session-start-flow";
import type { RequestNewSessionStart } from "./use-agent-studio-session-start-types";

export type {
  NewSessionStartDecision,
  NewSessionStartRequest,
  SessionStartRequestReason,
} from "./use-agent-studio-session-start-types";

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
  answerAgentQuestion,
  updateQuery,
  onContextSwitchIntent,
  requestNewSessionStart,
}: UseAgentStudioSessionActionsArgs): {
  isStarting: boolean;
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
  const [isSending, setIsSending] = useState(false);
  const [isSubmittingQuestionByRequestId, setIsSubmittingQuestionByRequestId] = useState<
    Record<string, boolean>
  >({});

  const activeSessionId = activeSession?.sessionId ?? null;
  const isSessionWorking =
    Boolean(activeSession) &&
    ((activeSession?.status ?? "stopped") === "running" ||
      (activeSession?.status ?? "stopped") === "starting" ||
      isSending);

  const { isStarting, startSession, startScenarioKickoff, handleCreateSession } =
    useAgentStudioSessionStartFlow({
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
      updateQuery,
      ...(onContextSwitchIntent ? { onContextSwitchIntent } : {}),
      ...(requestNewSessionStart ? { requestNewSessionStart } : {}),
    });

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

    setInput("");

    let targetSessionId = activeSession?.sessionId;
    if (!targetSessionId) {
      targetSessionId = await startSession("composer_send");
    }

    if (!targetSessionId) {
      return;
    }

    setIsSending(true);
    try {
      await sendAgentMessage(targetSessionId, message);
    } finally {
      setIsSending(false);
    }
  }, [
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

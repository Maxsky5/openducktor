import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole, AgentScenario } from "@openducktor/core";
import { isAgentKickoffScenario } from "@openducktor/core";
import { useCallback, useEffect, useState } from "react";
import type { SessionStartModalModel } from "@/components/features/agents";
import {
  type AgentChatComposerDraft,
  draftHasMeaningfulContent,
  draftToSerializedText,
  draftToUserMessageParts,
} from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import type { HumanReviewFeedbackModalModel } from "@/features/human-review-feedback/human-review-feedback-types";
import type { SessionStartRequestReason } from "@/features/session-start";
import { isAgentSessionWaitingInput } from "@/lib/agent-session-waiting-input";
import { useRuntimeDefinitionsContext } from "@/state/app-state-contexts";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStateContextValue, RepoSettingsInput } from "@/types/state-slices";
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
  selectedModelSelection: AgentModelSelection | null;
  sessionsForTask: AgentSessionState[];
  selectedTask: TaskCard | null;
  agentStudioReady: boolean;
  isActiveTaskHydrated: boolean;
  selectionForNewSession: AgentModelSelection | null;
  repoSettings: RepoSettingsInput | null;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
  bootstrapTaskSessions: AgentStateContextValue["bootstrapTaskSessions"];
  hydrateRequestedTaskSessionHistory: AgentStateContextValue["hydrateRequestedTaskSessionHistory"];
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
  answerAgentQuestion: AgentStateContextValue["answerAgentQuestion"];
  updateQuery: (updates: QueryUpdate) => void;
  onContextSwitchIntent?: () => void;
};

export function useAgentStudioSessionActions({
  activeRepo,
  taskId,
  role,
  scenario,
  activeSession,
  selectedModelSelection,
  sessionsForTask,
  selectedTask,
  agentStudioReady,
  isActiveTaskHydrated,
  selectionForNewSession,
  repoSettings,
  startAgentSession,
  sendAgentMessage,
  bootstrapTaskSessions,
  hydrateRequestedTaskSessionHistory,
  humanRequestChangesTask,
  answerAgentQuestion,
  updateQuery,
  onContextSwitchIntent,
}: UseAgentStudioSessionActionsArgs): {
  isStarting: boolean;
  sessionStartModal: SessionStartModalModel | null;
  humanReviewFeedbackModal: HumanReviewFeedbackModalModel | null;
  startSessionRequest: (request: {
    taskId: string;
    role: AgentRole;
    scenario: AgentScenario;
    reason: SessionStartRequestReason;
    postStartAction: "none" | "kickoff" | "send_message";
    message?: string;
    initialStartMode?: "fresh" | "reuse" | "fork";
    existingSessionOptions?: Array<{
      value: string;
      label: string;
      description: string;
      secondaryLabel?: string;
      selectedModel?: AgentModelSelection | null;
    }>;
    initialSourceSessionId?: string | null;
  }) => Promise<string | undefined>;
  isSending: boolean;
  isSubmittingQuestionByRequestId: Record<string, boolean>;
  isSessionWorking: boolean;
  isWaitingInput: boolean;
  busySendBlockedReason: string | null;
  canKickoffNewSession: boolean;
  kickoffLabel: string;
  canStopSession: boolean;
  startScenarioKickoff: () => Promise<void>;
  onSend: (draft: AgentChatComposerDraft) => Promise<boolean>;
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
  const { runtimeDefinitions } = useRuntimeDefinitionsContext();

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
  const isWaitingInput = Boolean(activeSession && isAgentSessionWaitingInput(activeSession));
  const selectedRuntimeKind =
    selectedModelSelection?.runtimeKind ?? activeSession?.selectedModel?.runtimeKind ?? null;
  const activeRuntimeDescriptor =
    (selectedRuntimeKind
      ? runtimeDefinitions.find((runtime) => runtime.kind === selectedRuntimeKind)
      : null) ??
    activeSession?.modelCatalog?.runtime ??
    runtimeDefinitions.find((runtime) => runtime.kind === activeSession?.runtimeKind) ??
    null;
  const supportsQueuedUserMessages =
    activeRuntimeDescriptor?.capabilities.supportsQueuedUserMessages !== false;
  const canQueueBusyFollowups =
    activeSession?.status === "running" && !isWaitingInput && supportsQueuedUserMessages;
  const busySendBlockedReason =
    activeSession && isSessionWorking && !isWaitingInput && !supportsQueuedUserMessages
      ? `${activeRuntimeDescriptor?.label ?? "Current runtime"} does not support queued messages while the session is working.`
      : null;

  const {
    isStarting,
    sessionStartModal,
    humanReviewFeedbackModal,
    startSessionRequest,
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
    repoSettings,
    startAgentSession,
    sendAgentMessage,
    bootstrapTaskSessions,
    hydrateRequestedTaskSessionHistory,
    humanRequestChangesTask,
    updateQuery,
    ...(onContextSwitchIntent ? { onContextSwitchIntent } : {}),
  });

  const onSend = useCallback(
    async (draft: AgentChatComposerDraft): Promise<boolean> => {
      if (
        (!canQueueBusyFollowups && isSending) ||
        isStarting ||
        !agentStudioReady ||
        isWaitingInput ||
        busySendBlockedReason
      ) {
        return false;
      }
      if (!canStartSessionForRole(selectedTask, role)) {
        return false;
      }
      if (activeSession?.isLoadingModelCatalog && !activeSession.selectedModel) {
        return false;
      }

      const serializedDraft = draftToSerializedText(draft).trim();
      if (!draftHasMeaningfulContent(draft) || !serializedDraft || !taskId) {
        return false;
      }
      const sendContextKeys = new Set<string>();

      try {
        let targetSessionId = activeSession?.sessionId;
        if (!targetSessionId) {
          targetSessionId = await startSession("composer_send");
        }

        if (!targetSessionId) {
          return false;
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
        await sendAgentMessage(targetSessionId, draftToUserMessageParts(draft));
        return true;
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
    },
    [
      activeRepo,
      activeComposerContextKey,
      activeSession,
      agentStudioReady,
      canQueueBusyFollowups,
      isSending,
      isStarting,
      isWaitingInput,
      busySendBlockedReason,
      role,
      selectedTask,
      sendAgentMessage,
      startSession,
      taskId,
    ],
  );

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
          scenario,
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
        scenario: session.scenario,
      });
    },
    [activeSession, onContextSwitchIntent, role, scenario, sessionsForTask, taskId, updateQuery],
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
        scenario: selectedSession.scenario,
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
    sessionStartModal,
    humanReviewFeedbackModal,
    startSessionRequest,
    isSending,
    isSubmittingQuestionByRequestId,
    isSessionWorking,
    isWaitingInput,
    busySendBlockedReason,
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

import type { GitBranch, GitTargetBranch, TaskCard } from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentModelSelection,
  AgentRole,
  AgentScenario,
} from "@openducktor/core";
import { isAgentKickoffScenario } from "@openducktor/core";
import { useCallback, useEffect, useState } from "react";
import type { SessionStartModalModel } from "@/components/features/agents";
import { validateComposerAttachments } from "@/components/features/agents/agent-chat/agent-chat-attachments";
import {
  type AgentChatComposerDraft,
  draftHasMeaningfulContent,
  draftHasSlashCommandSegment,
  resolveDraftToUserMessageParts,
} from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import type { HumanReviewFeedbackModalModel } from "@/features/human-review-feedback/human-review-feedback-types";
import type { SessionStartLaunchRequest } from "@/features/session-start";
import { isAgentSessionWaitingInput } from "@/lib/agent-session-waiting-input";
import { stageLocalAttachmentFile } from "@/lib/local-attachment-files";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { useRuntimeDefinitionsContext } from "@/state/app-state-contexts";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type {
  ActiveWorkspace,
  AgentStateContextValue,
  RepoSettingsInput,
} from "@/types/state-slices";
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

export type AgentSessionActionState = Pick<
  AgentSessionState,
  | "sessionId"
  | "role"
  | "status"
  | "selectedModel"
  | "isLoadingModelCatalog"
  | "pendingPermissions"
  | "pendingQuestions"
  | "modelCatalog"
  | "runtimeKind"
>;

type UseAgentStudioSessionActionsArgs = {
  activeWorkspace: ActiveWorkspace | null;
  branches?: GitBranch[];
  taskId: string;
  role: AgentRole;
  scenario: AgentScenario;
  activeSession: AgentSessionState | null;
  selectedModelSelection: AgentModelSelection | null;
  selectedModelDescriptor?: AgentModelCatalog["models"][number] | null;
  sessionsForTask: AgentSessionSummary[];
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
  setTaskTargetBranch?: (taskId: string, targetBranch: GitTargetBranch) => Promise<void>;
  answerAgentQuestion: AgentStateContextValue["answerAgentQuestion"];
  updateQuery: (updates: QueryUpdate) => void;
  scheduleSelectionIntent?: (intent: {
    taskId: string;
    sessionId: string | null;
    role: AgentRole;
    scenario: AgentScenario | null;
  }) => void;
  onContextSwitchIntent?: () => void;
};

export function useAgentStudioSessionActions({
  activeWorkspace,
  branches = [],
  taskId,
  role,
  scenario,
  activeSession,
  selectedModelSelection,
  selectedModelDescriptor,
  sessionsForTask,
  selectedTask,
  agentStudioReady,
  isActiveTaskHydrated,
  selectionForNewSession,
  repoSettings,
  startAgentSession,
  sendAgentMessage,
  bootstrapTaskSessions: _bootstrapTaskSessions,
  hydrateRequestedTaskSessionHistory: _hydrateRequestedTaskSessionHistory,
  humanRequestChangesTask: _humanRequestChangesTask,
  setTaskTargetBranch,
  answerAgentQuestion,
  updateQuery,
  scheduleSelectionIntent,
  onContextSwitchIntent,
}: UseAgentStudioSessionActionsArgs): {
  isStarting: boolean;
  sessionStartModal: SessionStartModalModel | null;
  humanReviewFeedbackModal: HumanReviewFeedbackModalModel | null;
  startSessionRequest: (request: SessionStartLaunchRequest) => Promise<string | undefined>;
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
  const activeSessionRole = activeSession?.role ?? role;
  const activeSessionStatus = activeSession?.status ?? "stopped";
  const activeSessionSelectedModel = activeSession?.selectedModel ?? null;
  const activeSessionIsLoadingModelCatalog = activeSession?.isLoadingModelCatalog === true;
  const activeSessionPendingPermissions = activeSession?.pendingPermissions ?? [];
  const activeSessionPendingQuestions = activeSession?.pendingQuestions ?? [];
  const activeSessionRuntimeKind = activeSession?.runtimeKind ?? null;
  const activeSessionRuntimeDescriptor = activeSession?.modelCatalog?.runtime ?? null;
  const hasActiveSession = activeSession != null;
  const activeComposerContextKey = buildAgentStudioAsyncActivityContextKey({
    activeWorkspace,
    taskId,
    role,
    sessionId: activeSessionId,
  });
  const isSending = (sendingActivityCountByContext[activeComposerContextKey] ?? 0) > 0;
  const isSessionWorking =
    hasActiveSession &&
    (activeSessionStatus === "running" || activeSessionStatus === "starting" || isSending);
  const isWaitingInput =
    hasActiveSession &&
    isAgentSessionWaitingInput({
      pendingPermissions: activeSessionPendingPermissions,
      pendingQuestions: activeSessionPendingQuestions,
    });
  const selectedRuntimeKind =
    selectedModelSelection?.runtimeKind ?? activeSessionSelectedModel?.runtimeKind ?? null;
  const activeRuntimeDescriptor =
    (selectedRuntimeKind
      ? runtimeDefinitions.find((runtime) => runtime.kind === selectedRuntimeKind)
      : null) ??
    activeSessionRuntimeDescriptor ??
    runtimeDefinitions.find((runtime) => runtime.kind === activeSessionRuntimeKind) ??
    null;
  const supportsQueuedUserMessages =
    activeRuntimeDescriptor?.capabilities.sessionLifecycle.supportsQueuedUserMessages !== false;
  const canQueueBusyFollowups =
    activeSessionStatus === "running" && !isWaitingInput && supportsQueuedUserMessages;
  const busySendBlockedReason =
    hasActiveSession && isSessionWorking && !isWaitingInput && !supportsQueuedUserMessages
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
    activeWorkspace,
    branches,
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
    ...(setTaskTargetBranch ? { setTaskTargetBranch } : {}),
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
      if (activeSessionIsLoadingModelCatalog && !activeSessionSelectedModel) {
        return false;
      }

      if ((draft.attachments ?? []).length > 0) {
        if (draftHasSlashCommandSegment(draft)) {
          return false;
        }

        const attachmentErrors = validateComposerAttachments(
          draft.attachments ?? [],
          selectedModelDescriptor?.attachmentSupport,
        );
        if (Object.keys(attachmentErrors).length > 0) {
          return false;
        }
      }

      if (!draftHasMeaningfulContent(draft) || !taskId) {
        return false;
      }
      const sendContextKeys = new Set<string>();

      try {
        let targetSessionId: string | null | undefined = activeSessionId;
        if (!targetSessionId) {
          targetSessionId = await startSession("composer_send");
        }

        if (!targetSessionId) {
          return false;
        }

        const targetComposerContextKey = buildAgentStudioAsyncActivityContextKey({
          activeWorkspace,
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
        await sendAgentMessage(
          targetSessionId,
          await resolveDraftToUserMessageParts(draft, async (attachment) => {
            if (attachment.file) {
              return stageLocalAttachmentFile(attachment.file);
            }
            if (attachment.path) {
              return attachment.path;
            }
            throw new Error(`Attachment "${attachment.name}" is missing local file data.`);
          }),
        );
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
      activeWorkspace,
      activeComposerContextKey,
      activeSessionId,
      activeSessionIsLoadingModelCatalog,
      activeSessionSelectedModel,
      agentStudioReady,
      canQueueBusyFollowups,
      isSending,
      isStarting,
      isWaitingInput,
      busySendBlockedReason,
      role,
      selectedTask,
      selectedModelDescriptor?.attachmentSupport,
      sendAgentMessage,
      startSession,
      taskId,
    ],
  );

  const onSubmitQuestionAnswers = useCallback(
    async (requestId: string, answers: string[][]): Promise<void> => {
      if (!activeSessionId || !agentStudioReady) {
        return;
      }

      setIsSubmittingQuestionByRequestId((current) => ({
        ...current,
        [requestId]: true,
      }));
      try {
        await answerAgentQuestion(activeSessionId, requestId, answers);
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
    [activeSessionId, agentStudioReady, answerAgentQuestion],
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
    const activeRequestIds = new Set(activeSessionPendingQuestions.map((entry) => entry.requestId));
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
  }, [activeSessionPendingQuestions]);

  const handleWorkflowStepSelect = useCallback(
    (nextRole: AgentRole, sessionId: string | null): void => {
      if (!taskId) {
        return;
      }

      const currentSessionId = activeSessionId;
      const currentRole = activeSessionRole;

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
        scheduleSelectionIntent?.({
          taskId,
          sessionId: null,
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
      scheduleSelectionIntent?.({
        taskId: session.taskId,
        sessionId: session.sessionId,
        role: session.role,
        scenario: session.scenario,
      });
    },
    [
      activeSessionId,
      activeSessionRole,
      onContextSwitchIntent,
      scenario,
      scheduleSelectionIntent,
      sessionsForTask,
      taskId,
      updateQuery,
    ],
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
          currentSessionId: activeSessionId,
          currentRole: activeSessionRole,
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
      scheduleSelectionIntent?.({
        taskId: selectedSession.taskId,
        sessionId: selectedSession.sessionId,
        role: selectedSession.role,
        scenario: selectedSession.scenario,
      });
    },
    [
      activeSessionId,
      activeSessionRole,
      onContextSwitchIntent,
      scheduleSelectionIntent,
      sessionsForTask,
      taskId,
      updateQuery,
    ],
  );

  const selectedRoleAvailable = selectedTask ? canStartSessionForRole(selectedTask, role) : false;
  const canKickoffNewSession =
    agentStudioReady &&
    Boolean(taskId) &&
    isActiveTaskHydrated &&
    !hasActiveSession &&
    selectedRoleAvailable &&
    isAgentKickoffScenario(scenario);
  const kickoffLabel =
    role === "spec"
      ? "Start Spec"
      : role === "planner"
        ? "Start Planner"
        : `Start ${SCENARIO_LABELS[scenario]}`;
  const canStopSession = hasActiveSession && isSessionWorking;

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

import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole, AgentScenario } from "@openducktor/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { isRoleAvailableForTask } from "@/lib/task-agent-workflows";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStateContextValue } from "@/types/state-slices";
import {
  captureOrchestratorFallback,
  runOrchestratorSideEffect,
} from "../state/operations/agent-orchestrator/support/async-side-effects";
import { firstScenario, kickoffPromptForScenario, SCENARIO_LABELS } from "./agents-page-constants";
import { buildRoleEnabledMapForTask, type SessionCreateOption } from "./agents-page-session-tabs";

type QueryUpdate = Record<string, string | undefined>;

export type SessionStartRequestReason = "create_session" | "composer_send" | "scenario_kickoff";

export type NewSessionStartRequest = {
  taskId: string;
  role: AgentRole;
  scenario: AgentScenario;
  startMode: "fresh" | "reuse_latest";
  reason: SessionStartRequestReason;
  selectedModel: AgentModelSelection | null;
};

export type NewSessionStartDecision = {
  selectedModel: AgentModelSelection | null;
} | null;

type UseAgentStudioSessionActionsArgs = {
  activeRepo: string | null;
  taskId: string;
  role: AgentRole;
  scenario: AgentScenario;
  autostart: boolean;
  sessionStartPreference: "fresh" | "continue" | null;
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
  requestNewSessionStart?: (request: NewSessionStartRequest) => Promise<NewSessionStartDecision>;
};

export function useAgentStudioSessionActions({
  activeRepo,
  taskId,
  role,
  scenario,
  autostart,
  sessionStartPreference,
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
  const [isStarting, setIsStarting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSubmittingQuestionByRequestId, setIsSubmittingQuestionByRequestId] = useState<
    Record<string, boolean>
  >({});

  const autoStartExecutedRef = useRef(new Set<string>());
  const previousRepoForSessionRefs = useRef<string | null>(activeRepo);
  const startingSessionByTaskRef = useRef(new Map<string, Promise<string | undefined>>());

  useEffect(() => {
    if (previousRepoForSessionRefs.current === activeRepo) {
      return;
    }
    previousRepoForSessionRefs.current = activeRepo;
    autoStartExecutedRef.current.clear();
    startingSessionByTaskRef.current.clear();
  }, [activeRepo]);

  const resolveRequestedSelection = useCallback(
    async (
      request: Omit<NewSessionStartRequest, "selectedModel">,
    ): Promise<AgentModelSelection | null | undefined> => {
      if (!requestNewSessionStart) {
        return selectionForNewSession ?? null;
      }
      const decision = await requestNewSessionStart({
        ...request,
        selectedModel: selectionForNewSession ?? null,
      });
      if (!decision) {
        return undefined;
      }
      return decision.selectedModel;
    },
    [requestNewSessionStart, selectionForNewSession],
  );

  const startSession = useCallback(
    async (reason: SessionStartRequestReason): Promise<string | undefined> => {
      if (!taskId || !agentStudioReady || !isActiveTaskHydrated) {
        return undefined;
      }
      if (selectedTask && !isRoleAvailableForTask(selectedTask, role)) {
        return undefined;
      }

      const isFreshStartRequested = sessionStartPreference === "fresh";

      if (activeSession && !isFreshStartRequested) {
        updateQuery({
          task: activeSession.taskId,
          session: activeSession.sessionId,
          agent: activeSession.role,
          scenario: activeSession.scenario,
          autostart: undefined,
          start: undefined,
        });
        return activeSession.sessionId;
      }

      if (sessionStartPreference === "continue") {
        const latestSessionForRole = sessionsForTask.find((entry) => entry.role === role);
        if (latestSessionForRole) {
          updateQuery({
            task: latestSessionForRole.taskId,
            session: latestSessionForRole.sessionId,
            agent: latestSessionForRole.role,
            scenario: latestSessionForRole.scenario,
            autostart: undefined,
          });
          return latestSessionForRole.sessionId;
        }
      }

      const inFlightSessionStart = startingSessionByTaskRef.current.get(taskId);
      if (inFlightSessionStart) {
        return inFlightSessionStart;
      }

      const startPromise = (async (): Promise<string | undefined> => {
        setIsStarting(true);
        try {
          const startMode = sessionStartPreference === "fresh" ? "fresh" : "reuse_latest";
          const selectedModel = await resolveRequestedSelection({
            taskId,
            role,
            scenario,
            startMode,
            reason,
          });
          if (selectedModel === undefined) {
            return undefined;
          }

          const sessionId = await startAgentSession({
            taskId,
            role,
            scenario,
            selectedModel,
            sendKickoff: false,
            startMode,
            requireModelReady: true,
          });
          if (selectedModel) {
            updateAgentSessionModel(sessionId, selectedModel);
          }
          updateQuery({
            task: taskId,
            agent: role,
            scenario,
            session: sessionId,
            autostart: undefined,
          });
          return sessionId;
        } finally {
          startingSessionByTaskRef.current.delete(taskId);
          setIsStarting(false);
        }
      })();

      startingSessionByTaskRef.current.set(taskId, startPromise);
      return startPromise;
    },
    [
      activeSession,
      agentStudioReady,
      isActiveTaskHydrated,
      resolveRequestedSelection,
      role,
      scenario,
      sessionStartPreference,
      sessionsForTask,
      selectedTask,
      startAgentSession,
      taskId,
      updateAgentSessionModel,
      updateQuery,
    ],
  );

  const startScenarioKickoff = useCallback(async (): Promise<void> => {
    if (!taskId || !agentStudioReady) {
      return;
    }
    if (selectedTask && !isRoleAvailableForTask(selectedTask, role)) {
      return;
    }
    const sessionId = await startSession("scenario_kickoff");
    if (!sessionId) {
      updateQuery({ autostart: undefined });
      return;
    }
    await sendAgentMessage(sessionId, kickoffPromptForScenario(role, scenario, taskId));
  }, [
    agentStudioReady,
    role,
    scenario,
    selectedTask,
    sendAgentMessage,
    startSession,
    taskId,
    updateQuery,
  ]);

  const autoStartKey = activeRepo && taskId ? `${activeRepo}:${taskId}:${role}:${scenario}` : null;
  const hasAutoStartExecuted = autoStartKey
    ? autoStartExecutedRef.current.has(autoStartKey)
    : false;
  const isFreshStartRequested = sessionStartPreference === "fresh";
  const isAutoStartPending = Boolean(
    autostart &&
      autoStartKey &&
      (isFreshStartRequested || !activeSession) &&
      agentStudioReady &&
      !hasAutoStartExecuted,
  );

  useEffect(() => {
    if (
      !autostart ||
      !activeRepo ||
      !taskId ||
      (!isFreshStartRequested && activeSession) ||
      !agentStudioReady ||
      !isActiveTaskHydrated
    ) {
      return;
    }
    if (!autoStartKey) {
      return;
    }
    if (autoStartExecutedRef.current.has(autoStartKey)) {
      return;
    }
    autoStartExecutedRef.current.add(autoStartKey);
    void startScenarioKickoff();
  }, [
    autoStartKey,
    activeRepo,
    activeSession,
    agentStudioReady,
    autostart,
    isFreshStartRequested,
    isActiveTaskHydrated,
    startScenarioKickoff,
    taskId,
  ]);

  const onSend = useCallback(async (): Promise<void> => {
    if (isSending || isStarting || !agentStudioReady) {
      return;
    }
    if (selectedTask && !isRoleAvailableForTask(selectedTask, role)) {
      return;
    }
    if (activeSession?.isLoadingModelCatalog && !activeSession.selectedModel) {
      return;
    }

    const message = input.trim();
    if (!message || !taskId) {
      return;
    }

    let targetSessionId = sessionStartPreference === "fresh" ? undefined : activeSession?.sessionId;
    if (!targetSessionId) {
      targetSessionId = await startSession("composer_send");
    }

    if (!targetSessionId) {
      return;
    }

    setInput("");
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
    selectedTask,
    role,
    sessionStartPreference,
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

  const activeSessionStatus = activeSession?.status ?? "stopped";
  const activeSessionId = activeSession?.sessionId ?? null;
  const isSessionWorking =
    Boolean(activeSession) &&
    (activeSessionStatus === "running" || activeSessionStatus === "starting" || isSending);

  useEffect(() => {
    if (!isSending) {
      return;
    }
    if (activeSessionStatus !== "starting" && activeSessionStatus !== "running") {
      setIsSending(false);
      return;
    }
    setIsSending(false);
  }, [activeSessionStatus, isSending]);

  useEffect(() => {
    setIsSubmittingQuestionByRequestId((current) => {
      if (activeSessionId === null && Object.keys(current).length === 0) {
        return current;
      }
      return {};
    });
    setInput("");
  }, [activeSessionId, setInput]);

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
        if (currentSessionId !== null || currentRole !== nextRole) {
          onContextSwitchIntent?.();
        }

        updateQuery({
          task: taskId,
          session: undefined,
          agent: nextRole,
          scenario: firstScenario(nextRole),
          autostart: undefined,
        });
        return;
      }
      const session = sessionsForTask.find((entry) => entry.sessionId === sessionId);
      if (!session) {
        return;
      }

      if (session.sessionId !== currentSessionId || session.role !== currentRole) {
        onContextSwitchIntent?.();
      }

      updateQuery({
        task: session.taskId,
        session: session.sessionId,
        agent: session.role,
        scenario: session.scenario,
        autostart: undefined,
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

      if (activeSession?.sessionId !== selectedSession.sessionId) {
        onContextSwitchIntent?.();
      }

      updateQuery({
        task: selectedSession.taskId,
        session: selectedSession.sessionId,
        agent: selectedSession.role,
        scenario: selectedSession.scenario,
        autostart: undefined,
      });
    },
    [activeSession?.sessionId, onContextSwitchIntent, sessionsForTask, taskId, updateQuery],
  );

  const handleCreateSession = useCallback(
    (option: SessionCreateOption): void => {
      const { role: nextRole, scenario: nextScenario } = option;
      if (!taskId || !agentStudioReady || !isActiveTaskHydrated) {
        return;
      }
      if (activeSession && isSessionWorking) {
        return;
      }

      const roleEnabledByTask = buildRoleEnabledMapForTask(selectedTask);
      const canStartFreshSession =
        nextRole === "spec"
          ? roleEnabledByTask.spec
          : nextRole === "planner"
            ? roleEnabledByTask.planner
            : roleEnabledByTask[nextRole];

      if (!canStartFreshSession) {
        return;
      }

      const startKey = `${taskId}:${nextRole}:${nextScenario}`;
      const existing = startingSessionByTaskRef.current.get(startKey);
      if (existing) {
        void existing;
        return;
      }

      const previousSelection: QueryUpdate = {
        task: activeSession?.taskId ?? taskId,
        session: activeSession?.sessionId,
        agent: role,
        scenario,
        autostart: undefined,
        start: undefined,
      };

      const startPromise = (async (): Promise<string | undefined> => {
        try {
          setIsStarting(true);
          const selectedModel = await resolveRequestedSelection({
            taskId,
            role: nextRole,
            scenario: nextScenario,
            startMode: "fresh",
            reason: "create_session",
          });
          if (selectedModel === undefined) {
            return undefined;
          }

          if (
            (activeSession?.sessionId ?? null) !== null ||
            (activeSession?.role ?? role) !== nextRole
          ) {
            onContextSwitchIntent?.();
          }

          updateQuery({
            task: taskId,
            session: undefined,
            agent: nextRole,
            scenario: nextScenario,
            autostart: undefined,
            start: "fresh",
          });

          const sessionId = await captureOrchestratorFallback<string | undefined>(
            "agent-studio-start-fresh-session",
            async () =>
              startAgentSession({
                taskId,
                role: nextRole,
                scenario: nextScenario,
                selectedModel,
                sendKickoff: false,
                startMode: "fresh",
                requireModelReady: true,
              }),
            {
              tags: {
                repoPath: activeRepo,
                taskId,
                role: nextRole,
                scenario: nextScenario,
              },
              fallback: () => {
                updateQuery(previousSelection);
                return undefined;
              },
            },
          );
          if (!sessionId) {
            updateQuery(previousSelection);
            return undefined;
          }
          updateQuery({
            task: taskId,
            session: sessionId,
            agent: nextRole,
            scenario: nextScenario,
            autostart: undefined,
            start: undefined,
          });
          runOrchestratorSideEffect(
            "agent-studio-send-kickoff-message",
            sendAgentMessage(sessionId, kickoffPromptForScenario(nextRole, nextScenario, taskId)),
            {
              tags: {
                repoPath: activeRepo,
                taskId,
                role: nextRole,
                scenario: nextScenario,
                sessionId,
              },
            },
          );
          return sessionId;
        } finally {
          setIsStarting(false);
        }
      })();

      startingSessionByTaskRef.current.set(startKey, startPromise);
      void startPromise.finally(() => {
        if (startingSessionByTaskRef.current.get(startKey) === startPromise) {
          startingSessionByTaskRef.current.delete(startKey);
        }
      });
    },
    [
      activeSession,
      agentStudioReady,
      isActiveTaskHydrated,
      isSessionWorking,
      selectedTask,
      resolveRequestedSelection,
      role,
      scenario,
      activeRepo,
      sendAgentMessage,
      onContextSwitchIntent,
      startAgentSession,
      taskId,
      updateQuery,
    ],
  );

  const selectedRoleAvailable = selectedTask ? isRoleAvailableForTask(selectedTask, role) : false;
  const canKickoffNewSession =
    agentStudioReady &&
    Boolean(taskId) &&
    isActiveTaskHydrated &&
    !activeSession &&
    selectedRoleAvailable;
  const kickoffLabel =
    role === "spec"
      ? "Start Spec"
      : role === "planner"
        ? "Start Planner"
        : `Start ${SCENARIO_LABELS[scenario]}`;
  const canStopSession = Boolean(activeSession && isSessionWorking);

  return {
    isStarting: isStarting || isAutoStartPending,
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

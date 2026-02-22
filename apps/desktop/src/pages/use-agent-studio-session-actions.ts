import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStateContextValue } from "@/types/state-slices";
import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole, AgentScenario } from "@openducktor/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { SCENARIO_LABELS, kickoffPromptForScenario } from "./agents-page-constants";
import { buildRoleEnabledMapForTask } from "./agents-page-session-tabs";

type QueryUpdate = Record<string, string | undefined>;

type UseAgentStudioSessionActionsArgs = {
  activeRepo: string | null;
  taskId: string;
  role: AgentRole;
  scenario: AgentScenario;
  autostart: boolean;
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
};

export function useAgentStudioSessionActions({
  activeRepo,
  taskId,
  role,
  scenario,
  autostart,
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
  handleCreateSession: (nextRole: AgentRole, nextScenario: AgentScenario) => void;
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

  const startSession = useCallback(async (): Promise<string | undefined> => {
    if (!taskId || !agentStudioReady || !isActiveTaskHydrated) {
      return undefined;
    }

    if (activeSession) {
      updateQuery({
        task: activeSession.taskId,
        session: activeSession.sessionId,
        autostart: undefined,
      });
      return activeSession.sessionId;
    }

    const inFlightSessionStart = startingSessionByTaskRef.current.get(taskId);
    if (inFlightSessionStart) {
      return inFlightSessionStart;
    }

    const startPromise = (async (): Promise<string | undefined> => {
      setIsStarting(true);
      try {
        const sessionId = await startAgentSession({ taskId, role, scenario, sendKickoff: false });
        if (selectionForNewSession) {
          updateAgentSessionModel(sessionId, selectionForNewSession);
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
  }, [
    activeSession,
    agentStudioReady,
    isActiveTaskHydrated,
    role,
    scenario,
    selectionForNewSession,
    startAgentSession,
    taskId,
    updateAgentSessionModel,
    updateQuery,
  ]);

  const startScenarioKickoff = useCallback(async (): Promise<void> => {
    if (!taskId || !agentStudioReady) {
      return;
    }
    const sessionId = await startSession();
    if (!sessionId) {
      return;
    }
    await sendAgentMessage(sessionId, kickoffPromptForScenario(role, scenario, taskId));
  }, [agentStudioReady, role, scenario, sendAgentMessage, startSession, taskId]);

  useEffect(() => {
    if (
      !autostart ||
      !activeRepo ||
      !taskId ||
      activeSession ||
      !agentStudioReady ||
      !isActiveTaskHydrated
    ) {
      return;
    }
    const key = `${activeRepo}:${taskId}:${role}:${scenario}`;
    if (autoStartExecutedRef.current.has(key)) {
      return;
    }
    autoStartExecutedRef.current.add(key);
    void startScenarioKickoff();
  }, [
    activeRepo,
    activeSession,
    agentStudioReady,
    autostart,
    isActiveTaskHydrated,
    role,
    scenario,
    startScenarioKickoff,
    taskId,
  ]);

  const onSend = useCallback(async (): Promise<void> => {
    if (isSending || isStarting || !agentStudioReady) {
      return;
    }

    const message = input.trim();
    if (!message || !taskId) {
      return;
    }

    let targetSessionId = activeSession?.sessionId;
    if (!targetSessionId) {
      targetSessionId = await startSession();
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: Session change must reset submit state map.
  useEffect(() => {
    setIsSubmittingQuestionByRequestId({});
  }, [activeSession?.sessionId]);

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
    (_nextRole: AgentRole, sessionId: string | null): void => {
      if (!sessionId) {
        return;
      }
      const session = sessionsForTask.find((entry) => entry.sessionId === sessionId);
      if (!session) {
        return;
      }
      updateQuery({
        task: session.taskId,
        session: session.sessionId,
        autostart: undefined,
      });
    },
    [sessionsForTask, updateQuery],
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
      updateQuery({
        task: selectedSession.taskId,
        session: selectedSession.sessionId,
        autostart: undefined,
      });
    },
    [sessionsForTask, taskId, updateQuery],
  );

  const handleCreateSession = useCallback(
    (nextRole: AgentRole, nextScenario: AgentScenario): void => {
      if (!taskId || !agentStudioReady || !isActiveTaskHydrated) {
        return;
      }
      if (activeSession && isSessionWorking) {
        return;
      }

      const roleEnabledByTask = buildRoleEnabledMapForTask(selectedTask);
      if (!roleEnabledByTask[nextRole]) {
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
      };

      updateQuery({
        task: taskId,
        session: undefined,
        agent: nextRole,
        scenario: nextScenario,
        autostart: undefined,
      });

      const startPromise = (async (): Promise<string | undefined> => {
        try {
          setIsStarting(true);
          const sessionId = await startAgentSession({
            taskId,
            role: nextRole,
            scenario: nextScenario,
            sendKickoff: true,
          });
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
          });
          return sessionId;
        } catch {
          updateQuery(previousSelection);
          return undefined;
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
      role,
      scenario,
      startAgentSession,
      taskId,
      updateQuery,
    ],
  );

  const canKickoffNewSession =
    agentStudioReady && Boolean(taskId) && isActiveTaskHydrated && !activeSession;
  const kickoffLabel = role === "spec" ? "Start Spec" : `Start ${SCENARIO_LABELS[scenario]}`;
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

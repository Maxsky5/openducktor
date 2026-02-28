import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole, AgentScenario } from "@openducktor/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStateContextValue } from "@/types/state-slices";
import {
  captureOrchestratorFallback,
  runOrchestratorSideEffect,
} from "../state/operations/agent-orchestrator/support/async-side-effects";
import { kickoffPromptForScenario } from "./agents-page-constants";
import { buildRoleEnabledMapForTask, type SessionCreateOption } from "./agents-page-session-tabs";
import {
  buildAutoStartKey,
  buildCreateSessionStartKey,
  buildFreshStartQueryUpdate,
  buildPreviousSelectionQueryUpdate,
  buildSessionSelectionQueryUpdate,
  canStartSessionForRole,
  type QueryUpdate,
  resolveReusableSessionForStart,
  shouldTriggerContextSwitchIntent,
} from "./use-agent-studio-session-action-helpers";
import type {
  NewSessionStartRequest,
  RequestNewSessionStart,
  SessionStartRequestReason,
} from "./use-agent-studio-session-start-types";

type UseAgentStudioSessionStartFlowArgs = {
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
  isSessionWorking: boolean;
  selectionForNewSession: AgentModelSelection | null;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
  updateAgentSessionModel: AgentStateContextValue["updateAgentSessionModel"];
  updateQuery: (updates: QueryUpdate) => void;
  onContextSwitchIntent?: () => void;
  requestNewSessionStart?: RequestNewSessionStart;
};

export function useAgentStudioSessionStartFlow({
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
  isSessionWorking,
  selectionForNewSession,
  startAgentSession,
  sendAgentMessage,
  updateAgentSessionModel,
  updateQuery,
  onContextSwitchIntent,
  requestNewSessionStart,
}: UseAgentStudioSessionStartFlowArgs): {
  isStarting: boolean;
  isAutoStartPending: boolean;
  startSession: (reason: SessionStartRequestReason) => Promise<string | undefined>;
  startScenarioKickoff: () => Promise<void>;
  handleCreateSession: (option: SessionCreateOption) => void;
} {
  const [isStarting, setIsStarting] = useState(false);

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

  const applySessionSelectionQuery = useCallback(
    (params: {
      taskId: string;
      sessionId: string | undefined;
      role: AgentRole;
      scenario: AgentScenario;
      clearStart?: boolean;
    }): void => {
      updateQuery(
        buildSessionSelectionQueryUpdate({
          taskId: params.taskId,
          sessionId: params.sessionId,
          role: params.role,
          scenario: params.scenario,
          clearAutostart: true,
          ...(params.clearStart !== undefined ? { clearStart: params.clearStart } : {}),
        }),
      );
    },
    [updateQuery],
  );

  const startRequestedSession = useCallback(
    async (params: {
      reason: SessionStartRequestReason;
      startMode: "fresh" | "reuse_latest";
    }): Promise<string | undefined> => {
      if (!taskId) {
        return undefined;
      }

      setIsStarting(true);
      try {
        const selectedModel = await resolveRequestedSelection({
          taskId,
          role,
          scenario,
          startMode: params.startMode,
          reason: params.reason,
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
          startMode: params.startMode,
          requireModelReady: true,
        });

        if (selectedModel) {
          updateAgentSessionModel(sessionId, selectedModel);
        }

        applySessionSelectionQuery({
          taskId,
          sessionId,
          role,
          scenario,
        });
        return sessionId;
      } finally {
        setIsStarting(false);
      }
    },
    [
      applySessionSelectionQuery,
      resolveRequestedSelection,
      role,
      scenario,
      startAgentSession,
      taskId,
      updateAgentSessionModel,
    ],
  );

  const startSession = useCallback(
    async (reason: SessionStartRequestReason): Promise<string | undefined> => {
      if (!taskId || !agentStudioReady || !isActiveTaskHydrated) {
        return undefined;
      }
      if (!canStartSessionForRole(selectedTask, role)) {
        return undefined;
      }

      const reusableSession = resolveReusableSessionForStart({
        activeSession,
        sessionStartPreference,
        sessionsForTask,
        role,
      });
      if (reusableSession) {
        applySessionSelectionQuery({
          taskId: reusableSession.session.taskId,
          sessionId: reusableSession.session.sessionId,
          role: reusableSession.session.role,
          scenario: reusableSession.session.scenario,
          clearStart: reusableSession.clearStart,
        });
        return reusableSession.session.sessionId;
      }

      const inFlightSessionStart = startingSessionByTaskRef.current.get(taskId);
      if (inFlightSessionStart) {
        return inFlightSessionStart;
      }

      const startMode = sessionStartPreference === "fresh" ? "fresh" : "reuse_latest";
      const startPromise = startRequestedSession({
        reason,
        startMode,
      });

      startingSessionByTaskRef.current.set(taskId, startPromise);
      void startPromise.finally(() => {
        if (startingSessionByTaskRef.current.get(taskId) === startPromise) {
          startingSessionByTaskRef.current.delete(taskId);
        }
      });

      return startPromise;
    },
    [
      activeSession,
      agentStudioReady,
      applySessionSelectionQuery,
      isActiveTaskHydrated,
      role,
      selectedTask,
      sessionStartPreference,
      sessionsForTask,
      startRequestedSession,
      taskId,
    ],
  );

  const startScenarioKickoff = useCallback(async (): Promise<void> => {
    if (!taskId || !agentStudioReady) {
      return;
    }
    if (!canStartSessionForRole(selectedTask, role)) {
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

  const autoStartKey = buildAutoStartKey({
    activeRepo,
    taskId,
    role,
    scenario,
  });
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

  const restorePreviousSelection = useCallback(
    (selection: QueryUpdate): void => {
      updateQuery(selection);
    },
    [updateQuery],
  );

  const applyFreshSessionDraftQuery = useCallback(
    (nextRole: AgentRole, nextScenario: AgentScenario): void => {
      if (!taskId) {
        return;
      }
      updateQuery(
        buildFreshStartQueryUpdate({
          taskId,
          role: nextRole,
          scenario: nextScenario,
        }),
      );
    },
    [taskId, updateQuery],
  );

  const applyFreshSessionSelectionQuery = useCallback(
    (sessionId: string, nextRole: AgentRole, nextScenario: AgentScenario): void => {
      if (!taskId) {
        return;
      }
      updateQuery(
        buildSessionSelectionQueryUpdate({
          taskId,
          sessionId,
          role: nextRole,
          scenario: nextScenario,
          clearAutostart: true,
          clearStart: true,
        }),
      );
    },
    [taskId, updateQuery],
  );

  const sendFreshSessionKickoff = useCallback(
    (sessionId: string, nextRole: AgentRole, nextScenario: AgentScenario): void => {
      if (!taskId) {
        return;
      }
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
    },
    [activeRepo, sendAgentMessage, taskId],
  );

  const triggerContextSwitchForFreshCreate = useCallback(
    (nextRole: AgentRole): void => {
      if (
        shouldTriggerContextSwitchIntent({
          currentSessionId: activeSession?.sessionId ?? null,
          currentRole: activeSession?.role ?? role,
          nextSessionId: null,
          nextRole,
        })
      ) {
        onContextSwitchIntent?.();
      }
    },
    [activeSession, onContextSwitchIntent, role],
  );

  const runFreshSessionCreation = useCallback(
    async (params: {
      nextRole: AgentRole;
      nextScenario: AgentScenario;
      previousSelection: QueryUpdate;
    }): Promise<string | undefined> => {
      if (!taskId) {
        return undefined;
      }

      setIsStarting(true);
      try {
        const selectedModel = await resolveRequestedSelection({
          taskId,
          role: params.nextRole,
          scenario: params.nextScenario,
          startMode: "fresh",
          reason: "create_session",
        });
        if (selectedModel === undefined) {
          return undefined;
        }

        triggerContextSwitchForFreshCreate(params.nextRole);
        applyFreshSessionDraftQuery(params.nextRole, params.nextScenario);

        const sessionId = await captureOrchestratorFallback<string | undefined>(
          "agent-studio-start-fresh-session",
          async () =>
            startAgentSession({
              taskId,
              role: params.nextRole,
              scenario: params.nextScenario,
              selectedModel,
              sendKickoff: false,
              startMode: "fresh",
              requireModelReady: true,
            }),
          {
            tags: {
              repoPath: activeRepo,
              taskId,
              role: params.nextRole,
              scenario: params.nextScenario,
            },
            fallback: () => {
              restorePreviousSelection(params.previousSelection);
              return undefined;
            },
          },
        );
        if (!sessionId) {
          restorePreviousSelection(params.previousSelection);
          return undefined;
        }

        applyFreshSessionSelectionQuery(sessionId, params.nextRole, params.nextScenario);
        sendFreshSessionKickoff(sessionId, params.nextRole, params.nextScenario);
        return sessionId;
      } finally {
        setIsStarting(false);
      }
    },
    [
      activeRepo,
      applyFreshSessionDraftQuery,
      applyFreshSessionSelectionQuery,
      resolveRequestedSelection,
      restorePreviousSelection,
      sendFreshSessionKickoff,
      startAgentSession,
      taskId,
      triggerContextSwitchForFreshCreate,
    ],
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
      if (!roleEnabledByTask[nextRole]) {
        return;
      }

      const startKey = buildCreateSessionStartKey({
        taskId,
        role: nextRole,
        scenario: nextScenario,
      });
      const existing = startingSessionByTaskRef.current.get(startKey);
      if (existing) {
        void existing;
        return;
      }

      const previousSelection = buildPreviousSelectionQueryUpdate({
        activeSession,
        taskId,
        role,
        scenario,
      });

      const startPromise = runFreshSessionCreation({
        nextRole,
        nextScenario,
        previousSelection,
      });
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
      role,
      runFreshSessionCreation,
      scenario,
      selectedTask,
      taskId,
    ],
  );

  return {
    isStarting,
    isAutoStartPending,
    startSession,
    startScenarioKickoff,
    handleCreateSession,
  };
}

import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole, AgentScenario } from "@openducktor/core";
import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback } from "react";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStateContextValue } from "@/types/state-slices";
import {
  captureOrchestratorFallback,
  runOrchestratorSideEffect,
} from "../state/operations/agent-orchestrator/support/async-side-effects";
import { kickoffPromptForScenario } from "./agents-page-constants";
import { buildRoleEnabledMapForTask, type SessionCreateOption } from "./agents-page-session-tabs";
import {
  buildAgentStudioSelectionQueryUpdate,
  buildCreateSessionStartKey,
  buildFreshStartQueryUpdate,
  buildPreviousSelectionQueryUpdate,
  type QueryUpdate,
  shouldTriggerContextSwitchIntent,
} from "./use-agent-studio-session-action-helpers";
import type { NewSessionStartRequest } from "./use-agent-studio-session-start-types";

type UseAgentStudioFreshSessionCreationArgs = {
  activeRepo: string | null;
  taskId: string;
  role: AgentRole;
  scenario: AgentScenario;
  activeSession: AgentSessionState | null;
  selectedTask: TaskCard | null;
  agentStudioReady: boolean;
  isActiveTaskHydrated: boolean;
  isSessionWorking: boolean;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
  updateQuery: (updates: QueryUpdate) => void;
  onContextSwitchIntent?: () => void;
  setIsStarting: Dispatch<SetStateAction<boolean>>;
  startingSessionByTaskRef: MutableRefObject<Map<string, Promise<string | undefined>>>;
  resolveRequestedSelection: (
    request: Omit<NewSessionStartRequest, "selectedModel">,
  ) => Promise<AgentModelSelection | null | undefined>;
};

export function useAgentStudioFreshSessionCreation({
  activeRepo,
  taskId,
  role,
  scenario,
  activeSession,
  selectedTask,
  agentStudioReady,
  isActiveTaskHydrated,
  isSessionWorking,
  startAgentSession,
  sendAgentMessage,
  updateQuery,
  onContextSwitchIntent,
  setIsStarting,
  startingSessionByTaskRef,
  resolveRequestedSelection,
}: UseAgentStudioFreshSessionCreationArgs): {
  handleCreateSession: (option: SessionCreateOption) => void;
} {
  const applyFreshSessionDraftQuery = useCallback(
    (nextRole: AgentRole, nextScenario: AgentScenario): void => {
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
      updateQuery(
        buildAgentStudioSelectionQueryUpdate({
          taskId,
          sessionId,
          role: nextRole,
          scenario: nextScenario,
          clearStart: true,
        }),
      );
    },
    [taskId, updateQuery],
  );

  const sendFreshSessionKickoff = useCallback(
    (sessionId: string, nextRole: AgentRole, nextScenario: AgentScenario): void => {
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

  const startFreshSessionWithFallback = useCallback(
    async (params: {
      nextRole: AgentRole;
      nextScenario: AgentScenario;
      selectedModel: AgentModelSelection | null;
      previousSelection: QueryUpdate;
    }): Promise<string | undefined> => {
      const sessionId = await captureOrchestratorFallback<string | undefined>(
        "agent-studio-start-fresh-session",
        async () =>
          startAgentSession({
            taskId,
            role: params.nextRole,
            scenario: params.nextScenario,
            selectedModel: params.selectedModel,
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
            updateQuery(params.previousSelection);
            return undefined;
          },
        },
      );

      if (!sessionId) {
        updateQuery(params.previousSelection);
        return undefined;
      }

      return sessionId;
    },
    [activeRepo, startAgentSession, taskId, updateQuery],
  );

  const runFreshSessionCreation = useCallback(
    async (params: {
      nextRole: AgentRole;
      nextScenario: AgentScenario;
      previousSelection: QueryUpdate;
    }): Promise<string | undefined> => {
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

        if (
          shouldTriggerContextSwitchIntent({
            currentSessionId: activeSession?.sessionId ?? null,
            currentRole: activeSession?.role ?? role,
            nextSessionId: null,
            nextRole: params.nextRole,
          })
        ) {
          onContextSwitchIntent?.();
        }

        applyFreshSessionDraftQuery(params.nextRole, params.nextScenario);
        const sessionId = await startFreshSessionWithFallback({
          nextRole: params.nextRole,
          nextScenario: params.nextScenario,
          selectedModel,
          previousSelection: params.previousSelection,
        });
        if (!sessionId) {
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
      activeSession,
      applyFreshSessionDraftQuery,
      applyFreshSessionSelectionQuery,
      onContextSwitchIntent,
      resolveRequestedSelection,
      role,
      sendFreshSessionKickoff,
      setIsStarting,
      startFreshSessionWithFallback,
      taskId,
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
      if (startingSessionByTaskRef.current.has(startKey)) {
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
      startingSessionByTaskRef,
      taskId,
    ],
  );

  return {
    handleCreateSession,
  };
}

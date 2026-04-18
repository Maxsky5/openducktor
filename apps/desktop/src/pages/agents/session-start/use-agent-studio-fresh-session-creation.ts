import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentScenario } from "@openducktor/core";
import { useQueryClient } from "@tanstack/react-query";
import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback } from "react";
import { toast } from "sonner";
import {
  executeSessionStartFromDecision,
  type ResolvedSessionStartDecision,
  type SessionStartFlowRequest,
} from "@/features/session-start";
import { errorMessage } from "@/lib/errors";
import { AGENT_ROLE_LABELS } from "@/types";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace, AgentStateContextValue } from "@/types/state-slices";
import { buildRoleEnabledMapForTask, type SessionCreateOption } from "../agents-page-session-tabs";
import {
  buildAgentStudioAsyncActivityContextKey,
  buildAgentStudioSelectionQueryUpdate,
  buildCreateSessionStartKey,
  decrementActivityCountRecord,
  incrementActivityCountRecord,
  type QueryUpdate,
  shouldTriggerContextSwitchIntent,
} from "../use-agent-studio-session-action-helpers";

type UseAgentStudioFreshSessionCreationArgs = {
  activeWorkspace: ActiveWorkspace | null;
  taskId: string;
  role: AgentRole;
  activeSession: AgentSessionState | null;
  selectedTask: TaskCard | null;
  agentStudioReady: boolean;
  isActiveTaskHydrated: boolean;
  isSessionWorking: boolean;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
  updateQuery: (updates: QueryUpdate) => void;
  onContextSwitchIntent?: () => void;
  setStartingActivityCountByContext: Dispatch<SetStateAction<Record<string, number>>>;
  startingSessionByTaskRef: MutableRefObject<Map<string, Promise<string | undefined>>>;
  onPostStartActionError?: (action: "kickoff", error: Error) => void;
  executeRequestedSessionStart: <T>(
    request: SessionStartFlowRequest,
    executeWithDecision: (decision: ResolvedSessionStartDecision) => Promise<T | undefined>,
  ) => Promise<T | undefined>;
};

export function useAgentStudioFreshSessionCreation({
  activeWorkspace,
  taskId,
  role,
  activeSession,
  selectedTask,
  agentStudioReady,
  isActiveTaskHydrated,
  isSessionWorking,
  startAgentSession,
  sendAgentMessage,
  updateQuery,
  onContextSwitchIntent,
  setStartingActivityCountByContext,
  startingSessionByTaskRef,
  onPostStartActionError,
  executeRequestedSessionStart,
}: UseAgentStudioFreshSessionCreationArgs): {
  handleCreateSession: (option: SessionCreateOption) => void;
} {
  const queryClient = useQueryClient();
  const applyFreshSessionSelectionQuery = useCallback(
    (sessionId: string, nextRole: AgentRole, nextScenario: AgentScenario): void => {
      updateQuery(
        buildAgentStudioSelectionQueryUpdate({
          taskId,
          sessionId,
          role: nextRole,
          scenario: nextScenario,
        }),
      );
    },
    [taskId, updateQuery],
  );

  const runFreshSessionCreation = useCallback(
    async (params: {
      nextRole: AgentRole;
      nextScenario: AgentScenario;
    }): Promise<string | undefined> => {
      const startContextKey = buildAgentStudioAsyncActivityContextKey({
        activeWorkspace,
        taskId,
        role: params.nextRole,
        sessionId: null,
      });
      const executeStartedSession = async (
        decision: ResolvedSessionStartDecision,
      ): Promise<string | undefined> => {
        setStartingActivityCountByContext((current) =>
          incrementActivityCountRecord(current, startContextKey),
        );
        try {
          if (
            shouldTriggerContextSwitchIntent({
              currentSessionId: activeSession?.sessionId ?? null,
              currentRole: activeSession?.role ?? role,
              nextSessionId: decision.startMode === "reuse" ? decision.sourceSessionId : null,
              nextRole: params.nextRole,
            })
          ) {
            onContextSwitchIntent?.();
          }

          try {
            const workflow = await executeSessionStartFromDecision({
              activeWorkspace,
              queryClient,
              request: {
                taskId,
                role: params.nextRole,
                scenario: params.nextScenario,
                postStartAction: "kickoff",
              },
              decision,
              task: selectedTask,
              startAgentSession,
              sendAgentMessage,
              postStartExecution: "detached",
              ...(onPostStartActionError
                ? {
                    onPostStartActionError: (
                      action: "kickoff" | "send_message" | "none",
                      error: Error,
                    ) => {
                      if (action === "kickoff") {
                        onPostStartActionError(action, error);
                      }
                    },
                  }
                : {}),
            });
            if (!workflow) {
              return undefined;
            }

            const sessionId = workflow.sessionId;
            if (!sessionId) {
              return undefined;
            }

            applyFreshSessionSelectionQuery(sessionId, params.nextRole, params.nextScenario);
            return sessionId;
          } catch (error) {
            const roleLabel = AGENT_ROLE_LABELS[params.nextRole] ?? params.nextRole.toUpperCase();
            toast.error(`Failed to start ${roleLabel} session`, {
              description: errorMessage(error),
            });
            return undefined;
          }
        } finally {
          setStartingActivityCountByContext((current) =>
            decrementActivityCountRecord(current, startContextKey),
          );
        }
      };

      return executeRequestedSessionStart(
        {
          taskId,
          role: params.nextRole,
          scenario: params.nextScenario,
          postStartAction: "kickoff",
        },
        executeStartedSession,
      );
    },
    [
      activeSession,
      activeWorkspace,
      applyFreshSessionSelectionQuery,
      onContextSwitchIntent,
      onPostStartActionError,
      executeRequestedSessionStart,
      queryClient,
      role,
      selectedTask,
      sendAgentMessage,
      setStartingActivityCountByContext,
      startAgentSession,
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

      const startPromise = runFreshSessionCreation({
        nextRole,
        nextScenario,
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
      runFreshSessionCreation,
      selectedTask,
      startingSessionByTaskRef,
      taskId,
    ],
  );

  return {
    handleCreateSession,
  };
}

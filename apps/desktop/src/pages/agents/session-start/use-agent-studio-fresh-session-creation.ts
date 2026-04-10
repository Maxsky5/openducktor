import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentScenario } from "@openducktor/core";
import { useQueryClient } from "@tanstack/react-query";
import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback } from "react";
import { toast } from "sonner";
import {
  type NewSessionStartDecision,
  type NewSessionStartRequest,
  type SessionStartWorkflowResult,
  startSessionWorkflow,
} from "@/features/session-start";
import { errorMessage, hasErrorToastShown } from "@/lib/errors";
import { AGENT_ROLE_LABELS } from "@/types";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStateContextValue } from "@/types/state-slices";
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

type ResolvedSessionStartDecision = Exclude<NewSessionStartDecision, null>;

type UseAgentStudioFreshSessionCreationArgs = {
  activeRepo: string | null;
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
    request: Omit<NewSessionStartRequest, "selectedModel">,
    executeWithDecision: (decision: ResolvedSessionStartDecision) => Promise<T | undefined>,
  ) => Promise<T | undefined>;
};

export function useAgentStudioFreshSessionCreation({
  activeRepo,
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
        activeRepo,
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
          if (decision.startMode === "reuse") {
            let workflow: SessionStartWorkflowResult;
            try {
              workflow = await startSessionWorkflow({
                activeRepo,
                queryClient,
                intent: {
                  taskId,
                  role: params.nextRole,
                  scenario: params.nextScenario,
                  startMode: "reuse",
                  sourceSessionId: decision.sourceSessionId,
                  postStartAction: "kickoff",
                },
                selection: null,
                task: selectedTask,
                startAgentSession,
                sendAgentMessage,
                postStartExecution: "detached",
                onDetachedPostStartError: onPostStartActionError
                  ? (error) => onPostStartActionError("kickoff", error)
                  : undefined,
              });
            } catch (error) {
              const roleLabel = AGENT_ROLE_LABELS[params.nextRole] ?? params.nextRole.toUpperCase();
              if (!hasErrorToastShown(error)) {
                toast.error(`Failed to start ${roleLabel} session`, {
                  description: errorMessage(error),
                });
              }
              return undefined;
            }
            if (
              shouldTriggerContextSwitchIntent({
                currentSessionId: activeSession?.sessionId ?? null,
                currentRole: activeSession?.role ?? role,
                nextSessionId: decision.sourceSessionId,
                nextRole: params.nextRole,
              })
            ) {
              onContextSwitchIntent?.();
            }
            applyFreshSessionSelectionQuery(
              workflow.sessionId,
              params.nextRole,
              params.nextScenario,
            );
            return workflow.sessionId;
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

          let workflow: SessionStartWorkflowResult | undefined;
          try {
            workflow = await startSessionWorkflow({
              activeRepo,
              queryClient,
              intent: {
                taskId,
                role: params.nextRole,
                scenario: params.nextScenario,
                startMode: decision.startMode,
                ...(decision.startMode === "fork"
                  ? { sourceSessionId: decision.sourceSessionId }
                  : {}),
                postStartAction: "kickoff",
              },
              selection: decision.selectedModel,
              task: selectedTask,
              startAgentSession,
              sendAgentMessage,
              postStartExecution: "detached",
              onDetachedPostStartError: onPostStartActionError
                ? (error) => onPostStartActionError("kickoff", error)
                : undefined,
            });
          } catch (error) {
            const roleLabel = AGENT_ROLE_LABELS[params.nextRole] ?? params.nextRole.toUpperCase();
            if (!hasErrorToastShown(error)) {
              toast.error(`Failed to start ${roleLabel} session`, {
                description: errorMessage(error),
              });
            }
            return undefined;
          }
          if (!workflow) {
            return undefined;
          }
          const sessionId = workflow.sessionId;
          if (!sessionId) {
            return undefined;
          }

          applyFreshSessionSelectionQuery(sessionId, params.nextRole, params.nextScenario);
          return sessionId;
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
          reason: "create_session",
        },
        executeStartedSession,
      );
    },
    [
      activeSession,
      activeRepo,
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

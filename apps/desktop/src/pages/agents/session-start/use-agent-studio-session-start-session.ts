import type { AgentRole, AgentScenario } from "@openducktor/core";
import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback } from "react";
import type {
  NewSessionStartDecision,
  NewSessionStartRequest,
  SessionStartRequestReason,
} from "@/features/session-start";
import {
  resolveBuildWorkingDirectoryOverride,
  resolveQaBuilderSessionContext,
} from "@/lib/build-worktree-overrides";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStateContextValue } from "@/types/state-slices";
import {
  applyAgentStudioSelectionQuery,
  buildAgentStudioAsyncActivityContextKey,
  buildCreateSessionStartKey,
  canStartSessionForRole,
  decrementActivityCountRecord,
  incrementActivityCountRecord,
  type QueryUpdate,
} from "../use-agent-studio-session-action-helpers";

type UseAgentStudioSessionStartSessionArgs = {
  activeRepo: string | null;
  taskId: string;
  role: AgentRole;
  scenario: AgentScenario;
  activeSession: AgentSessionState | null;
  sessionsForTask: AgentSessionState[];
  selectedTask: Parameters<typeof canStartSessionForRole>[0];
  agentStudioReady: boolean;
  isActiveTaskHydrated: boolean;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  updateAgentSessionModel: AgentStateContextValue["updateAgentSessionModel"];
  setStartingActivityCountByContext: Dispatch<SetStateAction<Record<string, number>>>;
  startingSessionByTaskRef: MutableRefObject<Map<string, Promise<string | undefined>>>;
  updateQuery: (updates: QueryUpdate) => void;
  resolveRequestedDecision: (
    request: Omit<NewSessionStartRequest, "selectedModel">,
  ) => Promise<NewSessionStartDecision | undefined>;
};

export function useAgentStudioSessionStartSession({
  activeRepo,
  taskId,
  role,
  scenario,
  sessionsForTask,
  selectedTask,
  agentStudioReady,
  isActiveTaskHydrated,
  startAgentSession,
  updateAgentSessionModel,
  setStartingActivityCountByContext,
  startingSessionByTaskRef,
  updateQuery,
  resolveRequestedDecision,
}: UseAgentStudioSessionStartSessionArgs): {
  startSession: (reason: SessionStartRequestReason) => Promise<string | undefined>;
} {
  const startRequestedSession = useCallback(
    async (params: { reason: SessionStartRequestReason }): Promise<string | undefined> => {
      const startContextKey = buildAgentStudioAsyncActivityContextKey({
        activeRepo,
        taskId,
        role,
        sessionId: null,
      });
      setStartingActivityCountByContext((current) =>
        incrementActivityCountRecord(current, startContextKey),
      );
      try {
        const decision = await resolveRequestedDecision({
          taskId,
          role,
          scenario,
          reason: params.reason,
        });
        if (decision == null) {
          return undefined;
        }
        const selectedModel = decision.selectedModel;
        if (decision.reuseSessionId) {
          if (selectedModel) {
            updateAgentSessionModel(decision.reuseSessionId, selectedModel);
          }
          applyAgentStudioSelectionQuery(updateQuery, {
            taskId,
            sessionId: decision.reuseSessionId,
            role,
          });
          return decision.reuseSessionId;
        }

        let workingDirectoryOverride: string | null = null;
        try {
          workingDirectoryOverride = await resolveBuildWorkingDirectoryOverride({
            activeRepo,
            taskId,
            role,
            scenario,
          });
        } catch (error) {
          const description = error instanceof Error ? error.message : "Unknown error";
          throw new Error(
            `Failed to resolve working directory override for ${role} ${scenario} on ${taskId}: ${description}`,
          );
        }
        const builderContext =
          role === "qa"
            ? await resolveQaBuilderSessionContext({
                activeRepo,
                taskId,
                sessions: sessionsForTask,
              })
            : null;
        const sessionId = await startAgentSession({
          taskId,
          role,
          scenario,
          selectedModel,
          sendKickoff: false,
          startMode: decision.startMode,
          ...(decision.reuseSessionId ? { reuseSessionId: decision.reuseSessionId } : {}),
          requireModelReady: true,
          ...(workingDirectoryOverride ? { workingDirectoryOverride } : {}),
          ...(builderContext ? { builderContext } : {}),
        });

        if (selectedModel) {
          updateAgentSessionModel(sessionId, selectedModel);
        }

        applyAgentStudioSelectionQuery(updateQuery, {
          taskId,
          sessionId,
          role,
        });
        return sessionId;
      } finally {
        setStartingActivityCountByContext((current) =>
          decrementActivityCountRecord(current, startContextKey),
        );
      }
    },
    [
      activeRepo,
      resolveRequestedDecision,
      role,
      scenario,
      setStartingActivityCountByContext,
      startAgentSession,
      updateQuery,
      taskId,
      updateAgentSessionModel,
      sessionsForTask,
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

      const startKey = buildCreateSessionStartKey({
        taskId,
        role,
        scenario,
      });
      const inFlightSessionStart = startingSessionByTaskRef.current.get(startKey);
      if (inFlightSessionStart) {
        return inFlightSessionStart;
      }

      const startPromise = startRequestedSession({ reason });

      startingSessionByTaskRef.current.set(startKey, startPromise);
      void startPromise.finally(() => {
        if (startingSessionByTaskRef.current.get(startKey) === startPromise) {
          startingSessionByTaskRef.current.delete(startKey);
        }
      });

      return startPromise;
    },
    [
      agentStudioReady,
      isActiveTaskHydrated,
      role,
      selectedTask,
      scenario,
      startRequestedSession,
      startingSessionByTaskRef,
      taskId,
    ],
  );

  return {
    startSession,
  };
}

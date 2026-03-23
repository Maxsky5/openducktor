import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole, AgentScenario } from "@openducktor/core";
import { assertAgentKickoffScenario } from "@openducktor/core";
import { useQueryClient } from "@tanstack/react-query";
import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback } from "react";
import { toast } from "sonner";
import type { NewSessionStartDecision, NewSessionStartRequest } from "@/features/session-start";
import {
  resolveBuildWorkingDirectoryOverride,
  resolveQaBuilderSessionContext,
} from "@/lib/build-worktree-overrides";
import { errorMessage } from "@/lib/errors";
import { AGENT_ROLE_LABELS } from "@/types";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStateContextValue } from "@/types/state-slices";
import { runOrchestratorSideEffect } from "../../../state/operations/agent-orchestrator/support/async-side-effects";
import { loadEffectivePromptOverrides } from "../../../state/operations/prompt-overrides";
import { kickoffPromptForScenario } from "../agents-page-constants";
import { buildRoleEnabledMapForTask, type SessionCreateOption } from "../agents-page-session-tabs";
import {
  buildAgentStudioAsyncActivityContextKey,
  buildAgentStudioSelectionQueryUpdate,
  buildCreateSessionStartKey,
  buildPreviousSelectionQueryUpdate,
  decrementActivityCountRecord,
  incrementActivityCountRecord,
  type QueryUpdate,
  shouldTriggerContextSwitchIntent,
} from "../use-agent-studio-session-action-helpers";

type UseAgentStudioFreshSessionCreationArgs = {
  activeRepo: string | null;
  taskId: string;
  role: AgentRole;
  activeSession: AgentSessionState | null;
  sessionsForTask?: AgentSessionState[];
  selectedTask: TaskCard | null;
  agentStudioReady: boolean;
  isActiveTaskHydrated: boolean;
  isSessionWorking: boolean;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
  updateAgentSessionModel: AgentStateContextValue["updateAgentSessionModel"];
  updateQuery: (updates: QueryUpdate) => void;
  onContextSwitchIntent?: () => void;
  setStartingActivityCountByContext: Dispatch<SetStateAction<Record<string, number>>>;
  startingSessionByTaskRef: MutableRefObject<Map<string, Promise<string | undefined>>>;
  resolveRequestedDecision: (
    request: Omit<NewSessionStartRequest, "selectedModel">,
  ) => Promise<NewSessionStartDecision | undefined>;
};

export function useAgentStudioFreshSessionCreation({
  activeRepo,
  taskId,
  role,
  activeSession,
  sessionsForTask = [],
  selectedTask,
  agentStudioReady,
  isActiveTaskHydrated,
  isSessionWorking,
  startAgentSession,
  sendAgentMessage,
  updateAgentSessionModel,
  updateQuery,
  onContextSwitchIntent,
  setStartingActivityCountByContext,
  startingSessionByTaskRef,
  resolveRequestedDecision,
}: UseAgentStudioFreshSessionCreationArgs): {
  handleCreateSession: (option: SessionCreateOption) => void;
} {
  const queryClient = useQueryClient();
  const applyFreshSessionDraftQuery = useCallback(
    (nextRole: AgentRole): void => {
      updateQuery(
        buildAgentStudioSelectionQueryUpdate({
          taskId,
          sessionId: undefined,
          role: nextRole,
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
        }),
      );
    },
    [taskId, updateQuery],
  );

  const sendFreshSessionKickoff = useCallback(
    (sessionId: string, nextRole: AgentRole, nextScenario: AgentScenario): void => {
      runOrchestratorSideEffect(
        "agent-studio-send-kickoff-message",
        (async () => {
          const kickoffScenario = assertAgentKickoffScenario(nextScenario);
          const promptOverrides = activeRepo
            ? await loadEffectivePromptOverrides(activeRepo, queryClient)
            : undefined;
          await sendAgentMessage(
            sessionId,
            kickoffPromptForScenario(nextRole, kickoffScenario, taskId, {
              overrides: promptOverrides ?? {},
              task: {
                ...(selectedTask
                  ? {
                      title: selectedTask.title,
                      issueType: selectedTask.issueType,
                      status: selectedTask.status,
                      qaRequired: selectedTask.aiReviewEnabled,
                      description: selectedTask.description,
                    }
                  : {}),
              },
            }),
          );
        })(),
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
    [activeRepo, queryClient, selectedTask, sendAgentMessage, taskId],
  );

  const startFreshSession = useCallback(
    async (params: {
      nextRole: AgentRole;
      nextScenario: AgentScenario;
      selectedModel: AgentModelSelection | null;
      previousSelection: QueryUpdate;
    }): Promise<string | undefined> => {
      try {
        const workingDirectoryOverride = await resolveBuildWorkingDirectoryOverride({
          activeRepo,
          taskId,
          role: params.nextRole,
          scenario: params.nextScenario,
        });
        const builderContext =
          params.nextRole === "qa"
            ? await resolveQaBuilderSessionContext({
                activeRepo,
                taskId,
              })
            : null;
        return await startAgentSession({
          taskId,
          role: params.nextRole,
          scenario: params.nextScenario,
          selectedModel: params.selectedModel,
          sendKickoff: false,
          startMode: "fresh",
          requireModelReady: true,
          ...(workingDirectoryOverride ? { workingDirectoryOverride } : {}),
          ...(builderContext ? { builderContext } : {}),
        });
      } catch (error) {
        updateQuery(params.previousSelection);
        const roleLabel = AGENT_ROLE_LABELS[params.nextRole] ?? params.nextRole.toUpperCase();
        toast.error(`Failed to start ${roleLabel} session`, {
          description: errorMessage(error),
        });
        return undefined;
      }
    },
    [activeRepo, startAgentSession, taskId, updateQuery],
  );

  const runFreshSessionCreation = useCallback(
    async (params: {
      nextRole: AgentRole;
      nextScenario: AgentScenario;
      previousSelection: QueryUpdate;
    }): Promise<string | undefined> => {
      const startContextKey = buildAgentStudioAsyncActivityContextKey({
        activeRepo,
        taskId,
        role: params.nextRole,
        sessionId: null,
      });
      setStartingActivityCountByContext((current) =>
        incrementActivityCountRecord(current, startContextKey),
      );
      try {
        const decision = await resolveRequestedDecision({
          taskId,
          role: params.nextRole,
          scenario: params.nextScenario,
          reason: "create_session",
        });
        if (decision == null) {
          return undefined;
        }
        if (decision.startMode === "reuse" && decision.sourceSessionId) {
          if (decision.selectedModel) {
            updateAgentSessionModel(decision.sourceSessionId, decision.selectedModel);
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
            decision.sourceSessionId,
            params.nextRole,
            params.nextScenario,
          );
          sendFreshSessionKickoff(decision.sourceSessionId, params.nextRole, params.nextScenario);
          return decision.sourceSessionId;
        }
        const selectedModel = decision.selectedModel;

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

        applyFreshSessionDraftQuery(params.nextRole);
        const sessionId = await startFreshSession({
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
        setStartingActivityCountByContext((current) =>
          decrementActivityCountRecord(current, startContextKey),
        );
      }
    },
    [
      activeSession,
      activeRepo,
      applyFreshSessionDraftQuery,
      applyFreshSessionSelectionQuery,
      setStartingActivityCountByContext,
      taskId,
      onContextSwitchIntent,
      resolveRequestedDecision,
      role,
      sendFreshSessionKickoff,
      startFreshSession,
      updateAgentSessionModel,
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
      selectedTask,
      startingSessionByTaskRef,
      taskId,
    ],
  );

  return {
    handleCreateSession,
  };
}

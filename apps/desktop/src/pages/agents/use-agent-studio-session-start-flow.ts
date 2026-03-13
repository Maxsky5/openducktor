import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole, AgentScenario } from "@openducktor/core";
import { assertAgentKickoffScenario } from "@openducktor/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStateContextValue } from "@/types/state-slices";
import { loadEffectivePromptOverrides } from "../../state/operations/prompt-overrides";
import { kickoffPromptForScenario } from "./agents-page-constants";
import type { SessionCreateOption } from "./agents-page-session-tabs";
import { useAgentStudioFreshSessionCreation } from "./use-agent-studio-fresh-session-creation";
import {
  canStartSessionForRole,
  type QueryUpdate,
} from "./use-agent-studio-session-action-helpers";
import { useAgentStudioSessionStartSession } from "./use-agent-studio-session-start-session";
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
  startSession: (reason: SessionStartRequestReason) => Promise<string | undefined>;
  startScenarioKickoff: () => Promise<void>;
  handleCreateSession: (option: SessionCreateOption) => void;
} {
  const [isStarting, setIsStarting] = useState(false);

  const previousRepoForSessionRefs = useRef<string | null>(activeRepo);
  const startingSessionByTaskRef = useRef(new Map<string, Promise<string | undefined>>());

  useEffect(() => {
    if (previousRepoForSessionRefs.current === activeRepo) {
      return;
    }

    previousRepoForSessionRefs.current = activeRepo;
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

  const { startSession } = useAgentStudioSessionStartSession({
    taskId,
    role,
    scenario,
    activeSession,
    sessionsForTask,
    selectedTask,
    agentStudioReady,
    isActiveTaskHydrated,
    startAgentSession,
    updateAgentSessionModel,
    setIsStarting,
    startingSessionByTaskRef,
    updateQuery,
    resolveRequestedSelection,
  });

  const startScenarioKickoff = useCallback(async (): Promise<void> => {
    if (!taskId || !agentStudioReady) {
      return;
    }
    if (!canStartSessionForRole(selectedTask, role)) {
      return;
    }

    const kickoffScenario = assertAgentKickoffScenario(scenario);
    const sessionId = await startSession("scenario_kickoff");
    if (!sessionId) {
      return;
    }

    const promptOverrides = activeRepo ? await loadEffectivePromptOverrides(activeRepo) : undefined;
    await sendAgentMessage(
      sessionId,
      kickoffPromptForScenario(role, kickoffScenario, taskId, {
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
  }, [
    activeRepo,
    agentStudioReady,
    role,
    scenario,
    selectedTask,
    sendAgentMessage,
    startSession,
    taskId,
  ]);

  const { handleCreateSession } = useAgentStudioFreshSessionCreation({
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
    ...(onContextSwitchIntent ? { onContextSwitchIntent } : {}),
    setIsStarting,
    startingSessionByTaskRef,
    resolveRequestedSelection,
  });

  return {
    isStarting,
    startSession,
    startScenarioKickoff,
    handleCreateSession,
  };
}

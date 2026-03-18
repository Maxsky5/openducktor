import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole, AgentScenario } from "@openducktor/core";
import { assertAgentKickoffScenario } from "@openducktor/core";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { HumanReviewFeedbackModalModel } from "@/features/human-review-feedback/human-review-feedback-types";
import type {
  NewSessionStartRequest,
  RequestNewSessionStart,
  SessionStartRequestReason,
} from "@/features/session-start";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStateContextValue } from "@/types/state-slices";
import { loadEffectivePromptOverrides } from "../../../state/operations/shared/prompt-overrides";
import { kickoffPromptForScenario } from "../agents-page-constants";
import type { SessionCreateOption } from "../agents-page-session-tabs";
import { useAgentStudioHumanReviewFeedbackFlow } from "../use-agent-studio-human-review-feedback-flow";
import {
  buildAgentStudioAsyncActivityContextKey,
  canStartSessionForRole,
  type QueryUpdate,
} from "../use-agent-studio-session-action-helpers";
import { useAgentStudioFreshSessionCreation } from "./use-agent-studio-fresh-session-creation";
import { useAgentStudioSessionStartSession } from "./use-agent-studio-session-start-session";

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
  loadAgentSessions: AgentStateContextValue["loadAgentSessions"];
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
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
  loadAgentSessions,
  humanRequestChangesTask,
  updateQuery,
  onContextSwitchIntent,
  requestNewSessionStart,
}: UseAgentStudioSessionStartFlowArgs): {
  isStarting: boolean;
  humanReviewFeedbackModal: HumanReviewFeedbackModalModel | null;
  startSession: (reason: SessionStartRequestReason) => Promise<string | undefined>;
  startScenarioKickoff: () => Promise<void>;
  handleCreateSession: (option: SessionCreateOption) => void;
} {
  const queryClient = useQueryClient();
  const [startingActivityCountByContext, setStartingActivityCountByContext] = useState<
    Record<string, number>
  >({});
  const isStarting =
    (startingActivityCountByContext[
      buildAgentStudioAsyncActivityContextKey({
        activeRepo,
        taskId,
        role,
        sessionId: activeSession?.sessionId ?? null,
      })
    ] ?? 0) > 0;

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
    activeRepo,
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
    setStartingActivityCountByContext,
    startingSessionByTaskRef,
    updateQuery,
    resolveRequestedSelection,
  });

  const { humanReviewFeedbackModal, shouldInterceptCreateSession, openHumanReviewFeedback } =
    useAgentStudioHumanReviewFeedbackFlow({
      activeRepo,
      taskId,
      role,
      activeSession,
      sessionsForTask,
      selectedTask,
      startAgentSession,
      sendAgentMessage,
      updateAgentSessionModel,
      loadAgentSessions,
      humanRequestChangesTask,
      updateQuery,
      ...(onContextSwitchIntent ? { onContextSwitchIntent } : {}),
      resolveRequestedSelection,
    });

  const startScenarioKickoff = useCallback(async (): Promise<void> => {
    if (!taskId || !agentStudioReady) {
      return;
    }
    if (!canStartSessionForRole(selectedTask, role)) {
      return;
    }
    if (role === "build" && scenario === "build_after_human_request_changes") {
      openHumanReviewFeedback();
      return;
    }

    const kickoffScenario = assertAgentKickoffScenario(scenario);
    const sessionId = await startSession("scenario_kickoff");
    if (!sessionId) {
      return;
    }

    const promptOverrides = activeRepo
      ? await loadEffectivePromptOverrides(activeRepo, queryClient)
      : undefined;
    try {
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
    } catch (error) {
      toast.error("Session started, but the kickoff prompt failed to send.", {
        description: errorMessage(error),
      });
    }
  }, [
    activeRepo,
    agentStudioReady,
    queryClient,
    role,
    scenario,
    selectedTask,
    sendAgentMessage,
    openHumanReviewFeedback,
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
    setStartingActivityCountByContext,
    startingSessionByTaskRef,
    resolveRequestedSelection,
  });

  const handleCreateSessionWithHumanFeedback = useCallback(
    (option: SessionCreateOption): void => {
      if (shouldInterceptCreateSession(option)) {
        openHumanReviewFeedback();
        return;
      }
      handleCreateSession(option);
    },
    [handleCreateSession, openHumanReviewFeedback, shouldInterceptCreateSession],
  );

  return {
    isStarting,
    humanReviewFeedbackModal,
    startSession,
    startScenarioKickoff,
    handleCreateSession: handleCreateSessionWithHumanFeedback,
  };
}

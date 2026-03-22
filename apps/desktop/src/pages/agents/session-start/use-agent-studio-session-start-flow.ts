import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole, AgentScenario } from "@openducktor/core";
import { assertAgentKickoffScenario, getAgentScenarioDefinition } from "@openducktor/core";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { HumanReviewFeedbackModalModel } from "@/features/human-review-feedback/human-review-feedback-types";
import type {
  NewSessionStartDecision,
  NewSessionStartRequest,
  RequestNewSessionStart,
  SessionStartRequestReason,
} from "@/features/session-start";
import { buildReusableSessionOptions, resolveScenarioStartMode } from "@/features/session-start";
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
  bootstrapTaskSessions: AgentStateContextValue["bootstrapTaskSessions"];
  hydrateRequestedTaskSessionHistory: AgentStateContextValue["hydrateRequestedTaskSessionHistory"];
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
  bootstrapTaskSessions,
  hydrateRequestedTaskSessionHistory,
  loadAgentSessions: _loadAgentSessions,
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

  const resolveRequestedDecision = useCallback(
    async (
      request: Omit<NewSessionStartRequest, "selectedModel">,
    ): Promise<NewSessionStartDecision | undefined> => {
      const requestedSelection =
        request.role === role && request.taskId === taskId
          ? (selectionForNewSession ?? null)
          : null;
      const reusableSessionOptions =
        request.reusableSessionOptions ??
        (getAgentScenarioDefinition(request.scenario).allowedStartModes.includes("reuse")
          ? buildReusableSessionOptions({
              sessions: sessionsForTask.filter((session) => session.taskId === request.taskId),
              role: request.role,
            })
          : []);
      const initialReusableSessionId =
        request.initialReusableSessionId ??
        (activeSession &&
        activeSession.taskId === request.taskId &&
        activeSession.role === request.role &&
        reusableSessionOptions.some((option) => option.value === activeSession.sessionId)
          ? activeSession.sessionId
          : (reusableSessionOptions[0]?.value ?? null));

      if (!requestNewSessionStart) {
        const startMode = resolveScenarioStartMode({
          scenario: request.scenario,
          reusableSessionOptions,
        });
        return {
          selectedModel: requestedSelection,
          startMode,
          reuseSessionId: startMode === "reuse" ? initialReusableSessionId : null,
        };
      }

      const decision = await requestNewSessionStart({
        ...request,
        selectedModel: requestedSelection,
        ...(reusableSessionOptions.length > 0 ? { reusableSessionOptions } : {}),
        ...(initialReusableSessionId ? { initialReusableSessionId } : {}),
      });
      if (!decision) {
        return undefined;
      }
      return decision;
    },
    [activeSession, requestNewSessionStart, role, selectionForNewSession, sessionsForTask, taskId],
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
    resolveRequestedDecision,
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
      bootstrapTaskSessions,
      hydrateRequestedTaskSessionHistory,
      humanRequestChangesTask,
      updateQuery,
      ...(onContextSwitchIntent ? { onContextSwitchIntent } : {}),
      resolveRequestedDecision,
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
    sessionsForTask,
    selectedTask,
    agentStudioReady,
    isActiveTaskHydrated,
    isSessionWorking,
    startAgentSession,
    sendAgentMessage,
    updateAgentSessionModel,
    updateQuery,
    ...(onContextSwitchIntent ? { onContextSwitchIntent } : {}),
    setStartingActivityCountByContext,
    startingSessionByTaskRef,
    resolveRequestedDecision,
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

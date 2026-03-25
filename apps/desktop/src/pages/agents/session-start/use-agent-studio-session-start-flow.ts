import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole, AgentScenario } from "@openducktor/core";
import { getAgentScenarioDefinition } from "@openducktor/core";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { SessionStartModalModel } from "@/components/features/agents";
import type { HumanReviewFeedbackModalModel } from "@/features/human-review-feedback/human-review-feedback-types";
import type {
  NewSessionStartDecision,
  NewSessionStartRequest,
  SessionStartRequestReason,
} from "@/features/session-start";
import {
  buildReusableSessionOptions,
  startSessionWorkflow,
  type SessionStartPostAction,
  toSessionStartPostAction,
  useSessionStartModalRunner,
} from "@/features/session-start";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStateContextValue, RepoSettingsInput } from "@/types/state-slices";
import type { SessionCreateOption } from "../agents-page-session-tabs";
import { useAgentStudioFreshSessionCreation } from "../use-agent-studio-fresh-session-creation";
import { useAgentStudioHumanReviewFeedbackFlow } from "../use-agent-studio-human-review-feedback-flow";
import {
  applyAgentStudioSelectionQuery,
  buildAgentStudioAsyncActivityContextKey,
  canStartSessionForRole,
  type QueryUpdate,
} from "../use-agent-studio-session-action-helpers";
import { useAgentStudioSessionStartSession } from "./use-agent-studio-session-start-session";

type ResolvedSessionStartDecision = Exclude<NewSessionStartDecision, null>;

type SessionStartRequestInput = Omit<NewSessionStartRequest, "selectedModel"> & {
  initialStartMode?: "fresh" | "reuse" | "fork";
};

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
  repoSettings: RepoSettingsInput | null;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
  bootstrapTaskSessions: AgentStateContextValue["bootstrapTaskSessions"];
  hydrateRequestedTaskSessionHistory: AgentStateContextValue["hydrateRequestedTaskSessionHistory"];
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
  updateQuery: (updates: QueryUpdate) => void;
  onContextSwitchIntent?: () => void;
};

type AgentStudioSessionStartRequest = Omit<NewSessionStartRequest, "selectedModel"> & {
  initialStartMode?: "fresh" | "reuse" | "fork";
  postStartAction: SessionStartPostAction;
  message?: string;
  beforeStartAction?: {
    action: "human_request_changes";
    note: string;
  };
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
  repoSettings,
  startAgentSession,
  sendAgentMessage,
  bootstrapTaskSessions,
  hydrateRequestedTaskSessionHistory,
  humanRequestChangesTask,
  updateQuery,
  onContextSwitchIntent,
}: UseAgentStudioSessionStartFlowArgs): {
  isStarting: boolean;
  sessionStartModal: SessionStartModalModel | null;
  humanReviewFeedbackModal: HumanReviewFeedbackModalModel | null;
  startSessionRequest: (
    request: AgentStudioSessionStartRequest,
  ) => Promise<string | undefined>;
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
  const {
    sessionStartModal,
    runSessionStartRequest: runInternalSessionStartRequest,
  } = useSessionStartModalRunner({
    activeRepo,
    repoSettings,
  });

  useEffect(() => {
    if (previousRepoForSessionRefs.current === activeRepo) {
      return;
    }

    previousRepoForSessionRefs.current = activeRepo;
    startingSessionByTaskRef.current.clear();
  }, [activeRepo]);

  const executeRequestedSessionStart = useCallback(
    async <T,>(
      request: SessionStartRequestInput,
      executeWithDecision: (decision: ResolvedSessionStartDecision) => Promise<T | undefined>,
    ): Promise<T | undefined> => {
      const requestedSelection =
        request.role === role && request.taskId === taskId
          ? (selectionForNewSession ?? null)
          : null;
      const existingSessionOptions =
        request.existingSessionOptions ??
        (getAgentScenarioDefinition(request.scenario).allowedStartModes.some(
          (mode) => mode === "reuse" || mode === "fork",
        )
          ? buildReusableSessionOptions({
              sessions: sessionsForTask.filter((session) => session.taskId === request.taskId),
              role: request.role,
            })
          : []);
      const initialSourceSessionId =
        request.initialSourceSessionId ??
        (activeSession &&
        activeSession.taskId === request.taskId &&
        activeSession.role === request.role &&
        existingSessionOptions.some((option) => option.value === activeSession.sessionId)
          ? activeSession.sessionId
          : (existingSessionOptions[0]?.value ?? null));

      return runInternalSessionStartRequest(
        {
          source: "agent_studio",
          taskId: request.taskId,
          role: request.role,
          scenario: request.scenario,
          selectedModel: requestedSelection,
          ...(request.initialStartMode ? { initialStartMode: request.initialStartMode } : {}),
          ...(existingSessionOptions.length > 0 ? { existingSessionOptions } : {}),
          ...(initialSourceSessionId ? { initialSourceSessionId } : {}),
          postStartAction: toSessionStartPostAction(request.reason),
        },
        async ({ decision }) => executeWithDecision(decision),
      );
    },
    [
      activeSession,
      role,
      runInternalSessionStartRequest,
      selectionForNewSession,
      sessionsForTask,
      taskId,
    ],
  );

  const { startSession, runSessionStart } = useAgentStudioSessionStartSession({
    activeRepo,
    taskId,
    role,
    scenario,
    activeSession,
    selectedTask,
    agentStudioReady,
    isActiveTaskHydrated,
    startAgentSession,
    sendAgentMessage,
    setStartingActivityCountByContext,
    startingSessionByTaskRef,
    updateQuery,
    onPostStartActionError: (action, error) => {
      const message =
        action === "kickoff"
          ? "Session started, but the kickoff prompt failed to send."
          : "Session started, but feedback message failed.";
      toast.error(message, {
        description: error.message,
      });
    },
    executeRequestedSessionStart,
  });

  const startSessionRequest = useCallback(
    async (request: AgentStudioSessionStartRequest): Promise<string | undefined> => {
      return executeRequestedSessionStart(request, async (decision) => {
        const workflow = await startSessionWorkflow({
          activeRepo,
          queryClient,
          intent: {
            taskId: request.taskId,
            role: request.role,
            scenario: request.scenario,
            startMode: decision.startMode,
            postStartAction: request.postStartAction,
            ...(request.message ? { message: request.message } : {}),
            ...(request.beforeStartAction ? { beforeStartAction: request.beforeStartAction } : {}),
            ...(decision.startMode === "reuse" || decision.startMode === "fork"
              ? { sourceSessionId: decision.sourceSessionId }
              : {}),
          },
          selection: decision.startMode === "reuse" ? null : decision.selectedModel,
          task: request.taskId === taskId ? selectedTask : null,
          startAgentSession,
          sendAgentMessage,
          postStartExecution: request.postStartAction === "none" ? "await" : "detached",
          onDetachedPostStartError:
            request.postStartAction === "none"
              ? undefined
              : (error) => {
                  const message =
                    request.postStartAction === "kickoff"
                      ? "Session started, but the kickoff prompt failed to send."
                      : "Session started, but feedback message failed.";
                  toast.error(message, {
                    description: error.message,
                  });
                },
        });

        applyAgentStudioSelectionQuery(updateQuery, {
          taskId: request.taskId,
          sessionId: workflow.sessionId,
          role: request.role,
        });
        return workflow.sessionId;
      });
    },
    [
      activeRepo,
      executeRequestedSessionStart,
      queryClient,
      selectedTask,
      sendAgentMessage,
      startAgentSession,
      taskId,
      updateQuery,
    ],
  );

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
      bootstrapTaskSessions,
      hydrateRequestedTaskSessionHistory,
      humanRequestChangesTask,
      updateQuery,
      ...(onContextSwitchIntent ? { onContextSwitchIntent } : {}),
      executeRequestedSessionStart,
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

    const workflow = await runSessionStart({
      reason: "scenario_kickoff",
      postStartAction: "kickoff",
    });
    if (!workflow) {
      return;
    }

  }, [
    agentStudioReady,
    role,
    scenario,
    openHumanReviewFeedback,
    runSessionStart,
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
    updateQuery,
    ...(onContextSwitchIntent ? { onContextSwitchIntent } : {}),
    setStartingActivityCountByContext,
    startingSessionByTaskRef,
    executeRequestedSessionStart,
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
    sessionStartModal,
    humanReviewFeedbackModal,
    startSessionRequest,
    startSession,
    startScenarioKickoff,
    handleCreateSession: handleCreateSessionWithHumanFeedback,
  };
}

import type { GitBranch, GitTargetBranch, TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import { useCallback, useRef } from "react";
import { toast } from "sonner";
import type { SessionStartModalModel } from "@/components/features/agents";
import type { HumanReviewFeedbackModalModel } from "@/features/human-review-feedback/human-review-feedback-types";
import type {
  ResolvedSessionStartDecision,
  RunSessionStartWorkflow,
  SessionLaunchActionId,
  SessionStartFlowRequest,
  SessionStartGate,
  SessionStartLaunchRequest,
  SessionStartPostAction,
  SessionStartWorkflowResult,
} from "@/features/session-start";
import {
  buildSessionStartModalRequest,
  createSessionStartGate,
  sessionStartPostActionErrorTitle,
  useSessionStartModalRunner,
} from "@/features/session-start";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { isWorkflowAgentSession } from "@/state/operations/agent-orchestrator/support/workflow-session";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { RepoSettingsInput } from "@/types/state-slices";
import type { AgentStudioQuickActionOption } from "../agent-studio-quick-actions";
import type { SessionCreateOption } from "../agents-page-session-tabs";
import {
  buildAgentStudioSelectionQueryUpdate,
  type AgentStudioQueryUpdate as QueryUpdate,
} from "../query-sync/agent-studio-navigation";
import {
  buildAgentStudioSessionActivityKey,
  useAgentStudioAsyncActivityTracker,
} from "../use-agent-studio-async-activity";
import { useAgentStudioHumanReviewFeedbackFlow } from "../use-agent-studio-human-review-feedback-flow";

type CanStartRole = (role: AgentRole) => boolean;

type UseAgentStudioSessionStartFlowArgs = {
  branches?: GitBranch[];
  taskId: string;
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
  selectedSessionIdentity: AgentSessionIdentity | null;
  loadedSession: AgentSessionState | null;
  sessionsForTask: AgentSessionSummary[];
  selectedTask: TaskCard | null;
  canStartRole: CanStartRole;
  isSessionWorking: boolean;
  selectionForNewSession: AgentModelSelection | null;
  repoSettings: RepoSettingsInput | null;
  workspaceId: string | null;
  workspaceRepoPath: string | null;
  runSessionStartWorkflow: RunSessionStartWorkflow;
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
  setTaskTargetBranch?: (taskId: string, targetBranch: GitTargetBranch) => Promise<void>;
  scheduleQueryUpdate: (updates: QueryUpdate) => void;
};

type AgentStudioSessionStartRequest = SessionStartLaunchRequest;
type AgentStudioSessionStartGateResult = SessionStartWorkflowResult | undefined;

const buildSessionStartKey = (params: {
  taskId: string;
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
  holdForPostStartMessage?: boolean;
}): string => {
  const messagePolicy = params.holdForPostStartMessage
    ? "post-start-message"
    : "no-post-start-message";
  return `${params.taskId}:${params.role}:${params.launchActionId}:${messagePolicy}`;
};

const showPostStartActionError = (action: SessionStartPostAction, error: Error): void => {
  toast.error(sessionStartPostActionErrorTitle(action), {
    description: error.message,
  });
};

export function useAgentStudioSessionStartFlow({
  branches = [],
  taskId,
  role,
  launchActionId,
  selectedSessionIdentity,
  loadedSession,
  sessionsForTask,
  selectedTask,
  canStartRole,
  isSessionWorking,
  selectionForNewSession,
  repoSettings,
  workspaceId,
  workspaceRepoPath,
  runSessionStartWorkflow,
  humanRequestChangesTask,
  setTaskTargetBranch,
  scheduleQueryUpdate,
}: UseAgentStudioSessionStartFlowArgs): {
  isStarting: boolean;
  sessionStartModal: SessionStartModalModel | null;
  humanReviewFeedbackModal: HumanReviewFeedbackModalModel | null;
  startSessionRequest: (
    request: AgentStudioSessionStartRequest,
  ) => Promise<SessionStartWorkflowResult | undefined>;
  startSession: (options?: {
    holdForPostStartMessage?: boolean;
  }) => Promise<SessionStartWorkflowResult | undefined>;
  startLaunchKickoff: () => Promise<void>;
  handleCreateSession: (option: SessionCreateOption) => void;
  handleQuickAction: (option: AgentStudioQuickActionOption) => void;
} {
  const sessionStartGateScopeRef = useRef(workspaceId);
  const sessionStartGateRef = useRef<SessionStartGate<AgentStudioSessionStartGateResult> | null>(
    null,
  );
  if (sessionStartGateRef.current === null) {
    sessionStartGateRef.current = createSessionStartGate<AgentStudioSessionStartGateResult>();
  }
  const sessionStartGate = sessionStartGateRef.current;
  if (sessionStartGateScopeRef.current !== workspaceId) {
    sessionStartGateScopeRef.current = workspaceId;
    sessionStartGate.clear();
  }

  const { begin: beginStartingActivity, isActive: isStartingActivityActive } =
    useAgentStudioAsyncActivityTracker();
  const isStarting = isStartingActivityActive(
    buildAgentStudioSessionActivityKey({
      workspaceId,
      taskId,
      role,
      session: null,
    }),
  );

  const { sessionStartModal, runSessionStartRequest: runInternalSessionStartRequest } =
    useSessionStartModalRunner({
      branches,
      repoSettings,
      workspaceRepoPath,
    });

  const executeRequestedSessionStart = useCallback(
    async <T>(
      request: SessionStartFlowRequest,
      executeWithDecision: (decision: ResolvedSessionStartDecision) => Promise<T | undefined>,
    ): Promise<T | undefined> => {
      return runInternalSessionStartRequest(
        buildSessionStartModalRequest({
          source: "agent_studio",
          request,
          requestedRuntimeKind:
            request.taskId === taskId
              ? (selectionForNewSession?.runtimeKind ??
                selectedSessionIdentity?.runtimeKind ??
                null)
              : null,
          selectedModel: request.taskId === taskId ? (selectionForNewSession ?? null) : null,
          taskSessions: sessionsForTask,
          preferredSourceSession: isWorkflowAgentSession(loadedSession) ? loadedSession : null,
          selectedTask: request.taskId === taskId ? selectedTask : null,
        }),
        async ({ decision }) => executeWithDecision(decision),
      );
    },
    [
      loadedSession,
      runInternalSessionStartRequest,
      selectionForNewSession,
      selectedSessionIdentity?.runtimeKind,
      selectedTask,
      sessionsForTask,
      taskId,
    ],
  );

  const runSessionStartRequest = useCallback(
    async (request: SessionStartFlowRequest): Promise<SessionStartWorkflowResult | undefined> => {
      const executeWithDecision = async (
        decision: ResolvedSessionStartDecision,
      ): Promise<SessionStartWorkflowResult | undefined> => {
        const execute = async (): Promise<SessionStartWorkflowResult> => {
          const workflow = await runSessionStartWorkflow({
            request,
            decision,
            task: request.taskId === taskId ? selectedTask : null,
            ...(setTaskTargetBranch ? { persistTaskTargetBranch: setTaskTargetBranch } : {}),
            humanRequestChangesTask,
          });
          if (workflow.postStartActionError) {
            showPostStartActionError(request.postStartAction, workflow.postStartActionError);
          }

          scheduleQueryUpdate(
            buildAgentStudioSelectionQueryUpdate({
              taskId: request.taskId,
              sessionExternalId: workflow.externalSessionId,
              role: request.role,
            }),
          );
          return workflow;
        };

        const activity = beginStartingActivity(
          buildAgentStudioSessionActivityKey({
            workspaceId,
            taskId: request.taskId,
            role: request.role,
            session: null,
          }),
        );
        try {
          return await execute();
        } finally {
          activity.finish();
        }
      };

      return executeRequestedSessionStart(request, executeWithDecision);
    },
    [
      beginStartingActivity,
      executeRequestedSessionStart,
      humanRequestChangesTask,
      runSessionStartWorkflow,
      selectedTask,
      setTaskTargetBranch,
      scheduleQueryUpdate,
      taskId,
      workspaceId,
    ],
  );

  const runGatedSessionStartRequest = useCallback(
    (request: AgentStudioSessionStartRequest): Promise<SessionStartWorkflowResult | undefined> => {
      const startKey = buildSessionStartKey({
        taskId: request.taskId,
        role: request.role,
        launchActionId: request.launchActionId,
        ...(request.holdForPostStartMessage ? { holdForPostStartMessage: true } : {}),
      });
      return sessionStartGate.run(startKey, () => runSessionStartRequest(request));
    },
    [runSessionStartRequest, sessionStartGate],
  );

  const runSessionStart = useCallback(
    async (params: {
      postStartAction: SessionStartPostAction;
      holdForPostStartMessage?: boolean;
    }): Promise<SessionStartWorkflowResult | undefined> => {
      if (!canStartRole(role)) {
        return undefined;
      }

      return runGatedSessionStartRequest({
        taskId,
        role,
        launchActionId,
        postStartAction: params.postStartAction,
        ...(params.holdForPostStartMessage ? { holdForPostStartMessage: true } : {}),
        initialTargetBranch: selectedTask?.targetBranch ?? null,
        initialTargetBranchError: selectedTask?.targetBranchError ?? null,
      });
    },
    [
      canStartRole,
      launchActionId,
      role,
      runGatedSessionStartRequest,
      selectedTask?.targetBranch,
      selectedTask?.targetBranchError,
      taskId,
    ],
  );

  const startSession = useCallback(
    async (options?: {
      holdForPostStartMessage?: boolean;
    }): Promise<SessionStartWorkflowResult | undefined> => {
      return runSessionStart({
        postStartAction: "none",
        ...(options?.holdForPostStartMessage ? { holdForPostStartMessage: true } : {}),
      });
    },
    [runSessionStart],
  );

  const startSessionRequest = useCallback(
    async (
      request: AgentStudioSessionStartRequest,
    ): Promise<SessionStartWorkflowResult | undefined> => {
      return runSessionStartRequest(request);
    },
    [runSessionStartRequest],
  );

  const { humanReviewFeedbackModal, shouldInterceptCreateSession, openHumanReviewFeedback } =
    useAgentStudioHumanReviewFeedbackFlow({
      taskId,
      sessionsForTask,
      selectedTask,
      startSessionRequest,
    });

  const startLaunchKickoff = useCallback(async (): Promise<void> => {
    if (!canStartRole(role)) {
      return;
    }
    if (role === "build" && launchActionId === "build_after_human_request_changes") {
      openHumanReviewFeedback();
      return;
    }

    const workflow = await runSessionStart({
      postStartAction: "kickoff",
    });
    if (!workflow) {
      return;
    }
  }, [canStartRole, openHumanReviewFeedback, launchActionId, role, runSessionStart]);

  const handleCreateSession = useCallback(
    (option: SessionCreateOption): void => {
      const { role: nextRole, launchActionId: nextLaunchActionId } = option;
      if (selectedSessionIdentity && isSessionWorking) {
        return;
      }

      if (!canStartRole(nextRole)) {
        return;
      }

      void runGatedSessionStartRequest({
        taskId,
        role: nextRole,
        launchActionId: nextLaunchActionId,
        postStartAction: "kickoff",
      });
    },
    [canStartRole, isSessionWorking, runGatedSessionStartRequest, selectedSessionIdentity, taskId],
  );

  const handleCreateSessionWithHumanFeedback = useCallback(
    (option: SessionCreateOption): void => {
      if (shouldInterceptCreateSession(option)) {
        if (!canStartRole(option.role)) {
          return;
        }
        openHumanReviewFeedback();
        return;
      }
      handleCreateSession(option);
    },
    [canStartRole, handleCreateSession, openHumanReviewFeedback, shouldInterceptCreateSession],
  );

  const handleQuickAction = useCallback(
    (option: AgentStudioQuickActionOption): void => {
      if (option.disabled) {
        return;
      }
      if (isSessionWorking) {
        return;
      }
      if (!canStartRole(option.role)) {
        return;
      }
      if (option.requiresHumanFeedback) {
        openHumanReviewFeedback();
        return;
      }

      void runGatedSessionStartRequest({
        taskId,
        role: option.role,
        launchActionId: option.launchActionId,
        postStartAction: option.postStartAction,
        ...(option.initialStartMode ? { initialStartMode: option.initialStartMode } : {}),
        ...(option.existingSessionOptions
          ? { existingSessionOptions: option.existingSessionOptions }
          : {}),
        ...(option.initialSourceSession !== undefined
          ? { initialSourceSession: option.initialSourceSession }
          : {}),
      });
    },
    [canStartRole, isSessionWorking, openHumanReviewFeedback, runGatedSessionStartRequest, taskId],
  );

  return {
    isStarting,
    sessionStartModal,
    humanReviewFeedbackModal,
    startSessionRequest,
    startSession,
    startLaunchKickoff,
    handleCreateSession: handleCreateSessionWithHumanFeedback,
    handleQuickAction,
  };
}

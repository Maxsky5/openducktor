import { getSessionLaunchAction, type BuiltinTaskCard as TaskCard } from "@openducktor/workflows";
import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import { agentSessionIdentityKey, toAgentSessionIdentity } from "../../lib/agent-session-identity";
import type { AgentSessionSummary } from "../agent-sessions-store";
import type { AgentSessionIdentity } from "../../types/agent-orchestrator";
import type { SessionStartModalSource } from "./session-start-modal-types";
import { buildReusableSessionOptions } from "./session-start-reuse-options";
import type { ResolvedSessionStartDecision, SessionStartFlowRequest } from "./session-start-types";
export type { ResolvedSessionStartDecision, SessionStartFlowRequest } from "./session-start-types";
import {
  hostLaunchNoticeId,
  type SendAgentMessage,
  type SessionStartWorkflowResult,
  startSessionWorkflow,
  type WorkflowLaunchClient,
} from "./session-start-workflow";
import type { SessionStartModalOpenRequest } from "./use-session-start-modal-coordinator";

export type SessionStartLaunchRequest = SessionStartFlowRequest;

type SessionStartContextSession = {
  externalSessionId: string;
  runtimeKind: AgentSessionSummary["runtimeKind"];
  workingDirectory: string;
  taskId: string;
  role: AgentSessionSummary["role"];
};

type BuildSessionStartModalRequestArgs = {
  source: SessionStartModalSource;
  resolveKickoffPrompt?: SessionStartModalOpenRequest["resolveKickoffPrompt"];
  request: SessionStartFlowRequest;
  requestedRuntimeKind?: RuntimeKind | null;
  selectedModel: AgentModelSelection | null;
  taskSessions: AgentSessionSummary[];
  preferredSourceSession?: SessionStartContextSession | null | undefined;
  selectedTask?: Pick<TaskCard, "targetBranch" | "targetBranchError"> | null;
};

export type RunSessionStartWorkflowInput = {
  startupAttemptId?: string;
  request: SessionStartFlowRequest;
  decision: ResolvedSessionStartDecision;
  isCurrent?: () => boolean;
  task: TaskCard | null;
};

export type RunSessionStartWorkflow = (
  input: RunSessionStartWorkflowInput,
) => Promise<SessionStartWorkflowResult>;

export type SessionStartNotificationInput = {
  launchAttemptId: string;
  workspaceId: string | null;
  taskId: string;
  taskTitle?: string;
  role: SessionStartFlowRequest["role"];
  session?: AgentSessionIdentity;
  errorAttentionId?: string;
  inAppFeedbackHandled?: boolean;
};

export type SessionStartNotificationPublisher = {
  publishSessionStarted(
    input: SessionStartNotificationInput & { session: AgentSessionIdentity },
  ): void;
  publishSessionError(
    input: SessionStartNotificationInput,
    localErrorMessage?: string,
  ): Promise<boolean>;
  /** Another view shows this host session error, so its notification skips the in-app toast. */
  markInAppFeedbackHandled(errorId: string): void;
  reportFailure(cause: unknown, input: SessionStartNotificationInput): void;
};

export class SessionStartWorkflowError extends Error {
  constructor(
    readonly originalCause: Error,
    readonly feedbackHandled: boolean,
  ) {
    super(originalCause.message);
    this.name = "SessionStartWorkflowError";
  }
}

export const isSessionStartFailureFeedbackHandled = (cause: unknown): boolean =>
  cause instanceof SessionStartWorkflowError && cause.feedbackHandled;

/** Publishes a start error once while the startup trace owns in-app feedback. */
const publishSessionStartError = async (
  notifications: SessionStartNotificationPublisher | undefined,
  input: SessionStartNotificationInput,
  error: Error,
  reportFailure: (cause: unknown) => void,
): Promise<void> => {
  const noticeId = hostLaunchNoticeId(error);
  if (noticeId !== undefined) {
    try {
      notifications?.markInAppFeedbackHandled(noticeId);
    } catch (cause) {
      reportFailure(cause);
    }
    return;
  }
  try {
    await notifications?.publishSessionError(input, error.message);
  } catch (cause) {
    reportFailure(cause);
  }
};

type CreateSessionStartWorkflowRunnerArgs = {
  workspaceId: string | null;
  repoPath: string | null;
  client: WorkflowLaunchClient;
  sendAgentMessage: SendAgentMessage;
  notifications?: SessionStartNotificationPublisher | undefined;
  launchAttemptId: string;
};

export const createSessionStartWorkflowRunner = ({
  workspaceId,
  repoPath,
  client,
  sendAgentMessage,
  notifications,
  launchAttemptId,
}: CreateSessionStartWorkflowRunnerArgs): RunSessionStartWorkflow => {
  return async (input) => {
    const notificationInput: SessionStartNotificationInput = {
      launchAttemptId,
      workspaceId,
      taskId: input.request.taskId,
      role: input.request.role,
      inAppFeedbackHandled: true,
    };
    if (input.task?.title) notificationInput.taskTitle = input.task.title;
    const reportNotificationFailure = (cause: unknown): void => {
      try {
        notifications?.reportFailure(cause, notificationInput);
      } catch {
        console.error("Session start notification failure reporting failed.", {
          launchAttemptId,
          taskId: input.request.taskId,
          workspaceId,
        });
      }
    };
    const publishFailure = (error: Error, notification: SessionStartNotificationInput) =>
      publishSessionStartError(notifications, notification, error, reportNotificationFailure);
    let result: SessionStartWorkflowResult;
    try {
      if (input.isCurrent && !input.isCurrent())
        throw new Error("The session start context changed. Start again in the current workspace.");
      if (!workspaceId || !repoPath)
        throw new Error("Session start requires an explicit workspace and repository.");
      result = await startSessionWorkflow({
        request: input.request,
        decision: input.decision,
        workspaceId,
        repoPath,
        client,
        sendAgentMessage,
      });
    } catch (cause) {
      const startError = cause instanceof Error ? cause : new Error(String(cause));
      await publishFailure(startError, notificationInput);
      throw new SessionStartWorkflowError(startError, true);
    }

    const { postStartActionError } = result;
    const session = toAgentSessionIdentity(result);
    const notificationWithSession = { ...notificationInput, session };
    if (postStartActionError) {
      await publishFailure(postStartActionError, notificationWithSession);
      return {
        ...result,
        postStartActionError: new SessionStartWorkflowError(postStartActionError, true),
      };
    }
    try {
      if (input.decision.startMode === "fresh" || input.decision.startMode === "fork") {
        notifications?.publishSessionStarted(notificationWithSession);
      }
    } catch (cause) {
      reportNotificationFailure(cause);
    }
    return result;
  };
};

export const buildSessionStartModalRequest = ({
  source,
  resolveKickoffPrompt,
  request,
  requestedRuntimeKind,
  selectedModel,
  taskSessions,
  preferredSourceSession,
  selectedTask,
}: BuildSessionStartModalRequestArgs): SessionStartModalOpenRequest => {
  const existingSessionOptions = resolveExistingSessionOptions(request, taskSessions);
  const initialSourceSession = resolveInitialSourceSession({
    request,
    existingSessionOptions,
    preferredSourceSession,
  });
  const initialTargetBranch = request.initialTargetBranch ?? selectedTask?.targetBranch ?? null;
  const initialTargetBranchError =
    request.initialTargetBranchError ?? selectedTask?.targetBranchError ?? null;
  const modalRequest: SessionStartModalOpenRequest = {
    source,
    taskId: request.taskId,
    role: request.role,
    launchActionId: request.launchActionId,
    postStartAction: request.postStartAction,
    selectedModel,
    initialTargetBranch,
  };

  if (resolveKickoffPrompt) modalRequest.resolveKickoffPrompt = resolveKickoffPrompt;

  if (requestedRuntimeKind) {
    modalRequest.requestedRuntimeKind = requestedRuntimeKind;
  }

  if (initialTargetBranchError) {
    modalRequest.initialTargetBranchError = initialTargetBranchError;
  }

  if (request.targetWorkingDirectory !== undefined) {
    modalRequest.targetWorkingDirectory = request.targetWorkingDirectory;
  }

  if (request.initialStartMode) {
    modalRequest.initialStartMode = request.initialStartMode;
  }

  if (existingSessionOptions.length > 0) {
    modalRequest.existingSessionOptions = existingSessionOptions;
  }

  if (initialSourceSession !== undefined) {
    modalRequest.initialSourceSession = initialSourceSession;
  }

  return modalRequest;
};

const launchActionSupportsReusableSessions = (
  launchActionId: SessionStartFlowRequest["launchActionId"],
): boolean => {
  return getSessionLaunchAction(launchActionId).startModes.some(
    (mode) => mode === "reuse" || mode === "fork",
  );
};

const resolveExistingSessionOptions = (
  request: SessionStartFlowRequest,
  taskSessions: AgentSessionSummary[],
) => {
  if (request.existingSessionOptions) {
    return request.existingSessionOptions;
  }

  if (!launchActionSupportsReusableSessions(request.launchActionId)) {
    return [];
  }

  return buildReusableSessionOptions({
    sessions: taskSessions.filter((session) => session.taskId === request.taskId),
    role: request.role,
  });
};

const resolveInitialSourceSession = ({
  request,
  existingSessionOptions,
  preferredSourceSession,
}: {
  request: SessionStartFlowRequest;
  existingSessionOptions: ReturnType<typeof resolveExistingSessionOptions>;
  preferredSourceSession?: SessionStartContextSession | null | undefined;
}): AgentSessionIdentity | null => {
  if (request.initialSourceSession !== undefined) {
    return request.initialSourceSession;
  }

  if (
    preferredSourceSession &&
    preferredSourceSession.taskId === request.taskId &&
    preferredSourceSession.role === request.role &&
    existingSessionOptions.some(
      (option) => option.value === agentSessionIdentityKey(preferredSourceSession),
    )
  ) {
    return toAgentSessionIdentity(preferredSourceSession);
  }

  return existingSessionOptions[0]?.sourceSession ?? null;
};

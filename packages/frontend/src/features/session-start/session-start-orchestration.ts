import type { GitTargetBranch, RuntimeKind, TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentSessionStartMode } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import { agentSessionIdentityKey, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { StartAgentSession } from "@/types/agent-session-start";
import { getSessionLaunchAction } from "./session-start-launch-options";
import type { SessionStartModalSource } from "./session-start-modal-types";
import { buildReusableSessionOptions } from "./session-start-reuse-options";
import type { NewSessionStartDecision, NewSessionStartRequest } from "./session-start-types";
import {
  type SendAgentMessage,
  type SessionStartBeforeAction,
  type SessionStartPostAction,
  type SessionStartWorkflowResult,
  startSessionWorkflow,
} from "./session-start-workflow";
import type { SessionStartModalOpenRequest } from "./use-session-start-modal-coordinator";

export type SessionStartFlowRequest = Omit<NewSessionStartRequest, "selectedModel"> & {
  initialStartMode?: AgentSessionStartMode;
  postStartAction: SessionStartPostAction;
  holdForPostStartMessage?: boolean;
  message?: string;
  beforeStartAction?: SessionStartBeforeAction;
};

export type SessionStartLaunchRequest = SessionStartFlowRequest;

export type ResolvedSessionStartDecision = Exclude<NewSessionStartDecision, null>;

type SessionStartModalRunRequest = SessionStartModalOpenRequest & {
  selectedModel?: AgentModelSelection | null;
};

type SessionStartContextSession = {
  externalSessionId: string;
  runtimeKind: AgentSessionSummary["runtimeKind"];
  workingDirectory: string;
  taskId: string;
  role: AgentSessionSummary["role"];
};

type BuildSessionStartModalRequestArgs = {
  source: SessionStartModalSource;
  request: SessionStartFlowRequest;
  requestedRuntimeKind?: RuntimeKind | null;
  selectedModel: AgentModelSelection | null;
  taskSessions: AgentSessionSummary[];
  preferredSourceSession?: SessionStartContextSession | null | undefined;
  selectedTask?: Pick<TaskCard, "targetBranch" | "targetBranchError"> | null;
};

type ExecuteSessionStartFromDecisionArgs = {
  queryClient: QueryClient;
  request: SessionStartFlowRequest;
  decision: ResolvedSessionStartDecision;
  task: TaskCard | null;
  workspaceId: string | null;
  persistTaskTargetBranch?: (taskId: string, targetBranch: GitTargetBranch) => Promise<void>;
  startAgentSession: StartAgentSession;
  sendAgentMessage?: SendAgentMessage;
  humanRequestChangesTask?: (taskId: string, note?: string) => Promise<void>;
};

export type RunSessionStartWorkflowInput = Omit<
  ExecuteSessionStartFromDecisionArgs,
  "queryClient" | "workspaceId" | "startAgentSession" | "sendAgentMessage"
>;

export type RunSessionStartWorkflow = (
  input: RunSessionStartWorkflowInput,
) => Promise<SessionStartWorkflowResult>;

type CreateSessionStartWorkflowRunnerArgs = Pick<
  ExecuteSessionStartFromDecisionArgs,
  "queryClient" | "workspaceId" | "startAgentSession" | "sendAgentMessage"
>;

const launchActionSupportsReusableSessions = (
  launchActionId: SessionStartFlowRequest["launchActionId"],
): boolean => {
  return getSessionLaunchAction(launchActionId).allowedStartModes.some(
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

export const buildSessionStartModalRequest = ({
  source,
  request,
  requestedRuntimeKind,
  selectedModel,
  taskSessions,
  preferredSourceSession,
  selectedTask,
}: BuildSessionStartModalRequestArgs): SessionStartModalRunRequest => {
  const existingSessionOptions = resolveExistingSessionOptions(request, taskSessions);
  const initialSourceSession = resolveInitialSourceSession({
    request,
    existingSessionOptions,
    preferredSourceSession,
  });
  const initialTargetBranch = request.initialTargetBranch ?? selectedTask?.targetBranch ?? null;
  const initialTargetBranchError =
    request.initialTargetBranchError ?? selectedTask?.targetBranchError ?? null;

  return {
    source,
    taskId: request.taskId,
    role: request.role,
    launchActionId: request.launchActionId,
    postStartAction: request.postStartAction,
    ...(requestedRuntimeKind ? { requestedRuntimeKind } : {}),
    selectedModel,
    initialTargetBranch,
    ...(initialTargetBranchError ? { initialTargetBranchError } : {}),
    ...(request.targetWorkingDirectory !== undefined
      ? { targetWorkingDirectory: request.targetWorkingDirectory }
      : {}),
    ...(request.initialStartMode ? { initialStartMode: request.initialStartMode } : {}),
    ...(existingSessionOptions.length > 0 ? { existingSessionOptions } : {}),
    ...(initialSourceSession !== undefined ? { initialSourceSession } : {}),
  };
};

export const executeSessionStartFromDecision = async ({
  queryClient,
  request,
  decision,
  task,
  workspaceId,
  persistTaskTargetBranch,
  startAgentSession,
  sendAgentMessage,
  humanRequestChangesTask,
}: ExecuteSessionStartFromDecisionArgs): Promise<SessionStartWorkflowResult> => {
  return startSessionWorkflow({
    queryClient,
    intent: {
      taskId: request.taskId,
      role: request.role,
      launchActionId: request.launchActionId,
      startMode: decision.startMode,
      ...(decision.targetBranch ? { targetBranch: decision.targetBranch } : {}),
      postStartAction: request.postStartAction,
      ...(request.targetWorkingDirectory !== undefined
        ? { targetWorkingDirectory: request.targetWorkingDirectory }
        : {}),
      ...(request.holdForPostStartMessage ? { holdForPostStartMessage: true } : {}),
      ...(request.message ? { message: request.message } : {}),
      ...(request.beforeStartAction ? { beforeStartAction: request.beforeStartAction } : {}),
      ...(decision.startMode === "reuse" || decision.startMode === "fork"
        ? { sourceSession: decision.sourceSession }
        : {}),
    },
    selection: decision.startMode === "reuse" ? null : decision.selectedModel,
    task,
    workspaceId,
    ...(persistTaskTargetBranch ? { persistTaskTargetBranch } : {}),
    startAgentSession,
    ...(sendAgentMessage ? { sendAgentMessage } : {}),
    ...(humanRequestChangesTask ? { humanRequestChangesTask } : {}),
  });
};

export const createSessionStartWorkflowRunner = ({
  queryClient,
  workspaceId,
  startAgentSession,
  sendAgentMessage,
}: CreateSessionStartWorkflowRunnerArgs): RunSessionStartWorkflow => {
  return (input) =>
    executeSessionStartFromDecision({
      ...input,
      queryClient,
      workspaceId,
      startAgentSession,
      ...(sendAgentMessage ? { sendAgentMessage } : {}),
    });
};

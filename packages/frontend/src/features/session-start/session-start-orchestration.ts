import type { GitTargetBranch, TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentSessionStartMode } from "@openducktor/core";
import { getAgentScenarioDefinition } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { ActiveWorkspace, AgentStateContextValue } from "@/types/state-slices";
import type { SessionStartModalSource } from "./session-start-modal-types";
import { buildReusableSessionOptions } from "./session-start-reuse-options";
import type {
  NewSessionStartDecision,
  NewSessionStartRequest,
  SessionStartRequestReason,
} from "./session-start-types";
import {
  type SessionStartBeforeAction,
  type SessionStartPostAction,
  type SessionStartWorkflowResult,
  startSessionWorkflow,
} from "./session-start-workflow";
import type { SessionStartModalOpenRequest } from "./use-session-start-modal-coordinator";

export type SessionStartFlowRequest = Omit<NewSessionStartRequest, "selectedModel" | "reason"> & {
  initialStartMode?: AgentSessionStartMode;
  postStartAction: SessionStartPostAction;
  message?: string;
  beforeStartAction?: SessionStartBeforeAction;
};

export type SessionStartLaunchRequest = SessionStartFlowRequest & {
  reason: SessionStartRequestReason;
};

export type ResolvedSessionStartDecision = Exclude<NewSessionStartDecision, null>;

type SessionStartModalRunRequest = SessionStartModalOpenRequest & {
  selectedModel?: AgentModelSelection | null;
};

type SessionStartContextSession = {
  sessionId: string;
  taskId: string;
  role: AgentSessionSummary["role"];
};

type BuildSessionStartModalRequestArgs = {
  source: SessionStartModalSource;
  request: SessionStartFlowRequest;
  selectedModel: AgentModelSelection | null;
  taskSessions: AgentSessionSummary[];
  activeSession?: SessionStartContextSession | null | undefined;
  selectedTask?: Pick<TaskCard, "targetBranch" | "targetBranchError"> | null;
};

type ExecuteSessionStartFromDecisionArgs = {
  activeWorkspace: ActiveWorkspace | null;
  queryClient: QueryClient;
  request: SessionStartFlowRequest;
  decision: ResolvedSessionStartDecision;
  task: TaskCard | null;
  persistTaskTargetBranch?: (taskId: string, targetBranch: GitTargetBranch) => Promise<void>;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  sendAgentMessage?: AgentStateContextValue["sendAgentMessage"];
  humanRequestChangesTask?: (taskId: string, note?: string) => Promise<void>;
  postStartExecution?: "await" | "detached";
  onPostStartActionError?: ((action: SessionStartPostAction, error: Error) => void) | undefined;
};

const scenarioSupportsReusableSessions = (
  scenario: SessionStartFlowRequest["scenario"],
): boolean => {
  return getAgentScenarioDefinition(scenario).allowedStartModes.some(
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

  if (!scenarioSupportsReusableSessions(request.scenario)) {
    return [];
  }

  return buildReusableSessionOptions({
    sessions: taskSessions.filter((session) => session.taskId === request.taskId),
    role: request.role,
  });
};

const resolveInitialSourceSessionId = ({
  request,
  existingSessionOptions,
  activeSession,
}: {
  request: SessionStartFlowRequest;
  existingSessionOptions: ReturnType<typeof resolveExistingSessionOptions>;
  activeSession?: SessionStartContextSession | null | undefined;
}): string | null => {
  if (request.initialSourceSessionId !== undefined) {
    return request.initialSourceSessionId;
  }

  if (
    activeSession &&
    activeSession.taskId === request.taskId &&
    activeSession.role === request.role &&
    existingSessionOptions.some((option) => option.value === activeSession.sessionId)
  ) {
    return activeSession.sessionId;
  }

  return existingSessionOptions[0]?.value ?? null;
};

export const buildSessionStartModalRequest = ({
  source,
  request,
  selectedModel,
  taskSessions,
  activeSession,
  selectedTask,
}: BuildSessionStartModalRequestArgs): SessionStartModalRunRequest => {
  const existingSessionOptions = resolveExistingSessionOptions(request, taskSessions);
  const initialSourceSessionId = resolveInitialSourceSessionId({
    request,
    existingSessionOptions,
    activeSession,
  });
  const initialTargetBranch = request.initialTargetBranch ?? selectedTask?.targetBranch ?? null;
  const initialTargetBranchError =
    request.initialTargetBranchError ?? selectedTask?.targetBranchError ?? null;

  return {
    source,
    taskId: request.taskId,
    role: request.role,
    scenario: request.scenario,
    postStartAction: request.postStartAction,
    selectedModel,
    initialTargetBranch,
    ...(initialTargetBranchError ? { initialTargetBranchError } : {}),
    ...(request.targetWorkingDirectory !== undefined
      ? { targetWorkingDirectory: request.targetWorkingDirectory }
      : {}),
    ...(request.initialStartMode ? { initialStartMode: request.initialStartMode } : {}),
    ...(existingSessionOptions.length > 0 ? { existingSessionOptions } : {}),
    ...(initialSourceSessionId !== undefined ? { initialSourceSessionId } : {}),
  };
};

export const executeSessionStartFromDecision = async ({
  activeWorkspace,
  queryClient,
  request,
  decision,
  task,
  persistTaskTargetBranch,
  startAgentSession,
  sendAgentMessage,
  humanRequestChangesTask,
  postStartExecution,
  onPostStartActionError,
}: ExecuteSessionStartFromDecisionArgs): Promise<SessionStartWorkflowResult> => {
  const resolvedPostStartExecution =
    postStartExecution ?? (request.postStartAction === "none" ? "await" : "detached");

  return startSessionWorkflow({
    activeWorkspace,
    queryClient,
    intent: {
      taskId: request.taskId,
      role: request.role,
      scenario: request.scenario,
      startMode: decision.startMode,
      ...(decision.targetBranch ? { targetBranch: decision.targetBranch } : {}),
      postStartAction: request.postStartAction,
      ...(request.targetWorkingDirectory !== undefined
        ? { targetWorkingDirectory: request.targetWorkingDirectory }
        : {}),
      ...(request.message ? { message: request.message } : {}),
      ...(request.beforeStartAction ? { beforeStartAction: request.beforeStartAction } : {}),
      ...(decision.startMode === "reuse" || decision.startMode === "fork"
        ? { sourceSessionId: decision.sourceSessionId }
        : {}),
    },
    selection: decision.startMode === "reuse" ? null : decision.selectedModel,
    task,
    ...(persistTaskTargetBranch ? { persistTaskTargetBranch } : {}),
    startAgentSession,
    ...(sendAgentMessage ? { sendAgentMessage } : {}),
    ...(humanRequestChangesTask ? { humanRequestChangesTask } : {}),
    postStartExecution: resolvedPostStartExecution,
    onDetachedPostStartError:
      resolvedPostStartExecution === "detached" && onPostStartActionError
        ? (error) => onPostStartActionError(request.postStartAction, error)
        : undefined,
  });
};

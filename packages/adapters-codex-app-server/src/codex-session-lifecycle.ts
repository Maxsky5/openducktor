import type {
  AgentModelSelection,
  AgentRole,
  AgentSessionSummary,
  AttachAgentSessionInput,
  ForkAgentSessionInput,
  ResumeAgentSessionInput,
  StartAgentSessionInput,
} from "@openducktor/core";
import {
  extractThreadId,
  requireThreadSnapshotFromReadResponse,
  toSessionSummary,
} from "./codex-app-server-threads";
import type {
  CodexSessionState,
  CodexThreadForkResult,
  CodexThreadResumeResult,
  CodexThreadStartResult,
} from "./types";

type SessionInput =
  | StartAgentSessionInput
  | ResumeAgentSessionInput
  | ForkAgentSessionInput
  | AttachAgentSessionInput;

type SessionStateInput = SessionInput & {
  role: AgentRole | null;
  systemPrompt: string;
  taskId: string;
};

const buildSessionState = (
  input: SessionStateInput,
  summary: AgentSessionSummary,
  runtimeId: string,
  model: AgentModelSelection | undefined,
  liveStatus?: CodexSessionState["liveStatus"],
): CodexSessionState => ({
  summary,
  ...(model ? { model } : {}),
  systemPrompt: input.systemPrompt,
  role: input.role,
  runtimeId,
  repoPath: input.repoPath,
  threadId: summary.externalSessionId,
  workingDirectory: input.workingDirectory,
  taskId: input.taskId,
  ...(liveStatus ? { liveStatus } : {}),
});

export const sessionStateFromThreadStart = (
  input: StartAgentSessionInput,
  runtimeId: string,
  model: AgentModelSelection,
  response: CodexThreadStartResult,
): CodexSessionState => {
  const { externalSessionId, startedAt } = extractThreadId(response, "thread/start");
  const summary = toSessionSummary({
    externalSessionId,
    startedAt: startedAt ?? new Date().toISOString(),
    role: input.role,
    status: "running",
  });
  return buildSessionState(input, summary, runtimeId, model);
};

export const sessionStateFromThreadResume = (
  input: ResumeAgentSessionInput,
  runtimeId: string,
  model: AgentModelSelection,
  response: CodexThreadResumeResult,
): CodexSessionState => sessionStateFromThreadResumeResponse(input, runtimeId, model, response);

export const sessionStateFromThreadFork = (
  input: ForkAgentSessionInput,
  runtimeId: string,
  model: AgentModelSelection,
  response: CodexThreadForkResult,
): CodexSessionState => {
  const { externalSessionId, startedAt } = extractThreadId(response, "thread/fork");
  const summary = toSessionSummary({
    externalSessionId,
    startedAt: startedAt ?? new Date().toISOString(),
    role: input.role,
    status: "running",
  });
  return buildSessionState(input, summary, runtimeId, model);
};

export const sessionStateFromThreadAttach = (
  input: AttachAgentSessionInput,
  runtimeId: string,
  model: AgentModelSelection | undefined,
  response: CodexThreadResumeResult,
): CodexSessionState => sessionStateFromThreadResumeResponse(input, runtimeId, model, response);

type SessionScopedMap = {
  delete(key: string): boolean;
  keys(): IterableIterator<string>;
};

type RequestIdsBySession = {
  get(key: string): Iterable<string> | undefined;
  delete(key: string): boolean;
};

export type CodexLocalSessionStateStore = {
  sessions: { delete(key: string): boolean };
  listenersBySessionId: { delete(key: string): boolean };
  bufferedNotificationsByThreadId: { delete(key: string): boolean };
  bufferedServerRequestsByThreadId: { delete(key: string): boolean };
  handledStreamRequestKeysByThreadId: { delete(key: string): boolean };
  syntheticUserMessageTextsByThreadId: { delete(key: string): boolean };
  eventBacklogBySessionId: { delete(key: string): boolean };
  latestTodosBySessionId: { delete(key: string): boolean };
  activeTurnsBySessionId: { delete(key: string): boolean };
  pendingApprovalIdsBySessionId: RequestIdsBySession;
  pendingApprovalsByRequestId: { delete(key: string): boolean };
  activeTurnsByApprovalRequestId: { delete(key: string): boolean };
  pendingQuestionIdsBySessionId: RequestIdsBySession;
  pendingQuestionsByRequestId: { delete(key: string): boolean };
  activeTurnsByQuestionRequestId: { delete(key: string): boolean };
  completedAgentMessagesByTurnKey: SessionScopedMap;
  tokenUsageByTurnKey: SessionScopedMap;
  modelByTurnKey: SessionScopedMap;
};

export const clearLocalSessionState = (
  store: CodexLocalSessionStateStore,
  externalSessionId: string,
): void => {
  store.sessions.delete(externalSessionId);
  store.listenersBySessionId.delete(externalSessionId);
  store.bufferedNotificationsByThreadId.delete(externalSessionId);
  store.bufferedServerRequestsByThreadId.delete(externalSessionId);
  store.handledStreamRequestKeysByThreadId.delete(externalSessionId);
  store.syntheticUserMessageTextsByThreadId.delete(externalSessionId);
  store.eventBacklogBySessionId.delete(externalSessionId);
  store.latestTodosBySessionId.delete(externalSessionId);
  store.activeTurnsBySessionId.delete(externalSessionId);
  const approvalRequestIds = store.pendingApprovalIdsBySessionId.get(externalSessionId) ?? [];
  for (const requestId of approvalRequestIds) {
    store.pendingApprovalsByRequestId.delete(requestId);
    store.activeTurnsByApprovalRequestId.delete(requestId);
  }
  store.pendingApprovalIdsBySessionId.delete(externalSessionId);
  const questionRequestIds = store.pendingQuestionIdsBySessionId.get(externalSessionId) ?? [];
  for (const requestId of questionRequestIds) {
    store.pendingQuestionsByRequestId.delete(requestId);
    store.activeTurnsByQuestionRequestId.delete(requestId);
  }
  store.pendingQuestionIdsBySessionId.delete(externalSessionId);
  const turnKeyPrefix = `${externalSessionId}:`;
  for (const turnKey of [...store.completedAgentMessagesByTurnKey.keys()]) {
    if (turnKey.startsWith(turnKeyPrefix)) {
      store.completedAgentMessagesByTurnKey.delete(turnKey);
    }
  }
  for (const turnKey of [...store.tokenUsageByTurnKey.keys()]) {
    if (turnKey.startsWith(turnKeyPrefix)) {
      store.tokenUsageByTurnKey.delete(turnKey);
    }
  }
  for (const turnKey of [...store.modelByTurnKey.keys()]) {
    if (turnKey.startsWith(turnKeyPrefix)) {
      store.modelByTurnKey.delete(turnKey);
    }
  }
};

const sessionStateFromThreadResumeResponse = (
  input: ResumeAgentSessionInput | AttachAgentSessionInput,
  runtimeId: string,
  model: AgentModelSelection | undefined,
  response: CodexThreadResumeResult,
): CodexSessionState => {
  const { externalSessionId, startedAt } = extractThreadId(response, "thread/resume");
  const threadSnapshot = requireThreadSnapshotFromReadResponse(
    response,
    "thread/resume",
    externalSessionId,
  );
  const summary = toSessionSummary({
    externalSessionId,
    startedAt: startedAt ?? threadSnapshot.startedAt,
    role: input.role,
    status: threadSnapshot.status.agentSessionStatus,
  });
  return buildSessionState(input, summary, runtimeId, model, threadSnapshot.status);
};

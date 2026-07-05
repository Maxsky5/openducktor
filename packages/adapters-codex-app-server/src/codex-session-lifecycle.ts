import type {
  AgentModelSelection,
  AgentSessionSummary,
  ForkAgentSessionInput,
  PolicyBoundSessionRef,
  ResumeAgentSessionInput,
  StartAgentSessionInput,
} from "@openducktor/core";
import { agentSessionStatusFromActivity } from "@openducktor/core";
import {
  type CodexThreadSnapshot,
  codexThreadStatusSnapshot,
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
  | PolicyBoundSessionRef;

type SessionStateInput = SessionInput & { sessionScope?: StartAgentSessionInput["sessionScope"] };

const inputRole = (input: SessionStateInput) => input.sessionScope?.role ?? null;
const inputTaskId = (input: SessionStateInput): string | null => input.sessionScope?.taskId ?? null;

const buildSessionState = (
  input: SessionStateInput,
  summary: AgentSessionSummary,
  runtimeId: string,
  model: AgentModelSelection | undefined,
  liveStatus?: CodexSessionState["liveStatus"],
): CodexSessionState => ({
  summary,
  ...(model ? { model } : {}),
  systemPrompt: input.systemPrompt ?? "",
  role: inputRole(input),
  runtimeId,
  repoPath: input.repoPath,
  threadId: summary.externalSessionId,
  workingDirectory: input.workingDirectory,
  taskId: inputTaskId(input),
  runtimePolicy: input.runtimePolicy,
  ...(liveStatus ? { liveStatus } : {}),
});

export const applyRuntimeContextToSession = (
  session: CodexSessionState,
  input: PolicyBoundSessionRef,
): void => {
  const sessionScope = (input as { sessionScope?: StartAgentSessionInput["sessionScope"] })
    .sessionScope;
  if (sessionScope) {
    session.role = sessionScope.role;
    session.taskId = sessionScope.taskId;
  }
  session.runtimePolicy = input.runtimePolicy;
  if (input.systemPrompt !== undefined) {
    session.systemPrompt = input.systemPrompt;
  }
  if (input.model !== undefined) {
    session.model = input.model;
  }
};

export const sessionStateFromThreadStart = (
  input: StartAgentSessionInput,
  runtimeId: string,
  model: AgentModelSelection,
  response: CodexThreadStartResult,
  title: string,
): CodexSessionState => {
  const { externalSessionId, startedAt } = extractThreadId(response, "thread/start");
  const summary = toSessionSummary({
    externalSessionId,
    workingDirectory: input.workingDirectory,
    startedAt: startedAt ?? new Date().toISOString(),
    title,
    role: inputRole(input),
    status: "running",
  });
  return buildSessionState(input, summary, runtimeId, model, codexThreadStatusSnapshot("active"));
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
  title: string,
): CodexSessionState => {
  const { externalSessionId, startedAt } = extractThreadId(response, "thread/fork");
  const summary = toSessionSummary({
    externalSessionId,
    workingDirectory: input.workingDirectory,
    startedAt: startedAt ?? new Date().toISOString(),
    title,
    role: inputRole(input),
    status: "running",
  });
  return buildSessionState(input, summary, runtimeId, model, codexThreadStatusSnapshot("active"));
};

export const sessionStateFromExistingThread = (
  input: PolicyBoundSessionRef,
  runtimeId: string,
  model: AgentModelSelection | undefined,
  response: CodexThreadResumeResult,
): CodexSessionState => {
  const session = sessionStateFromThreadResumeResponse(input, runtimeId, model, response);
  delete session.liveStatus;
  return session;
};

export const sessionStateFromThreadSnapshot = (
  input: PolicyBoundSessionRef,
  runtimeId: string,
  threadSnapshot: CodexThreadSnapshot,
): CodexSessionState => {
  const summary = toSessionSummary({
    externalSessionId: threadSnapshot.id,
    workingDirectory: input.workingDirectory,
    startedAt: threadSnapshot.startedAt,
    title: threadSnapshot.title,
    role: inputRole(input),
    status: agentSessionStatusFromActivity(threadSnapshot.status.classification),
  });
  return buildSessionState(input, summary, runtimeId, undefined);
};

export const preserveRuntimeContextForExistingThread = (
  existingThreadSession: CodexSessionState,
  current: CodexSessionState | undefined,
): CodexSessionState => {
  if (!current) {
    return existingThreadSession;
  }

  return {
    ...existingThreadSession,
    ...(existingThreadSession.model || !current.model ? {} : { model: current.model }),
    role: existingThreadSession.role ?? current.role,
    taskId: existingThreadSession.taskId || current.taskId,
    systemPrompt: existingThreadSession.systemPrompt || current.systemPrompt,
    runtimePolicy: existingThreadSession.runtimePolicy,
  };
};

const sessionStateFromThreadResumeResponse = (
  input: ResumeAgentSessionInput | PolicyBoundSessionRef,
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
    workingDirectory: input.workingDirectory,
    startedAt: startedAt ?? threadSnapshot.startedAt,
    title: threadSnapshot.title,
    role: inputRole(input),
    status: agentSessionStatusFromActivity(threadSnapshot.status.classification),
  });
  return buildSessionState(input, summary, runtimeId, model, threadSnapshot.status);
};

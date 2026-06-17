import type {
  AgentModelSelection,
  AgentRole,
  AgentSessionRef,
  AgentSessionRuntimeRef,
  AgentSessionSummary,
  ForkAgentSessionInput,
  ResumeAgentSessionInput,
  StartAgentSessionInput,
} from "@openducktor/core";
import { agentSessionStatusFromActivity } from "@openducktor/core";
import {
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
  | AgentSessionRuntimeRef
  | AgentSessionRef;

type SessionStateInput = SessionInput & {
  role?: AgentRole | null;
  systemPrompt?: string;
  taskId?: string;
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
  systemPrompt: input.systemPrompt ?? "",
  role: input.role ?? null,
  runtimeId,
  repoPath: input.repoPath,
  threadId: summary.externalSessionId,
  workingDirectory: input.workingDirectory,
  taskId: input.taskId ?? "",
  ...(liveStatus ? { liveStatus } : {}),
});

export const applyRuntimeContextToSession = (
  session: CodexSessionState,
  input: AgentSessionRuntimeRef,
): void => {
  session.role = input.role;
  session.taskId = input.taskId;
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
    role: input.role,
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
    role: input.role,
    status: "running",
  });
  return buildSessionState(input, summary, runtimeId, model, codexThreadStatusSnapshot("active"));
};

export const sessionStateFromExistingThread = (
  input: AgentSessionRef | AgentSessionRuntimeRef,
  runtimeId: string,
  model: AgentModelSelection | undefined,
  response: CodexThreadResumeResult,
): CodexSessionState => {
  const session = sessionStateFromThreadResumeResponse(input, runtimeId, model, response);
  delete session.liveStatus;
  return session;
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
  };
};

const sessionStateFromThreadResumeResponse = (
  input: ResumeAgentSessionInput | AgentSessionRuntimeRef | AgentSessionRef,
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
    role: "role" in input ? input.role : null,
    status: agentSessionStatusFromActivity(threadSnapshot.status.classification),
  });
  return buildSessionState(input, summary, runtimeId, model, threadSnapshot.status);
};

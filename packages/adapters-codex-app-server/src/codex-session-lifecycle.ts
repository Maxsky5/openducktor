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

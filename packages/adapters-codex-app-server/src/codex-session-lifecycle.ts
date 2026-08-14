import type {
  AgentModelSelection,
  AgentSessionAssociation,
  AgentSessionSummary,
  ForkAgentSessionInput,
  PolicyBoundSessionRef,
  ResumeAgentSessionInput,
  StartAgentSessionInput,
} from "@openducktor/core";
import {
  agentSessionScopesEqual,
  agentSessionStatusFromActivity,
  describeAgentSessionScope,
} from "@openducktor/core";
import {
  codexThreadStatusSnapshot,
  extractThreadId,
  requireThreadSnapshotFromReadResponse,
  toSessionSummary,
} from "./codex-app-server-threads";
import { resolveCodexSessionScopePolicy } from "./codex-session-scope-policy";
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

const inputAssociation = (input: SessionStateInput): AgentSessionAssociation =>
  input.sessionScope ?? { kind: "unbound" };

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
  runtimeId,
  repoPath: input.repoPath,
  threadId: summary.externalSessionId,
  workingDirectory: input.workingDirectory,
  runtimePolicy: input.runtimePolicy,
  ...(liveStatus ? { liveStatus } : {}),
});

export const assertRuntimeContextCompatibleWithSession = (
  session: CodexSessionState,
  input: PolicyBoundSessionRef,
  action = "apply runtime context",
): void => {
  const sessionScope = (input as { sessionScope?: StartAgentSessionInput["sessionScope"] })
    .sessionScope;
  if (sessionScope) {
    const registeredAssociation = session.summary.sessionAssociation;
    if (
      registeredAssociation.kind !== "unbound" &&
      !agentSessionScopesEqual(registeredAssociation, sessionScope)
    ) {
      throw new Error(
        `Cannot ${action} for Codex session '${session.threadId}' because its registered ${describeAgentSessionScope(registeredAssociation)} does not match the requested ${describeAgentSessionScope(sessionScope)}.`,
      );
    }
  }
};

export const applyRuntimeContextToSession = (
  session: CodexSessionState,
  input: PolicyBoundSessionRef,
  action = "apply runtime context",
): void => {
  assertRuntimeContextCompatibleWithSession(session, input, action);
  const sessionScope = (input as { sessionScope?: StartAgentSessionInput["sessionScope"] })
    .sessionScope;
  if (sessionScope) {
    const policy = resolveCodexSessionScopePolicy(sessionScope, input.runtimePolicy, action);
    session.summary = {
      ...session.summary,
      ...(policy.kind === "repository" ? { title: policy.title } : {}),
      sessionAssociation: sessionScope,
    };
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
    sessionAssociation: inputAssociation(input),
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
    sessionAssociation: inputAssociation(input),
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

export const preserveRuntimeContextForExistingThread = (
  existingThreadSession: CodexSessionState,
  current: CodexSessionState | undefined,
): CodexSessionState => {
  if (!current) {
    return existingThreadSession;
  }

  return {
    ...existingThreadSession,
    summary: {
      ...existingThreadSession.summary,
      sessionAssociation:
        existingThreadSession.summary.sessionAssociation.kind === "unbound"
          ? current.summary.sessionAssociation
          : existingThreadSession.summary.sessionAssociation,
    },
    ...(existingThreadSession.model || !current.model ? {} : { model: current.model }),
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
    sessionAssociation: inputAssociation(input),
    status: agentSessionStatusFromActivity(threadSnapshot.status.classification),
  });
  return buildSessionState(input, summary, runtimeId, model, threadSnapshot.status);
};

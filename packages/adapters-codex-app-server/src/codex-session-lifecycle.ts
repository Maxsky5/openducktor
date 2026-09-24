import { CODEX_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
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
  agentSessionRefsEqual,
  agentSessionStatusFromActivity,
  describeAgentSessionScope,
  resolveAgentSessionAssociationTransition,
} from "@openducktor/core";
import {
  codexThreadStatusSnapshot,
  extractThreadId,
  requireThreadSnapshotFromReadResponse,
  toSessionSummary,
} from "./codex-app-server-threads";
import { codexSessionRef } from "./codex-session-ref";
import { resolveCodexSessionScopePolicy } from "./codex-session-scope-policy";
import { CODEX_MODEL_PROVIDER_ID } from "./model-catalog";
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

const inputAssociation = (input: SessionInput): AgentSessionAssociation =>
  input.sessionScope ?? { kind: "unbound" };

const buildSessionState = (
  input: SessionInput,
  summary: AgentSessionSummary,
  runtimeId: string,
  model: AgentModelSelection | undefined,
  liveStatus?: CodexSessionState["liveStatus"],
): CodexSessionState => {
  const sessionState: CodexSessionState = {
    summary,
    systemPrompt: input.systemPrompt ?? "",
    runtimeId,
    repoPath: input.repoPath,
    threadId: summary.externalSessionId,
    workingDirectory: input.workingDirectory,
    runtimePolicy: input.runtimePolicy,
  };

  if (model) {
    sessionState.model = model;
  }
  if (liveStatus) {
    sessionState.liveStatus = liveStatus;
  }

  return sessionState;
};

export const assertCodexSessionRef = (
  session: CodexSessionState,
  input: {
    repoPath: string;
    runtimeKind: AgentSessionSummary["runtimeKind"];
    workingDirectory: string;
    externalSessionId: string;
  },
  action: string,
): void => {
  const registeredSessionRef = codexSessionRef(session);
  if (!agentSessionRefsEqual(registeredSessionRef, input)) {
    throw new Error(
      `Cannot ${action} Codex session '${input.externalSessionId}' from repo '${input.repoPath}' and working directory '${input.workingDirectory}' because the registered session belongs to repo '${registeredSessionRef.repoPath}' and working directory '${registeredSessionRef.workingDirectory}'.`,
    );
  }
};

export const assertRuntimeContextCompatibleWithSession = (
  session: CodexSessionState,
  input: PolicyBoundSessionRef,
  action = "apply runtime context",
  toConflictError?: (message: string) => Error,
): void => {
  const transition = resolveAgentSessionAssociationTransition(
    session.summary.sessionAssociation,
    input.sessionScope ?? { kind: "unbound" },
  );
  if (transition.kind === "conflict") {
    const message = `Cannot ${action} for Codex session '${session.threadId}' because its registered ${describeAgentSessionScope(transition.previous)} does not match the requested ${describeAgentSessionScope(transition.incoming)}.`;
    throw toConflictError?.(message) ?? new Error(message);
  }
};

const applyRuntimeContextToSession = (
  session: CodexSessionState,
  input: PolicyBoundSessionRef,
  action = "apply runtime context",
): void => {
  assertRuntimeContextCompatibleWithSession(session, input, action);
  const sessionScope = input.sessionScope;
  if (sessionScope) {
    resolveCodexSessionScopePolicy(sessionScope, input.runtimePolicy, action);
    // A summary title comes from the runtime or from a successful title update.
    // A scope update must not claim a title the runtime did not accept.
    session.summary = {
      ...session.summary,
      sessionAssociation: sessionScope,
    };
    if (sessionScope.kind === "workflow") session.preserveNativeSettings = false;
  }
  session.runtimePolicy = input.runtimePolicy;
  if (input.systemPrompt !== undefined) {
    session.systemPrompt = input.systemPrompt;
  }
  if (input.model !== undefined) {
    session.model = input.model;
  }
};

type ResolveCodexPolicyBoundSessionInput = {
  actions: { context: string; lookup: string };
  bindSession: () => Promise<CodexSessionState>;
  getSession: (externalSessionId: string) => CodexSessionState | undefined;
  input: PolicyBoundSessionRef;
};

export function resolveCodexPolicyBoundSession(
  resolution: ResolveCodexPolicyBoundSessionInput & { bindMissing: true },
): CodexSessionState | Promise<CodexSessionState>;
export function resolveCodexPolicyBoundSession(
  resolution: ResolveCodexPolicyBoundSessionInput & { bindMissing: false },
): CodexSessionState | undefined | Promise<CodexSessionState>;
export function resolveCodexPolicyBoundSession(
  resolution: ResolveCodexPolicyBoundSessionInput & { bindMissing: boolean },
): CodexSessionState | undefined | Promise<CodexSessionState> {
  const { actions, input } = resolution;
  const session = resolution.getSession(input.externalSessionId);
  if (session) {
    assertCodexSessionRef(session, input, actions.lookup);
    assertRuntimeContextCompatibleWithSession(session, input, actions.lookup);
    if (session.summary.sessionAssociation.kind !== "unbound" || !input.sessionScope) {
      applyRuntimeContextToSession(session, input, actions.context);
      return session;
    }
  } else if (!resolution.bindMissing) {
    return undefined;
  }

  return resolution.bindSession().then((boundSession) => {
    applyRuntimeContextToSession(boundSession, input, actions.context);
    return boundSession;
  });
}

export const sessionStateFromThreadStart = (
  input: StartAgentSessionInput,
  runtimeId: string,
  model: AgentModelSelection,
  response: CodexThreadStartResult,
  title: string | undefined,
): CodexSessionState => {
  const { externalSessionId, startedAt } = extractThreadId(response);
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
  title: string | undefined,
): CodexSessionState => {
  const { externalSessionId, startedAt } = extractThreadId(response);
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
  if (!model) {
    session.model = {
      runtimeKind: CODEX_RUNTIME_DESCRIPTOR.kind,
      providerId: CODEX_MODEL_PROVIDER_ID,
      modelId: response.model,
    };
    if (response.reasoningEffort !== null) {
      session.model.variant = response.reasoningEffort;
    }
  }
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

  const session: CodexSessionState = {
    ...existingThreadSession,
    summary: {
      ...existingThreadSession.summary,
      sessionAssociation:
        existingThreadSession.summary.sessionAssociation.kind === "unbound"
          ? current.summary.sessionAssociation
          : existingThreadSession.summary.sessionAssociation,
    },
    systemPrompt: existingThreadSession.systemPrompt || current.systemPrompt,
    runtimePolicy: existingThreadSession.runtimePolicy,
  };

  if (!existingThreadSession.model && current.model) {
    session.model = current.model;
  }

  return session;
};

const sessionStateFromThreadResumeResponse = (
  input: ResumeAgentSessionInput | PolicyBoundSessionRef,
  runtimeId: string,
  model: AgentModelSelection | undefined,
  response: CodexThreadResumeResult,
): CodexSessionState => {
  const { externalSessionId, startedAt } = extractThreadId(response);
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

import type { PolicyBoundSessionRef } from "@openducktor/core";
import {
  agentSessionRefsEqual,
  describeAgentSessionScope,
  resolveAgentSessionAssociationTransition,
} from "@openducktor/core";
import type { OpencodeSessionPolicy } from "./opencode-session-policy";
import { toOpenCodeRequestError } from "./request-errors";
import { opencodeSessionRef } from "./session-ref";
import type { SessionRecord } from "./types";
import { ensureTrustedOdtMcpServerConnected } from "./workflow-tool-selection";

export const requireOpencodeSessionPolicyRuntime = async (input: {
  client: SessionRecord["client"];
  policy: OpencodeSessionPolicy;
  workingDirectory: string;
}): Promise<void> => {
  if (input.policy.toolSelection.kind === "repository") {
    await ensureTrustedOdtMcpServerConnected({
      client: input.client,
      workingDirectory: input.workingDirectory,
    });
  }
};

export const applySessionPolicy = async (input: {
  client: SessionRecord["client"];
  externalSessionId: string;
  policy: OpencodeSessionPolicy;
  workingDirectory: string;
}): Promise<void> => {
  const action = `update ${input.policy.toolSelection.kind} session policy for session '${input.externalSessionId}'`;
  try {
    const updated = await input.client.session.update({
      directory: input.workingDirectory,
      sessionID: input.externalSessionId,
      title: input.policy.title,
      permission: input.policy.permission,
    });
    if (updated.data === undefined || updated.data === null) {
      throw toOpenCodeRequestError(action, updated.error, updated.response);
    }
  } catch (error) {
    throw toOpenCodeRequestError(action, error);
  }
};

const assertRuntimeContextCompatibleWithSession = (
  session: SessionRecord,
  input: PolicyBoundSessionRef,
  action: string,
): void => {
  const transition = resolveAgentSessionAssociationTransition(
    session.summary.sessionAssociation,
    input.sessionScope ?? { kind: "unbound" },
  );
  if (transition.kind === "conflict") {
    throw new Error(
      `Cannot ${action} for OpenCode session '${session.externalSessionId}' because its registered ${describeAgentSessionScope(transition.previous)} does not match the requested ${describeAgentSessionScope(transition.incoming)}.`,
    );
  }
};

export const applyRuntimeContextToSession = (
  session: SessionRecord,
  input: PolicyBoundSessionRef,
  action: string,
): void => {
  assertRuntimeContextCompatibleWithSession(session, input, action);
  session.input = { ...session.input };
  const sessionScope = input.sessionScope;
  if (sessionScope) {
    session.input.sessionScope = sessionScope;
    session.summary = {
      ...session.summary,
      sessionAssociation: sessionScope,
    };
  }
  session.input.runtimePolicy = input.runtimePolicy;
  if (input.model !== undefined) {
    if (input.model) {
      session.input.model = input.model;
    } else {
      delete session.input.model;
    }
  }
  if (input.systemPrompt !== undefined) {
    session.input.systemPrompt = input.systemPrompt;
  }
};

export const synchronizeOpencodeSessionPolicy = async (input: {
  action: string;
  policy: OpencodeSessionPolicy;
  request: PolicyBoundSessionRef;
  session: SessionRecord;
}): Promise<void> => {
  assertRuntimeContextCompatibleWithSession(input.session, input.request, input.action);
  await requireOpencodeSessionPolicyRuntime({
    client: input.session.client,
    policy: input.policy,
    workingDirectory: input.request.workingDirectory,
  });
  await applySessionPolicy({
    client: input.session.client,
    externalSessionId: input.session.externalSessionId,
    policy: input.policy,
    workingDirectory: input.request.workingDirectory,
  });
  applyRuntimeContextToSession(input.session, input.request, input.action);
  input.session.summary = { ...input.session.summary, title: input.policy.title };
};

export const adoptPreparedOpencodeSessionPolicy = async (input: {
  action: string;
  policy: OpencodeSessionPolicy;
  request: PolicyBoundSessionRef;
  session: SessionRecord;
}): Promise<void> => {
  assertRuntimeContextCompatibleWithSession(input.session, input.request, input.action);
  if (!input.session.input.sessionScope) {
    await applySessionPolicy({
      client: input.session.client,
      externalSessionId: input.session.externalSessionId,
      policy: input.policy,
      workingDirectory: input.request.workingDirectory,
    });
  }
  applyRuntimeContextToSession(input.session, input.request, input.action);
  input.session.summary = { ...input.session.summary, title: input.policy.title };
};

export const resolveOpencodePolicyBoundSession = (input: {
  action: string;
  bindSession: () => Promise<SessionRecord>;
  request: PolicyBoundSessionRef;
  retainedSession: SessionRecord | undefined;
}): SessionRecord | Promise<SessionRecord> => {
  const { request, retainedSession } = input;
  if (
    !retainedSession ||
    (retainedSession.summary.sessionAssociation.kind === "unbound" && request.sessionScope)
  ) {
    return input.bindSession();
  }
  const registeredSessionRef = opencodeSessionRef(retainedSession);
  if (!agentSessionRefsEqual(registeredSessionRef, request)) {
    throw new Error(
      `Cannot ${input.action} OpenCode session '${request.externalSessionId}' from repo '${request.repoPath}' and working directory '${request.workingDirectory}' because the registered session belongs to repo '${registeredSessionRef.repoPath}' and working directory '${registeredSessionRef.workingDirectory}'.`,
    );
  }
  applyRuntimeContextToSession(retainedSession, request, input.action);
  return retainedSession;
};

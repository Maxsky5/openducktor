import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { PolicyBoundSessionRef } from "@openducktor/core";
import { agentSessionScopesEqual, describeAgentSessionScope } from "@openducktor/core";
import type { OpencodeSessionPolicy } from "./opencode-session-policy";
import { resolveOpencodeSessionPolicy } from "./opencode-session-policy";
import { toOpenCodeRequestError } from "./request-errors";
import type { SessionInput, SessionRecord } from "./types";

export const applyRepositorySessionPolicy = async (input: {
  client: SessionRecord["client"];
  externalSessionId: string;
  policy: OpencodeSessionPolicy;
  workingDirectory: string;
}): Promise<void> => {
  if (input.policy.toolSelection.kind !== "repository") {
    return;
  }
  const action = `update repository session policy for session '${input.externalSessionId}'`;
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

export const assertRuntimeContextCompatibleWithSession = (
  session: SessionRecord,
  input: PolicyBoundSessionRef,
  action: string,
): void => {
  const sessionScope = (input as { sessionScope?: SessionInput["sessionScope"] }).sessionScope;
  if (!sessionScope) {
    return;
  }
  const registeredScope = session.input.sessionScope;
  if (registeredScope && !agentSessionScopesEqual(registeredScope, sessionScope)) {
    throw new Error(
      `Cannot ${action} for OpenCode session '${session.externalSessionId}' because its registered ${describeAgentSessionScope(registeredScope)} does not match the requested ${describeAgentSessionScope(sessionScope)}.`,
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
  const sessionScope = (input as { sessionScope?: SessionInput["sessionScope"] }).sessionScope;
  if (sessionScope) {
    session.input.sessionScope = sessionScope;
    const policy = resolveOpencodeSessionPolicy(sessionScope, OPENCODE_RUNTIME_DESCRIPTOR, action);
    session.summary = {
      ...session.summary,
      title: policy.title,
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

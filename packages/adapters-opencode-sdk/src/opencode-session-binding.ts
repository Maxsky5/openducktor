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
import { ensureTrustedOdtMcpServerConnected } from "./opencode-mcp-readiness";
import {
  restoreSessionPermissions,
  beginPermissionSetup,
  permissionAction,
} from "./opencode-session-permissions";

export const getBoundSession = (input: {
  action: string;
  bindSession: () => Promise<SessionRecord>;
  request: PolicyBoundSessionRef;
  session: SessionRecord | undefined;
}): SessionRecord | Promise<SessionRecord> => {
  const { request, session } = input;
  if (!session || (session.summary.sessionAssociation.kind === "unbound" && request.sessionScope)) {
    return input.bindSession();
  }
  assertSessionRef(session, request, input.action);
  applySessionContext(session, request, input.action);
  return session;
};

/** Keep the old binding if native permission setup fails. */
export const restoreSessionPolicy = async (input: {
  action: string;
  policy: OpencodeSessionPolicy;
  request: PolicyBoundSessionRef;
  session: SessionRecord;
}): Promise<void> => {
  assertSessionScope(input.session, input.request, input.action);
  const finishSetup =
    input.policy.scope.kind === "workflow" ? beginPermissionSetup(input.session) : undefined;
  try {
    await ensureTrustedOdtMcpServerConnected({
      client: input.session.client,
      workingDirectory: input.request.workingDirectory,
    });
    await restoreSessionPermissions({
      client: input.session.client,
      externalSessionId: input.session.externalSessionId,
      policy: input.policy,
      workingDirectory: input.request.workingDirectory,
    });
    delete input.session.permissionSetupError;
  } catch (cause) {
    if (input.policy.scope.kind === "workflow")
      input.session.permissionSetupError = toOpenCodeRequestError(
        permissionAction(
          "restore",
          input.session.externalSessionId,
          input.request.workingDirectory,
        ),
        cause,
      );
    throw cause;
  } finally {
    finishSetup?.();
  }
  const title = await setSessionTitle({
    client: input.session.client,
    externalSessionId: input.session.externalSessionId,
    title: input.policy.title,
    workingDirectory: input.request.workingDirectory,
  });
  applySessionContext(input.session, input.request, input.action);
  if (title !== null) input.session.summary = { ...input.session.summary, title };
};

export const applySessionContext = (
  session: SessionRecord,
  input: PolicyBoundSessionRef,
  action: string,
): void => {
  assertSessionScope(session, input, action);
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

export const assertSessionScope = (
  session: SessionRecord,
  input: PolicyBoundSessionRef,
  action: string,
  toConflictError?: (message: string) => Error,
): void => {
  const transition = resolveAgentSessionAssociationTransition(
    session.summary.sessionAssociation,
    input.sessionScope ?? { kind: "unbound" },
  );
  if (transition.kind === "conflict") {
    const message = `Cannot ${action} for OpenCode session '${session.externalSessionId}' because its registered ${describeAgentSessionScope(transition.previous)} does not match the requested ${describeAgentSessionScope(transition.incoming)}.`;
    throw toConflictError?.(message) ?? new Error(message);
  }
};

export const assertSessionRef = (
  session: SessionRecord,
  request: {
    repoPath: string;
    runtimeKind: SessionRecord["summary"]["runtimeKind"];
    workingDirectory: string;
    externalSessionId: string;
  },
  action: string,
): void => {
  const registeredSessionRef = opencodeSessionRef(session);
  if (!agentSessionRefsEqual(registeredSessionRef, request)) {
    throw new Error(
      `Cannot ${action} OpenCode session '${request.externalSessionId}' from repo '${request.repoPath}' and working directory '${request.workingDirectory}' because the registered session belongs to repo '${registeredSessionRef.repoPath}' and working directory '${registeredSessionRef.workingDirectory}'.`,
    );
  }
};

/** A title failure must not block attachment; the saved title lets the next attach retry. */
export const setSessionTitle = async (input: {
  client: SessionRecord["client"];
  externalSessionId: string;
  title: string | undefined;
  workingDirectory: string;
}): Promise<string | null> => {
  if (input.title === undefined) {
    return null;
  }
  try {
    const updated = await input.client.session.update({
      directory: input.workingDirectory,
      sessionID: input.externalSessionId,
      title: input.title,
    });
    if (updated.data === undefined || updated.data === null) return null;
    return input.title;
  } catch {
    return null;
  }
};

import type { CodexEffectivePolicy } from "@openducktor/contracts";
import type {
  AcceptedAgentUserMessage,
  AgentEvent,
  AgentModelSelection,
  AgentUserMessagePart,
} from "@openducktor/core";
import type { ActiveCodexTurn } from "./codex-app-server-shared";
import {
  type CodexThreadStatusSnapshot,
  codexThreadStatusSnapshot,
} from "./codex-app-server-threads";
import type { CodexSessionLookup } from "./codex-local-session-state";
import {
  type CodexPolicyLogEntry,
  codexApprovalsReviewer,
  codexPolicyLogEntry,
  codexSandboxPolicy,
} from "./codex-session-policy";
import { toCodexTurnInputList } from "./codex-user-inputs";
import { requireModelSelection, toTransportModelSelection } from "./model-catalog";
import type { CodexAppServerClient, CodexSessionState } from "./types";

export type CodexTurnLifecycleContext = {
  sessions: CodexSessionLookup;
  activeTurnsBySessionId: Map<string, ActiveCodexTurn>;
  clientForRuntime(runtimeId: string): CodexAppServerClient;
  validateModel(
    client: CodexAppServerClient,
    runtimeId: string,
    model: AgentModelSelection,
  ): Promise<void>;
  ensureRuntimeEventSubscription(runtimeId: string): Promise<void>;
  bindActiveTurnId(activeTurn: ActiveCodexTurn, turnId: string, startedAtMs?: number): boolean;
  bindPendingInputToActiveTurn(externalSessionId: string, activeTurn: ActiveCodexTurn): void;
  setSessionLiveStatus(session: CodexSessionState, liveStatus: CodexThreadStatusSnapshot): void;
  emitUserMessage(
    event: AcceptedAgentUserMessage,
    sourceParts: AgentUserMessagePart[],
  ): AcceptedAgentUserMessage;
  emitSessionEvent(externalSessionId: string, event: AgentEvent): void;
  codexPolicyForSession(session: CodexSessionState): CodexEffectivePolicy;
  logSessionPolicy?: (entry: CodexPolicyLogEntry) => void;
};

const sessionIsRetained = (
  context: CodexTurnLifecycleContext,
  session: CodexSessionState,
): boolean => context.sessions.get(session.threadId) === session;

const requireRetainedTurnSession = (
  context: CodexTurnLifecycleContext,
  session: CodexSessionState,
): void => {
  if (!sessionIsRetained(context, session)) {
    throw new Error(
      `Cannot continue Codex turn for session '${session.threadId}' because its retained owner was released or replaced.`,
    );
  }
};

const steerRetainedTurn = async (
  context: CodexTurnLifecycleContext,
  activeTurn: ActiveCodexTurn,
  input: ReturnType<typeof toCodexTurnInputList>,
  turnId: string,
): Promise<void> => {
  requireRetainedTurnSession(context, activeTurn.session);
  try {
    await context.clientForRuntime(activeTurn.session.runtimeId).turnSteer({
      threadId: activeTurn.session.threadId,
      input,
      expectedTurnId: turnId,
    });
  } finally {
    requireRetainedTurnSession(context, activeTurn.session);
  }
};

const flushQueuedUserMessages = async (
  context: CodexTurnLifecycleContext,
  activeTurn: ActiveCodexTurn,
): Promise<void> => {
  if (!activeTurn.turnId) {
    return;
  }
  while (activeTurn.queuedUserMessages.length > 0) {
    const queued = activeTurn.queuedUserMessages.shift();
    if (!queued) {
      continue;
    }
    await steerRetainedTurn(context, activeTurn, queued, activeTurn.turnId);
  }
};

const emitAcceptedUserMessage = (
  context: CodexTurnLifecycleContext,
  acceptedUserMessage: AcceptedAgentUserMessage,
  parts: AgentUserMessagePart[],
): AcceptedAgentUserMessage => {
  return context.emitUserMessage(acceptedUserMessage, parts);
};

export const flushQueuedUserMessagesLater = (
  context: CodexTurnLifecycleContext,
  activeTurn: ActiveCodexTurn,
): void => {
  void flushQueuedUserMessages(context, activeTurn).catch((error) => {
    if (!sessionIsRetained(context, activeTurn.session)) {
      return;
    }
    context.emitSessionEvent(activeTurn.session.threadId, {
      type: "session_error",
      externalSessionId: activeTurn.session.threadId,
      timestamp: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
    });
  });
};

const steerActiveTurn = async (
  context: CodexTurnLifecycleContext,
  activeTurn: ActiveCodexTurn,
  parts: AgentUserMessagePart[],
  acceptedUserMessage: AcceptedAgentUserMessage,
  requireNativeAdmission: boolean,
): Promise<AcceptedAgentUserMessage | null> => {
  const input = toCodexTurnInputList(parts);
  if (activeTurn.isTurnSettled()) {
    return null;
  }
  if (!activeTurn.turnId) {
    if (requireNativeAdmission) {
      if (!activeTurn.turnStartPromise) {
        throw new Error(
          `Codex turn for session '${activeTurn.session.threadId}' has not reached native admission. Retry the message.`,
        );
      }
      await activeTurn.turnStartPromise;
      requireRetainedTurnSession(context, activeTurn.session);
      if (activeTurn.isTurnSettled() || !activeTurn.turnId) {
        throw new Error(
          `Codex turn for session '${activeTurn.session.threadId}' ended before it could accept the message. Retry the message.`,
        );
      }
      await steerRetainedTurn(context, activeTurn, input, activeTurn.turnId);
      return emitAcceptedUserMessage(context, acceptedUserMessage, parts);
    }
    activeTurn.queuedUserMessages.push(input);
    return emitAcceptedUserMessage(context, acceptedUserMessage, parts);
  }
  await steerRetainedTurn(context, activeTurn, input, activeTurn.turnId);
  return emitAcceptedUserMessage(context, acceptedUserMessage, parts);
};

const emitTurnStartErrorLater = (
  context: CodexTurnLifecycleContext,
  session: CodexSessionState,
  turnStartPromise: Promise<unknown>,
): void => {
  void turnStartPromise.catch((error) => {
    if (!sessionIsRetained(context, session)) {
      return;
    }
    context.emitSessionEvent(session.threadId, {
      type: "session_error",
      externalSessionId: session.threadId,
      timestamp: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
    });
  });
};

type CodexTurnStart = {
  readonly acceptedUserMessage: AcceptedAgentUserMessage | null;
  readonly turnStartPromise: ReturnType<CodexAppServerClient["turnStart"]> | null;
};

const runCodexTurn = async (
  context: CodexTurnLifecycleContext,
  externalSessionId: string,
  parts: AgentUserMessagePart[],
  acceptedUserMessage: AcceptedAgentUserMessage | null,
  requestedModel?: AgentModelSelection,
  requireNativeAdmission = false,
): Promise<CodexTurnStart> => {
  const session = context.sessions.get(externalSessionId);
  if (!session) {
    throw new Error(`Unknown Codex session '${externalSessionId}'.`);
  }
  await context.ensureRuntimeEventSubscription(session.runtimeId);
  requireRetainedTurnSession(context, session);
  const input = toCodexTurnInputList(parts);

  const existingActiveTurn = context.activeTurnsBySessionId.get(session.threadId);
  if (existingActiveTurn && !existingActiveTurn.isTurnSettled()) {
    if (!acceptedUserMessage) {
      throw new Error(
        `Codex session '${externalSessionId}' already has an active turn and cannot start a continuation.`,
      );
    }
    const accepted = await steerActiveTurn(
      context,
      existingActiveTurn,
      parts,
      acceptedUserMessage,
      requireNativeAdmission,
    );
    if (accepted) {
      return { acceptedUserMessage: accepted, turnStartPromise: null };
    }

    const latestActiveTurn = context.activeTurnsBySessionId.get(session.threadId);
    if (latestActiveTurn && !latestActiveTurn.isTurnSettled()) {
      throw new Error(
        `Codex session '${externalSessionId}' still has an active turn after steering failed.`,
      );
    }
  }

  const staleActiveTurn = context.activeTurnsBySessionId.get(session.threadId);
  if (staleActiveTurn?.isTurnSettled()) {
    context.activeTurnsBySessionId.delete(session.threadId);
  }

  const model = requireModelSelection(requestedModel ?? session.model);
  let turnSettled = false;
  const handledRequestKeys = new Set<string>();
  const activeTurnState: ActiveCodexTurn = {
    session,
    startedAtMs: Number.POSITIVE_INFINITY,
    turnStartRequestSentAtMs: null,
    turnStartPromise: null,
    isTurnSettled: () => turnSettled,
    markTurnSettled: () => {
      turnSettled = true;
      if (context.activeTurnsBySessionId.get(session.threadId) === activeTurnState) {
        context.activeTurnsBySessionId.delete(session.threadId);
      }
    },
    handledRequestKeys,
    queuedUserMessages: [],
    model,
  };
  context.activeTurnsBySessionId.set(session.threadId, activeTurnState);
  context.setSessionLiveStatus(session, {
    classification: "running",
  });

  const client = context.clientForRuntime(session.runtimeId);
  let policy: CodexEffectivePolicy;
  try {
    policy = context.codexPolicyForSession(session);
  } catch (error) {
    turnSettled = true;
    context.activeTurnsBySessionId.delete(session.threadId);
    throw error;
  }
  try {
    await context.validateModel(client, session.runtimeId, model);
    requireRetainedTurnSession(context, session);
  } catch (error) {
    activeTurnState.markTurnSettled();
    throw error;
  }

  const sandboxPolicy = codexSandboxPolicy(policy, session.workingDirectory);
  context.logSessionPolicy?.(
    codexPolicyLogEntry({
      operation: "turn/start",
      policy,
      runtimeId: session.runtimeId,
      threadId: session.threadId,
      workingDirectory: session.workingDirectory,
    }),
  );

  activeTurnState.turnStartRequestSentAtMs = Date.now();
  const turnStartPromise = client
    .turnStart({
      approvalPolicy: policy.approvalPolicy,
      approvalsReviewer: codexApprovalsReviewer(policy),
      threadId: session.threadId,
      input,
      sandboxPolicy,
      ...toTransportModelSelection(model),
    })
    .then((result) => {
      if (!sessionIsRetained(context, session)) {
        activeTurnState.markTurnSettled();
        return result;
      }
      const turnStartedAtMs = Date.now();
      context.bindActiveTurnId(activeTurnState, result.turn.id, turnStartedAtMs);
      flushQueuedUserMessagesLater(context, activeTurnState);
      if (
        result.turn.status === "completed" ||
        result.turn.status === "failed" ||
        result.turn.status === "interrupted"
      ) {
        const currentActiveTurn = context.activeTurnsBySessionId.get(session.threadId);
        if (!currentActiveTurn || currentActiveTurn === activeTurnState) {
          context.setSessionLiveStatus(session, codexThreadStatusSnapshot("idle"));
        }
        activeTurnState.markTurnSettled();
      }
      return result;
    })
    .catch((error) => {
      activeTurnState.markTurnSettled();
      throw error;
    });
  activeTurnState.turnStartPromise = turnStartPromise;

  if (acceptedUserMessage && !requireNativeAdmission) {
    context.emitUserMessage(acceptedUserMessage, parts);
  }
  return { acceptedUserMessage, turnStartPromise };
};

export const startCodexTurnForSession = async (
  context: CodexTurnLifecycleContext,
  externalSessionId: string,
  parts: AgentUserMessagePart[],
  acceptedUserMessage: AcceptedAgentUserMessage,
  requestedModel?: AgentModelSelection,
  requireNativeAdmission = false,
): Promise<AcceptedAgentUserMessage> => {
  const started = await runCodexTurn(
    context,
    externalSessionId,
    parts,
    acceptedUserMessage,
    requestedModel,
    requireNativeAdmission,
  );
  if (!started.acceptedUserMessage) {
    throw new Error(`Codex session '${externalSessionId}' did not accept the user message.`);
  }
  const session = context.sessions.get(externalSessionId);
  if (session && started.turnStartPromise) {
    if (requireNativeAdmission) {
      try {
        const result = await started.turnStartPromise;
        requireRetainedTurnSession(context, session);
        if (result.turn.status === "failed" || result.turn.status === "interrupted") {
          throw new Error(
            `Codex ended the turn for session '${externalSessionId}' as '${result.turn.status}' before it accepted the message. Retry the message.`,
          );
        }
        return emitAcceptedUserMessage(context, started.acceptedUserMessage, parts);
      } catch (error) {
        if (sessionIsRetained(context, session)) {
          context.setSessionLiveStatus(session, codexThreadStatusSnapshot("idle"));
        }
        throw error;
      }
    }
    emitTurnStartErrorLater(context, session, started.turnStartPromise);
  }
  return started.acceptedUserMessage;
};

/**
 * Starts one native Codex turn with `input: []` so the runtime continues the saved history
 * without creating a user message. It awaits the native turn admission, so a rejected
 * `turn/start` reaches the caller as a typed continuation failure. An admitted turn that
 * already ended as failed or interrupted is also a continuation failure.
 */
export const startCodexContinuationTurn = async (
  context: CodexTurnLifecycleContext,
  externalSessionId: string,
  requestedModel?: AgentModelSelection,
): Promise<void> => {
  const session = context.sessions.get(externalSessionId);
  const started = await runCodexTurn(context, externalSessionId, [], null, requestedModel);
  if (!started.turnStartPromise) {
    throw new Error(
      `Codex session '${externalSessionId}' did not start a native continuation turn.`,
    );
  }
  try {
    const result = await started.turnStartPromise;
    if (result.turn.status === "failed" || result.turn.status === "interrupted") {
      throw new Error(
        `Codex ended the continuation turn for session '${externalSessionId}' as '${result.turn.status}'.`,
      );
    }
  } catch (error) {
    if (session && sessionIsRetained(context, session)) {
      context.setSessionLiveStatus(session, codexThreadStatusSnapshot("idle"));
    }
    throw error;
  }
};

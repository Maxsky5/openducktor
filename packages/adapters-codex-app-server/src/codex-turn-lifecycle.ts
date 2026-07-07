import type { CodexEffectivePolicy } from "@openducktor/contracts";
import type {
  AcceptedAgentUserMessage,
  AgentEvent,
  AgentModelSelection,
  AgentUserMessagePart,
} from "@openducktor/core";
import { extractTurnId, isTerminalTurnStatus } from "./codex-app-server-requests";
import { type ActiveCodexTurn, isPlainObject } from "./codex-app-server-shared";
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
  subscribeEvents: boolean;
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
  handleBufferedRuntimeEvents(
    session: CodexSessionState,
    handledRequestKeys: Set<string>,
  ): Promise<boolean>;
  emitUserMessage(
    event: AcceptedAgentUserMessage,
    sourceParts: AgentUserMessagePart[],
  ): AcceptedAgentUserMessage;
  emitSessionEvent(externalSessionId: string, event: AgentEvent): void;
  codexPolicyForSession(session: CodexSessionState): CodexEffectivePolicy;
  logSessionPolicy?: (entry: CodexPolicyLogEntry) => void;
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
    await context.clientForRuntime(activeTurn.session.runtimeId).turnSteer({
      threadId: activeTurn.session.threadId,
      input: queued,
      expectedTurnId: activeTurn.turnId,
    });
  }
};

const emitAcceptedUserMessage = (
  context: CodexTurnLifecycleContext,
  acceptedUserMessage: AcceptedAgentUserMessage,
  parts: AgentUserMessagePart[],
): AcceptedAgentUserMessage => {
  if (!context.subscribeEvents) {
    return acceptedUserMessage;
  }
  return context.emitUserMessage(acceptedUserMessage, parts);
};

export const flushQueuedUserMessagesLater = (
  context: CodexTurnLifecycleContext,
  activeTurn: ActiveCodexTurn,
): void => {
  void flushQueuedUserMessages(context, activeTurn).catch((error) => {
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
): Promise<AcceptedAgentUserMessage | null> => {
  const input = toCodexTurnInputList(parts);
  if (!activeTurn.turnId && !context.subscribeEvents) {
    await context.handleBufferedRuntimeEvents(activeTurn.session, activeTurn.handledRequestKeys);
  }
  if (activeTurn.isTurnSettled()) {
    return null;
  }
  if (!activeTurn.turnId) {
    activeTurn.queuedUserMessages.push(input);
    return emitAcceptedUserMessage(context, acceptedUserMessage, parts);
  }
  await context.clientForRuntime(activeTurn.session.runtimeId).turnSteer({
    threadId: activeTurn.session.threadId,
    input,
    expectedTurnId: activeTurn.turnId,
  });
  return emitAcceptedUserMessage(context, acceptedUserMessage, parts);
};

const emitTurnStartErrorLater = (
  context: CodexTurnLifecycleContext,
  session: CodexSessionState,
  turnStartPromise: Promise<unknown>,
): void => {
  void turnStartPromise.catch((error) => {
    context.emitSessionEvent(session.threadId, {
      type: "session_error",
      externalSessionId: session.threadId,
      timestamp: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
    });
  });
};

export const startCodexTurnForSession = async (
  context: CodexTurnLifecycleContext,
  externalSessionId: string,
  parts: AgentUserMessagePart[],
  acceptedUserMessage: AcceptedAgentUserMessage,
  requestedModel?: AgentModelSelection,
): Promise<AcceptedAgentUserMessage> => {
  const session = context.sessions.get(externalSessionId);
  if (!session) {
    throw new Error(`Unknown Codex session '${externalSessionId}'.`);
  }
  await context.ensureRuntimeEventSubscription(session.runtimeId);
  const input = toCodexTurnInputList(parts);

  const existingActiveTurn = context.activeTurnsBySessionId.get(session.threadId);
  if (existingActiveTurn && !existingActiveTurn.isTurnSettled()) {
    const accepted = await steerActiveTurn(context, existingActiveTurn, parts, acceptedUserMessage);
    if (accepted) {
      return accepted;
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
    turnStartPromise: Promise.resolve({}),
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
  } catch (error) {
    turnSettled = true;
    context.activeTurnsBySessionId.delete(session.threadId);
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
      model: toTransportModelSelection(model).model,
      effort: toTransportModelSelection(model).effort,
    })
    .then((result) => {
      const turnStartedAtMs = Date.now();
      const turnId = extractTurnId(result);
      if (turnId) {
        context.bindActiveTurnId(activeTurnState, turnId, turnStartedAtMs);
      }
      flushQueuedUserMessagesLater(context, activeTurnState);
      if (isPlainObject(result.turn) && isTerminalTurnStatus(result.turn)) {
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

  if (context.subscribeEvents) {
    context.emitUserMessage(acceptedUserMessage, parts);
    emitTurnStartErrorLater(context, session, turnStartPromise);
    return acceptedUserMessage;
  }

  const hasPendingInput = await context.handleBufferedRuntimeEvents(session, handledRequestKeys);
  if (hasPendingInput && !turnSettled) {
    context.bindPendingInputToActiveTurn(session.threadId, activeTurnState);
    emitTurnStartErrorLater(context, session, turnStartPromise);
    return acceptedUserMessage;
  }

  await turnStartPromise;
  return acceptedUserMessage;
};

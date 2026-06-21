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
  codexWorkspaceWriteSandboxPolicy,
  OPENDUCKTOR_CODEX_APPROVAL_POLICY,
} from "./codex-session-policy";
import { toCodexTurnInputList } from "./codex-user-inputs";
import { requireModelSelection, toTransportModelSelection } from "./model-catalog";
import type { CodexAppServerClient, CodexSessionState } from "./types";

export type CodexTurnLifecycleContext = {
  subscribeEvents: boolean;
  shouldDrainNotifications: boolean;
  sessions: CodexSessionLookup;
  activeTurnsBySessionId: Map<string, ActiveCodexTurn>;
  clientForRuntime(runtimeId: string): CodexAppServerClient;
  validateModel(
    client: CodexAppServerClient,
    runtimeId: string,
    model: AgentModelSelection,
  ): Promise<void>;
  ensureRuntimeEventSubscription(runtimeId: string): void;
  bindActiveTurnId(activeTurn: ActiveCodexTurn, turnId: string): boolean;
  bindPendingInputToActiveTurn(externalSessionId: string, activeTurn: ActiveCodexTurn): void;
  setSessionLiveStatus(session: CodexSessionState, liveStatus: CodexThreadStatusSnapshot): void;
  handlePendingServerRequests(
    session: CodexSessionState,
    handledRequestKeys: Set<string>,
  ): Promise<boolean>;
  emitUserMessage(
    event: AcceptedAgentUserMessage,
    sourceParts: AgentUserMessagePart[],
  ): AcceptedAgentUserMessage;
  emitSessionEvent(externalSessionId: string, event: AgentEvent): void;
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
  if (!context.subscribeEvents && context.shouldDrainNotifications) {
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
    await context.handlePendingServerRequests(activeTurn.session, activeTurn.handledRequestKeys);
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
  context.ensureRuntimeEventSubscription(session.runtimeId);
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
    turnStartPromise: Promise.resolve({}),
    isTurnSettled: () => turnSettled,
    markTurnSettled: () => {
      turnSettled = true;
      context.activeTurnsBySessionId.delete(session.threadId);
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
  try {
    await context.validateModel(client, session.runtimeId, model);
  } catch (error) {
    turnSettled = true;
    context.activeTurnsBySessionId.delete(session.threadId);
    throw error;
  }

  const turnStartPromise = client
    .turnStart({
      approvalPolicy: OPENDUCKTOR_CODEX_APPROVAL_POLICY,
      threadId: session.threadId,
      input,
      sandboxPolicy: codexWorkspaceWriteSandboxPolicy(session.workingDirectory),
      model: toTransportModelSelection(model).model,
      effort: toTransportModelSelection(model).effort,
    })
    .then((result) => {
      const turnId = extractTurnId(result);
      if (turnId) {
        context.bindActiveTurnId(activeTurnState, turnId);
      }
      flushQueuedUserMessagesLater(context, activeTurnState);
      if (!context.subscribeEvents && !context.shouldDrainNotifications) {
        context.emitUserMessage(acceptedUserMessage, parts);
        activeTurnState.markTurnSettled();
      } else if (isPlainObject(result.turn) && isTerminalTurnStatus(result.turn)) {
        context.setSessionLiveStatus(session, codexThreadStatusSnapshot("idle"));
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

  const hasPendingInput = await context.handlePendingServerRequests(session, handledRequestKeys);
  if (hasPendingInput && !turnSettled) {
    context.bindPendingInputToActiveTurn(session.threadId, activeTurnState);
    emitTurnStartErrorLater(context, session, turnStartPromise);
    return acceptedUserMessage;
  }

  await turnStartPromise;
  return acceptedUserMessage;
};

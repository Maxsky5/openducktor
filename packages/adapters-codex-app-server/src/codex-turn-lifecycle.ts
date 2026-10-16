import { codexWorkflowContext } from "./codex-workflow-context";
import type { AgentUserMessageDelivery, CodexEffectivePolicy } from "@openducktor/contracts";
import {
  type AcceptedAgentUserMessage,
  type AgentModelSelection,
  AgentSessionMessageAcceptanceUnknownError,
  AgentSessionMessageRefusedError,
  AgentSessionTurnActiveError,
  type AgentUserMessagePart,
  interruptedTurnResumeError,
} from "@openducktor/core";
import type { ActiveCodexTurn } from "./codex-app-server-shared";
import { CodexMessageAcceptedError } from "./codex-message-accepted-error";
import {
  type CodexThreadStatusSnapshot,
  codexThreadStatusSnapshot,
} from "./codex-app-server-threads";
import type { CodexExpectedEcho } from "./codex-app-server-streaming";
import type { CodexSessionLookup } from "./codex-local-session-state";
import {
  type CodexPolicyLogEntry,
  codexApprovalsReviewer,
  codexPolicyLogEntry,
  codexSandboxPolicy,
} from "./codex-session-policy";
import { toCodexTurnInputList } from "./codex-user-inputs";
import { requireModelSelection, toTransportModelSelection } from "./model-catalog";
import type {
  CodexAppServerClient,
  CodexSessionState,
  CodexTurnStartResult,
  CodexUserInput,
} from "./types";

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
  bindActiveTurnId(activeTurn: ActiveCodexTurn, turnId: string, startedAtMs?: number): void;
  bindPendingInputToActiveTurn(externalSessionId: string, activeTurn: ActiveCodexTurn): void;
  setSessionLiveStatus(session: CodexSessionState, liveStatus: CodexThreadStatusSnapshot): void;
  expectUserMessageEcho(
    event: AcceptedAgentUserMessage,
    input: CodexUserInput[],
  ): CodexExpectedEcho;
  emitUserMessage(event: AcceptedAgentUserMessage): AcceptedAgentUserMessage;
  codexPolicyForSession(session: CodexSessionState): CodexEffectivePolicy;
  logSessionPolicy?: (entry: CodexPolicyLogEntry) => void;
  /**
   * The adapter sets it for one send only. It runs when the `turn/start` or `turn/steer` request
   * that carries the message goes to Codex. If the send fails before this call, Codex did not get
   * the message.
   */
  onSent?: () => void;
  assertCurrent?: (() => void) | undefined;
  systemPrompt?: string | undefined;
};

/** Starts a turn for a user message, or steers the running turn, and publishes the message. */
export const sendCodexUserMessage = async (
  context: CodexTurnLifecycleContext,
  externalSessionId: string,
  parts: AgentUserMessagePart[],
  acceptedUserMessage: AcceptedAgentUserMessage,
  delivery: AgentUserMessageDelivery,
  requestedModel?: AgentModelSelection,
  resolvedQuestionRequestIds?: readonly string[],
): Promise<AcceptedAgentUserMessage> => {
  const admitted = await admitCodexMessage(context, {
    externalSessionId,
    input: toCodexTurnInputList(parts, resolvedQuestionRequestIds),
    message: acceptedUserMessage,
    delivery,
    requestedModel,
    echoProvesAcceptance: true,
  });
  requireAdmittedOwner(context, admitted);
  const published = context.emitUserMessage(admitted.message);
  if (admitted.endedTurn) throw new CodexMessageAcceptedError(published, admitted.endedTurn);
  return published;
};

/**
 * Sends a question reply, which joins the running work. The question tool shows the answer, so
 * this never publishes a user message, and its echo stays hidden.
 */
export const sendCodexQuestionReply = async (
  context: CodexTurnLifecycleContext,
  externalSessionId: string,
  input: CodexUserInput[],
  acceptedUserMessage: AcceptedAgentUserMessage,
  requestedModel?: AgentModelSelection,
): Promise<AcceptedAgentUserMessage> => {
  const admitted = await admitCodexMessage(context, {
    externalSessionId,
    input,
    message: acceptedUserMessage,
    delivery: runningTurnOf(context.activeTurnsBySessionId, externalSessionId)
      ? "steer"
      : "new_turn",
    requestedModel,
    echoProvesAcceptance: false,
  });
  requireAdmittedOwner(context, admitted);
  if (admitted.endedTurn) throw new CodexMessageAcceptedError(admitted.message, admitted.endedTurn);
  return admitted.message;
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
  const session = await requireTurnSession(context, externalSessionId);
  if (runningTurnOf(context.activeTurnsBySessionId, session.threadId)) {
    throw new Error(
      `Codex session '${externalSessionId}' already has an active turn and cannot start a continuation.`,
    );
  }
  const { turnStartPromise } = await startNewTurn(
    context,
    session,
    [],
    null,
    requestedModel,
    false,
  );
  // The `turn/start` answer already settled a turn that ended at once and left the session idle.
  const { status } = (await turnStartPromise).turn;
  if (status === "failed" || status === "interrupted") {
    throw interruptedTurnResumeError({
      reason: "continuation_failed",
      nativeOutcome: "accepted",
      message: `Codex ended the continuation turn for session '${externalSessionId}' as '${status}'.`,
    });
  }
};

type CodexMessageRequest = {
  readonly externalSessionId: string;
  readonly input: CodexUserInput[];
  readonly message: AcceptedAgentUserMessage;
  readonly delivery: AgentUserMessageDelivery;
  readonly requestedModel?: AgentModelSelection | undefined;
  readonly echoProvesAcceptance: boolean;
};

type AdmittedCodexMessage = {
  readonly session: CodexSessionState;
  /** The message that Codex took. A steer reports the model of the running turn. */
  readonly message: AcceptedAgentUserMessage;
  readonly echo: CodexExpectedEcho;
  /** Codex admitted the input, but ended its turn at once as failed or interrupted. */
  readonly endedTurn: Error | null;
};

/**
 * Sends a message and returns after Codex admits it, so a refused request never counts as
 * delivered. The issued request decides the outcome, even when its owner goes away meanwhile.
 * A new turn while a turn runs fails with `AgentSessionTurnActiveError`, so the caller can queue
 * the message.
 */
const admitCodexMessage = async (
  context: CodexTurnLifecycleContext,
  request: CodexMessageRequest,
): Promise<AdmittedCodexMessage> => {
  const { externalSessionId, input, message, delivery, requestedModel, echoProvesAcceptance } =
    request;
  const session = await requireTurnSession(context, externalSessionId);
  const runningTurn = runningTurnOf(context.activeTurnsBySessionId, session.threadId);
  if (runningTurn) {
    if (delivery === "new_turn") {
      throw new AgentSessionTurnActiveError(externalSessionId);
    }
    return steerRunningTurn(context, session, runningTurn, input, message, echoProvesAcceptance);
  }
  if (delivery === "steer")
    throw new AgentSessionMessageRefusedError(
      new Error(
        "The running turn ended before steering. Send a new turn with current host context.",
      ),
    );
  const { turnStartPromise, echo } = await startNewTurn(
    context,
    session,
    input,
    message,
    requestedModel,
    echoProvesAcceptance,
  );
  let answer: CodexTurnStartResult;
  try {
    answer = await turnStartPromise;
  } catch (cause) {
    throwUnlessEchoAccepted(cause, message, echo, echoProvesAcceptance);
    return { session, message, echo, endedTurn: null };
  }
  return { session, message, echo, endedTurn: endedTurnError(answer, externalSessionId) };
};

/** Finds the retained session, and makes sure that its runtime events reach this adapter. */
const requireTurnSession = async (
  context: CodexTurnLifecycleContext,
  externalSessionId: string,
): Promise<CodexSessionState> => {
  const session = context.sessions.get(externalSessionId);
  if (!session) {
    throw new Error(`Unknown Codex session '${externalSessionId}'.`);
  }
  await context.ensureRuntimeEventSubscription(session.runtimeId);
  requireRetainedTurnSession(context, session);
  return session;
};

/** Returns the turn that still runs in the thread. */
export const runningTurnOf = (
  activeTurnsBySessionId: ReadonlyMap<string, ActiveCodexTurn>,
  threadId: string,
): ActiveCodexTurn | null => {
  const turn = activeTurnsBySessionId.get(threadId);
  return turn && !turn.isTurnSettled() ? turn : null;
};

/**
 * Steers the running turn after Codex starts it. A steered message joins that turn, so it
 * reports the model of the turn.
 */
const steerRunningTurn = async (
  context: CodexTurnLifecycleContext,
  session: CodexSessionState,
  runningTurn: ActiveCodexTurn,
  input: CodexUserInput[],
  message: AcceptedAgentUserMessage,
  echoProvesAcceptance: boolean,
): Promise<AdmittedCodexMessage> => {
  const steeredMessage = { ...message, model: runningTurn.model };
  const echo = context.expectUserMessageEcho(steeredMessage, input);
  let turnId: string;
  try {
    turnId = await requireStartedTurnId(context, runningTurn);
  } catch (error) {
    echo.cancel();
    throw error;
  }
  requireRetainedTurnSession(context, runningTurn.session);
  try {
    context.assertCurrent?.();
    const steered = context.clientForRuntime(runningTurn.session.runtimeId).turnSteer({
      threadId: runningTurn.session.threadId,
      input,
      expectedTurnId: turnId,
    });
    context.onSent?.();
    await steered;
  } catch (cause) {
    throwUnlessEchoAccepted(cause, steeredMessage, echo, echoProvesAcceptance);
  }
  return { session, message: steeredMessage, echo, endedTurn: null };
};

/**
 * Sends `turn/start` for a new turn. Failures before the request settle the turn and leave the
 * session idle. After the request, the native answer or a rejection settles it.
 */
const startNewTurn = async (
  context: CodexTurnLifecycleContext,
  session: CodexSessionState,
  input: CodexUserInput[],
  acceptedUserMessage: AcceptedAgentUserMessage | null,
  requestedModel: AgentModelSelection | undefined,
  echoProvesAcceptance: boolean,
): Promise<{
  readonly turnStartPromise: Promise<CodexTurnStartResult>;
  readonly echo: CodexExpectedEcho;
}> => {
  const model = requireModelSelection(requestedModel ?? session.model);
  const turn = registerActiveTurn(context, session, model);
  const client = context.clientForRuntime(session.runtimeId);
  let policy: CodexEffectivePolicy;
  try {
    policy = context.codexPolicyForSession(session);
    await context.validateModel(client, session.runtimeId, model);
    requireRetainedTurnSession(context, session);
  } catch (error) {
    turn.markTurnSettled();
    markSessionIdle(context, session);
    throw new AgentSessionMessageRefusedError(
      error instanceof Error ? error : new Error(String(error)),
    );
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

  const echo = acceptedUserMessage
    ? context.expectUserMessageEcho(acceptedUserMessage, input)
    : NO_EXPECTED_ECHO;
  turn.turnStartRequestSentAtMs = Date.now();
  const turnInput: Parameters<typeof client.turnStart>[0] = {
    threadId: session.threadId,
    input,
    ...toTransportModelSelection(model),
  };
  if (context.systemPrompt)
    turnInput.additionalContext = codexWorkflowContext(context.systemPrompt);
  if (!session.preserveNativeSettings) {
    turnInput.approvalPolicy = policy.approvalPolicy;
    turnInput.approvalsReviewer = codexApprovalsReviewer(policy);
    turnInput.sandboxPolicy = sandboxPolicy;
  }
  context.assertCurrent?.();
  const turnStartPromise = client
    .turnStart(turnInput)
    .then((result) => {
      if (!sessionIsRetained(context, session)) {
        turn.markTurnSettled();
        return result;
      }
      context.bindActiveTurnId(turn, result.turn.id, Date.now());
      if (
        result.turn.status === "completed" ||
        result.turn.status === "failed" ||
        result.turn.status === "interrupted"
      ) {
        const currentActiveTurn = context.activeTurnsBySessionId.get(session.threadId);
        if (!currentActiveTurn || currentActiveTurn === turn) {
          markSessionIdle(context, session);
        }
        turn.markTurnSettled();
      }
      return result;
    })
    .catch((error) => {
      if (isRejectedTurnRequest(error, echo, echoProvesAcceptance)) {
        turn.markTurnSettled();
        markSessionIdle(context, session);
      }
      throw error;
    });
  turn.turnStartPromise = turnStartPromise;
  context.onSent?.();
  return { turnStartPromise, echo };
};

/** Codex admitted the input, but ended its turn at once as failed or interrupted. */
const endedTurnError = (answer: CodexTurnStartResult, externalSessionId: string): Error | null => {
  const { status, error } = answer.turn;
  if (status !== "failed" && status !== "interrupted") return null;
  return new Error(
    error?.message ??
      `Codex ended the admitted turn for session '${externalSessionId}' as '${status}'.`,
  );
};

/** If the owner is gone, keep the accepted result but do not show the message in the new session. */
const requireAdmittedOwner = (
  context: CodexTurnLifecycleContext,
  { session, message, echo }: AdmittedCodexMessage,
): void => {
  if (sessionIsRetained(context, session)) return;
  echo.cancel();
  throw new CodexMessageAcceptedError(
    message,
    new Error(
      `Codex accepted the message, but the retained owner of session '${session.threadId}' was released or replaced.`,
    ),
  );
};

/**
 * The turn stays registered until a native outcome, a rejected request, or a failure before the
 * request settles it.
 */
const registerActiveTurn = (
  context: CodexTurnLifecycleContext,
  session: CodexSessionState,
  model: AgentModelSelection,
): ActiveCodexTurn => {
  let settled = false;
  const turn: ActiveCodexTurn = {
    session,
    startedAtMs: Number.POSITIVE_INFINITY,
    turnStartRequestSentAtMs: null,
    turnStartPromise: null,
    isTurnSettled: () => settled,
    markTurnSettled: () => {
      settled = true;
      if (context.activeTurnsBySessionId.get(session.threadId) === turn) {
        context.activeTurnsBySessionId.delete(session.threadId);
      }
    },
    handledRequestKeys: new Set<string>(),
    model,
  };
  context.activeTurnsBySessionId.set(session.threadId, turn);
  context.setSessionLiveStatus(session, { classification: "running" });
  return turn;
};

const requireStartedTurnId = async (
  context: CodexTurnLifecycleContext,
  activeTurn: ActiveCodexTurn,
): Promise<string> => {
  if (activeTurn.turnId) return activeTurn.turnId;
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
  return activeTurn.turnId;
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

const markSessionIdle = (context: CodexTurnLifecycleContext, session: CodexSessionState): void => {
  if (sessionIsRetained(context, session)) {
    context.setSessionLiveStatus(session, codexThreadStatusSnapshot("idle"));
  }
};

const NO_EXPECTED_ECHO: CodexExpectedEcho = {
  cancel: () => undefined,
  publishWhenEchoed: () => undefined,
  wasEchoed: () => false,
};

/**
 * For a user message, an echo proves acceptance. A question reply counts only when Codex answers
 * its request, so its echo proves nothing.
 */
const echoAccepted = (echo: CodexExpectedEcho, echoProvesAcceptance: boolean): boolean =>
  echoProvesAcceptance && echo.wasEchoed();

/**
 * Only a JSON-RPC error answer proves that Codex runs no turn for the request, unless an echo
 * already proved acceptance. After any other failure, Codex can still run the turn, so its native
 * outcome or an owner release settles it later.
 */
const isRejectedTurnRequest = (
  cause: unknown,
  echo: CodexExpectedEcho,
  echoProvesAcceptance: boolean,
): boolean =>
  !echoAccepted(echo, echoProvesAcceptance) && cause instanceof AgentSessionMessageRefusedError;

/**
 * Returns only when an echo proved acceptance despite the failed request. A rejected request,
 * or any failure of a message whose echo proves nothing, throws its cause. Any other failure is
 * not conclusive, so the expected echo stays: a later echo publishes the message under its
 * accepted ID.
 */
const throwUnlessEchoAccepted = (
  cause: unknown,
  acceptedUserMessage: AcceptedAgentUserMessage,
  echo: CodexExpectedEcho,
  echoProvesAcceptance: boolean,
): void => {
  if (echoAccepted(echo, echoProvesAcceptance)) return;
  if (cause instanceof AgentSessionMessageRefusedError || !echoProvesAcceptance) {
    echo.cancel();
    throw cause;
  }
  echo.publishWhenEchoed();
  throw new AgentSessionMessageAcceptanceUnknownError({
    externalSessionId: acceptedUserMessage.externalSessionId,
    messageId: acceptedUserMessage.messageId,
    cause,
  });
};

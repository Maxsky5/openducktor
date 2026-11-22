import { methods, type PromptResponse, RequestError } from "@agentclientprotocol/sdk/unstable";
import type { AgentSessionTranscriptEvent, AgentTurnOutcome } from "@openducktor/contracts";
import {
  type AcceptedAgentUserMessage,
  type AgentEvent,
  type AgentModelSelection,
  AgentSessionMessageAcceptanceUnknownError,
  AgentSessionMessageRefusedError,
  AgentSessionTurnActiveError,
  type AgentUserMessagePart,
} from "@openducktor/core";
import {
  type AntigravityLiveSession,
  type AntigravityPromptRecord,
  type AntigravitySessionHost,
  type AntigravityTurn,
  publishInBackground,
  toTranscriptEvents,
} from "./antigravity-live-session";
import { describeAntigravityRequestError } from "./antigravity-native-contract";
import { encodeAntigravityPrompt, toAntigravityUserMessage } from "./antigravity-prompt";

export type AntigravitySendInput = {
  readonly parts: AgentUserMessagePart[];
  readonly delivery: "new_turn" | "steer";
  readonly submissionId?: string | undefined;
  readonly resolvedQuestionRequestIds?: readonly string[] | undefined;
  readonly workStartGuard?: { assertCurrent(): void } | undefined;
  readonly onWorkIssued?: (() => void) | undefined;
  readonly onWorkAccepted?: (() => void) | undefined;
};

const toError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

const REFUSED_TURN_MESSAGE = "Antigravity refused to continue this turn.";

const turnOutcomeFor = (response: PromptResponse): AgentTurnOutcome => {
  switch (response.stopReason) {
    case "cancelled":
      return "interrupted";
    case "refusal":
      return "failed";
    default:
      return "completed";
  }
};

/**
 * The pending row of a sent message. It is live display only, so history does not list it and a
 * stale history read cannot restore it after a retraction.
 */
const toPendingUserMessage = (
  session: AntigravityLiveSession,
  messageId: string,
  message: ReturnType<typeof toAntigravityUserMessage>,
  model: AgentModelSelection | undefined,
  timestamp: string,
) => {
  const event: Extract<AgentEvent, { type: "user_message" }> = {
    type: "user_message",
    externalSessionId: session.ref.externalSessionId,
    timestamp,
    messageId,
    message: message.text,
    parts: message.displayParts,
    state: "pending",
  };
  if (model) event.model = model;
  return event;
};

const admitPrompt = (record: AntigravityPromptRecord): void => {
  if (record.accepted) return;
  record.accepted = true;
  record.accept();
};

/**
 * Admits the oldest open prompt of the turn at turn content or a runtime request. Content that
 * arrives while an earlier prompt is still open belongs to that prompt, so it admits no steer.
 */
export const acceptAntigravityTurnStart = (session: AntigravityLiveSession): void => {
  const oldestOpen = session.turn?.prompts.find((record) => !record.answered);
  if (oldestOpen) admitPrompt(oldestOpen);
};

/** Closes the pending approvals and questions of a session without a user reply. */
const cancelAntigravityPendingInput = (session: AntigravityLiveSession): void => {
  for (const pending of session.pendingApprovals.values()) {
    pending.resolve({ outcome: { outcome: "cancelled" } });
  }
  session.pendingApprovals.clear();
  for (const pending of session.pendingQuestions.values()) {
    pending.resolve({ action: "cancel" });
  }
  session.pendingQuestions.clear();
};

const settleEndWaiters = (turn: AntigravityTurn): void => {
  for (const resolve of turn.endWaiters.splice(0)) resolve();
};

const endTurn = (
  host: AntigravitySessionHost,
  session: AntigravityLiveSession,
  outcome: AgentTurnOutcome,
  errorMessage?: string,
): void => {
  const turn = session.turn;
  if (!turn) return;
  session.turn = null;
  cancelAntigravityPendingInput(session);
  const timestamp = host.now();
  const events = session.transcript.finishTurn(outcome, session.model, turn.startedAt);
  if (errorMessage) {
    events.push({
      type: "turn_error",
      externalSessionId: session.ref.externalSessionId,
      timestamp,
      message: errorMessage,
    });
  }
  const idle: Extract<AgentEvent, { type: "session_idle" }> = {
    type: "session_idle",
    externalSessionId: session.ref.externalSessionId,
    timestamp,
    turnOutcome: outcome,
  };
  // A turn that Stop ended gets the stop notice in the live view and in history alike.
  if (outcome === "interrupted" && turn.stopRequested) {
    idle.interruption = session.transcript.addStopNotice(timestamp);
  }
  events.push(idle);
  publishInBackground(host, session, events);
  settleEndWaiters(turn);
};

/**
 * The answer of a prompt admits that prompt only. The answer of an earlier prompt does not admit a
 * steer: the earlier turn can end on its own, and the runtime can still refuse the steer.
 */
const onPromptResponse = (
  host: AntigravitySessionHost,
  session: AntigravityLiveSession,
  turn: AntigravityTurn,
  record: AntigravityPromptRecord,
  response: PromptResponse,
): void => {
  record.answered = true;
  admitPrompt(record);
  const outcome = turnOutcomeFor(response);
  turn.lastSettlement = {
    outcome,
    errorMessage: outcome === "failed" ? REFUSED_TURN_MESSAGE : undefined,
  };
  turn.openPrompts -= 1;
  if (turn.openPrompts > 0 || session.turn !== turn) return;
  endTurn(host, session, outcome, turn.lastSettlement.errorMessage);
};

/**
 * A refused message never entered the transcript, so the host queue keeps it. When it was the last
 * open prompt, the turn ends: with the outcome and reason of the last earlier answer, also a
 * failure, or with no outcome when no prompt of the turn was answered.
 */
const refusePrompt = (
  host: AntigravitySessionHost,
  session: AntigravityLiveSession,
  turn: AntigravityTurn,
  record: AntigravityPromptRecord,
  cause: unknown,
): void => {
  turn.prompts.splice(turn.prompts.indexOf(record), 1);
  record.reject(
    new AgentSessionMessageRefusedError(new Error(describeAntigravityRequestError(cause))),
  );
  const retraction = retractPendingMessage(host, session, record);
  if (turn.openPrompts > 0 || session.turn !== turn) {
    publishInBackground(host, session, [retraction]);
    return;
  }
  if (turn.lastSettlement) {
    publishInBackground(host, session, [retraction]);
    endTurn(host, session, turn.lastSettlement.outcome, turn.lastSettlement.errorMessage);
    return;
  }
  // No prompt of the turn was admitted, so no turn ran: the snapshot returns to idle, and no idle
  // event saves activity.
  session.turn = null;
  publishInBackground(host, session, [retraction]);
  settleEndWaiters(turn);
};

/** Removes the pending row of a message from the live view. Its ID never entered the transcript. */
const retractPendingMessage = (
  host: AntigravitySessionHost,
  session: AntigravityLiveSession,
  record: AntigravityPromptRecord,
): AgentEvent => ({
  type: "transcript_retracted",
  externalSessionId: session.ref.externalSessionId,
  timestamp: host.now(),
  messageIds: [record.pendingMessageId],
});

const onPromptError = (
  host: AntigravitySessionHost,
  session: AntigravityLiveSession,
  turn: AntigravityTurn,
  record: AntigravityPromptRecord,
  cause: unknown,
): void => {
  record.answered = true;
  turn.openPrompts -= 1;
  if (!record.accepted) {
    // Only an error answer of the runtime proves that it refused the message.
    if (cause instanceof RequestError && !host.transportClosed()) {
      record.accepted = true;
      refusePrompt(host, session, turn, record, cause);
      return;
    }
    // The pending row stays, so the live view and history show the unknown delivery alike.
    record.accepted = true;
    record.reject(
      new AgentSessionMessageAcceptanceUnknownError({
        externalSessionId: session.ref.externalSessionId,
        messageId: record.pendingMessageId,
        cause,
      }),
    );
  }
  // A later refused steer ends the turn with this failure, so it keeps the reason.
  turn.lastSettlement = { outcome: "failed", errorMessage: describeAntigravityRequestError(cause) };
  if (turn.openPrompts > 0 || session.turn !== turn) return;
  endTurn(host, session, "failed", turn.lastSettlement.errorMessage);
};

/**
 * Sends one message. A new turn fails while a turn runs, and a steer joins the running turn as a
 * second `session/prompt`. The message shows at once as a `pending` row, which no reader treats as
 * accepted. It enters the transcript and counts as accepted at turn content or a runtime request
 * while it is the oldest open prompt, or at its own prompt answer.
 */
export const sendAntigravityUserMessage = async (
  host: AntigravitySessionHost,
  session: AntigravityLiveSession,
  input: AntigravitySendInput,
): Promise<AcceptedAgentUserMessage> => {
  const sessionId = session.ref.externalSessionId;
  if (input.delivery === "new_turn" && session.turn) {
    throw new AgentSessionTurnActiveError(sessionId);
  }
  if (session.modelMismatch) {
    throw new AgentSessionMessageRefusedError(new Error(session.modelMismatch));
  }
  if (input.delivery === "steer" && !session.turn) {
    throw new AgentSessionMessageRefusedError(
      new Error(
        "No Antigravity turn runs, so the message cannot join it. Send it as a new message.",
      ),
    );
  }
  let prompt: ReturnType<typeof encodeAntigravityPrompt>;
  try {
    prompt = encodeAntigravityPrompt(input.parts, session.ref.workingDirectory);
  } catch (cause) {
    throw new AgentSessionMessageRefusedError(toError(cause));
  }
  const agent = host.agent();
  input.workStartGuard?.assertCurrent();
  const sentAt = host.now();
  const turn: AntigravityTurn = session.turn ?? {
    openPrompts: 0,
    prompts: [],
    endWaiters: [],
    lastSettlement: null,
    busyPublished: false,
    stopRequested: false,
    startedAt: sentAt,
  };
  session.turn = turn;
  const acceptance = Promise.withResolvers<AcceptedAgentUserMessage>();
  const message = toAntigravityUserMessage(input.parts);
  const model = session.model;
  // The row takes the ID that admission will most likely give, so the read message replaces it.
  const unadmittedAhead = turn.prompts.filter((entry) => !entry.accepted).length;
  const pendingMessageId = session.transcript.nextUserMessageId(unadmittedAhead);
  const pending = toPendingUserMessage(session, pendingMessageId, message, model, sentAt);
  const record: AntigravityPromptRecord = {
    pendingMessageId,
    accepted: false,
    answered: false,
    accept: () => {
      // The message keeps the time when the user sent it, so its row does not move.
      const { closedItems, userMessage } = session.transcript.addLiveUserMessage({
        message,
        model,
        sentAt: pending.timestamp,
      });
      if (input.submissionId) userMessage.submissionId = input.submissionId;
      if (input.resolvedQuestionRequestIds?.length) {
        userMessage.resolvedQuestionRequestIds = [...input.resolvedQuestionRequestIds];
      }
      const events: AgentEvent[] = [];
      if (!turn.busyPublished) {
        turn.busyPublished = true;
        events.push({
          type: "session_status",
          externalSessionId: sessionId,
          timestamp: userMessage.timestamp,
          status: { type: "busy", message: null },
        });
      }
      if (userMessage.messageId !== pendingMessageId) {
        events.push(retractPendingMessage(host, session, record));
      }
      publishInBackground(host, session, [...events, ...closedItems, userMessage]);
      acceptance.resolve(userMessage);
    },
    reject: acceptance.reject,
  };
  turn.prompts.push(record);
  turn.openPrompts += 1;
  // The snapshot shows the running turn at once. The busy status waits for admission.
  publishInBackground(host, session, [pending]);
  input.onWorkIssued?.();
  agent.request(methods.agent.session.prompt, { sessionId, prompt }).then(
    (response) => onPromptResponse(host, session, turn, record, response),
    (cause: unknown) => onPromptError(host, session, turn, record, cause),
  );
  const userMessage = await acceptance.promise;
  input.onWorkAccepted?.();
  return userMessage;
};

/**
 * Stops the turn of one session with `session/cancel`, closes its pending input, and waits for the
 * runtime to end the turn. The host has no time limit, so this function owns the deadline.
 */
export const stopAntigravityTurn = async (
  host: AntigravitySessionHost,
  session: AntigravityLiveSession,
  deadlineMs: number,
): Promise<void> => {
  const turn = session.turn;
  if (!turn) return;
  const agent = host.agent();
  const ended = new Promise<void>((resolve) => turn.endWaiters.push(resolve));
  turn.stopRequested = true;
  await host.request(() =>
    agent.notify(methods.agent.session.cancel, { sessionId: session.ref.externalSessionId }),
  );
  cancelAntigravityPendingInput(session);
  publishInBackground(host, session, []);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), deadlineMs);
  });
  try {
    if ((await Promise.race([ended, timedOut])) === "timeout") {
      throw new Error(
        `Antigravity did not stop the turn within ${deadlineMs / 1000} seconds. The session keeps running. Try Stop again.`,
      );
    }
  } finally {
    clearTimeout(timer);
  }
};

/** Drops the turn of a session that leaves the runtime. Its unadmitted messages have no answer. */
export const closeAntigravityTurn = (session: AntigravityLiveSession, reason: string): void => {
  cancelAntigravityPendingInput(session);
  const turn = session.turn;
  session.turn = null;
  if (!turn) return;
  for (const record of turn.prompts) {
    if (record.accepted) continue;
    record.accepted = true;
    record.reject(
      new AgentSessionMessageAcceptanceUnknownError({
        externalSessionId: session.ref.externalSessionId,
        messageId: record.pendingMessageId,
        cause: new Error(reason),
      }),
    );
  }
  settleEndWaiters(turn);
};

/** The terminal events of a turn that the runtime stopped running. */
export const settleAntigravityTurn = (
  session: AntigravityLiveSession,
  reason: string,
  timestamp: string,
): AgentSessionTranscriptEvent[] => {
  if (!session.turn) return [];
  const closing: AgentEvent[] = [
    ...session.transcript.finishTurn("failed"),
    {
      type: "turn_error",
      externalSessionId: session.ref.externalSessionId,
      timestamp,
      message: reason,
    },
    {
      type: "session_idle",
      externalSessionId: session.ref.externalSessionId,
      timestamp,
      turnOutcome: "failed",
    },
  ];
  return toTranscriptEvents(session.ref, closing);
};

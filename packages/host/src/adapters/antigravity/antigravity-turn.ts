import { methods, type PromptResponse, RequestError } from "@agentclientprotocol/sdk/unstable";
import type {
  AgentSessionLiveRef,
  AgentSessionTranscriptEvent,
  AgentTurnOutcome,
} from "@openducktor/contracts";
import { isManualSessionCompactionSlashCommand } from "@openducktor/contracts";
import {
  type AcceptedAgentUserMessage,
  type AgentEvent,
  AgentSessionMessageAcceptanceUnknownError,
  AgentSessionMessageRefusedError,
  AgentSessionTurnActiveError,
  type AgentUserMessagePart,
} from "@openducktor/core";
import type { AntigravityAgentConnection } from "./antigravity-agent-connection";
import { toTranscriptEvents } from "./antigravity-live-change";
import { describeAntigravityRequestError } from "./antigravity-native-contract";
import { encodeAntigravityPrompt, toAntigravityUserMessage } from "./antigravity-prompt";
import type { AntigravitySessionModel } from "./antigravity-session-model";
import { ANTIGRAVITY_COMPACTED_MESSAGE } from "./antigravity-compaction";
import type { AntigravityTranscript } from "./antigravity-transcript";

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

/**
 * One `session/prompt` that carries one user message. The message enters the transcript only when
 * the runtime admits it, so a refused message changes no transcript state.
 */
type AntigravityPromptRecord = {
  /** The ID that the message most likely gets, and of its pending row when it has one. */
  readonly pendingMessageId: string;
  /** True when a pending row shows the message until the runtime admits it. */
  readonly showsPending: boolean;
  accepted: boolean;
  /** True once the runtime answered this `session/prompt`. */
  answered: boolean;
  readonly accept: () => void;
  readonly reject: (cause: Error) => void;
};

/** The outcome of one prompt answer, with the reason of a failed one. */
type AntigravityTurnSettlement = {
  readonly outcome: AgentTurnOutcome;
  readonly errorMessage: string | undefined;
};

/** The open prompts of the running turn of a session. A steer adds a second prompt. */
type AntigravityTurn = {
  openPrompts: number;
  readonly prompts: AntigravityPromptRecord[];
  readonly endWaiters: Array<() => void>;
  /**
   * How the last answered prompt of the turn ended, a response or an error after admission. It
   * ends the turn when a later steer is refused.
   */
  lastSettlement: AntigravityTurnSettlement | null;
  /**
   * True once the turn published its busy status. The status waits for the first admission, so
   * a refused prompt saves no session activity.
   */
  busyPublished: boolean;
  /** True once Stop sent `session/cancel` for this turn. */
  stopRequested: boolean;
  /** When the user sent the message that started the turn. History counts the work from it. */
  readonly startedAt: string;
  /**
   * The `/compact` message of a compaction turn. Its row shows the compaction, and a turn that does
   * not complete shows the message again.
   */
  compaction: Extract<AgentEvent, { type: "user_message" }> | null;
};

const ANTIGRAVITY_COMPACTION_STARTED_MESSAGE = "Session compaction started.";

/** True for a message that is only the OpenDucktor session compaction command. */
const isManualCompaction = (parts: AgentUserMessagePart[]): boolean =>
  parts.length === 1 &&
  parts[0]?.kind === "slash_command" &&
  isManualSessionCompactionSlashCommand(parts[0].command);

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

const admitPrompt = (record: AntigravityPromptRecord): void => {
  if (record.accepted) return;
  record.accepted = true;
  record.accept();
};

const settleEndWaiters = (turn: AntigravityTurn): void => {
  for (const resolve of turn.endWaiters.splice(0)) resolve();
};

/** What the turns of a session use. The session owns each value. */
type AntigravityTurnContext = {
  readonly ref: AgentSessionLiveRef;
  readonly connection: AntigravityAgentConnection;
  readonly transcript: AntigravityTranscript;
  readonly model: AntigravitySessionModel;
  /** Publishes the session state with these events, without waiting. */
  readonly publish: (events: AgentEvent[]) => void;
  /** Closes the pending approvals and questions of the session without a user reply. */
  readonly cancelPendingInput: () => void;
};

/**
 * The running turn of one session: its open `session/prompt` requests, steers included, and how
 * each one ends. A message counts as accepted only when the runtime admits it.
 */
export class AntigravityTurns {
  private turn: AntigravityTurn | null = null;

  constructor(private readonly context: AntigravityTurnContext) {}

  /** True when the session has an open prompt. ACP has no status read. */
  get running(): boolean {
    return this.turn !== null;
  }

  /**
   * Sends one message. A new turn fails while a turn runs, and a steer joins the running turn as a
   * second `session/prompt`. A message that starts a turn counts as accepted when its prompt is
   * sent: nothing runs ahead of it, and a failed prompt ends the turn with its error. A steer shows
   * at once as a `pending` row, which no reader treats as accepted. It enters the transcript and
   * counts as accepted at turn content or a runtime request while it is the oldest open prompt, or
   * at its own prompt answer.
   */
  async send(input: AntigravitySendInput): Promise<AcceptedAgentUserMessage> {
    const sessionId = this.context.ref.externalSessionId;
    if (input.delivery === "new_turn" && this.turn)
      throw new AgentSessionTurnActiveError(sessionId);
    if (this.context.model.refusal) {
      throw new AgentSessionMessageRefusedError(new Error(this.context.model.refusal));
    }
    if (input.delivery === "steer" && !this.turn) {
      throw new AgentSessionMessageRefusedError(
        new Error(
          "No Antigravity turn runs, so the message cannot join it. Send it as a new message.",
        ),
      );
    }
    let prompt: ReturnType<typeof encodeAntigravityPrompt>;
    try {
      prompt = encodeAntigravityPrompt(input.parts, this.context.ref.workingDirectory);
    } catch (cause) {
      throw new AgentSessionMessageRefusedError(toError(cause));
    }
    const agent = this.context.connection.agent();
    input.workStartGuard?.assertCurrent();
    const sentAt = this.context.connection.now();
    const startsTurn = this.turn === null;
    const turn: AntigravityTurn = this.turn ?? {
      openPrompts: 0,
      prompts: [],
      endWaiters: [],
      lastSettlement: null,
      busyPublished: false,
      stopRequested: false,
      startedAt: sentAt,
      compaction: null,
    };
    this.turn = turn;
    const acceptance = Promise.withResolvers<AcceptedAgentUserMessage>();
    const message = toAntigravityUserMessage(input.parts);
    const model = this.context.model.selection;
    // The row takes the ID that admission will most likely give, so the read message replaces it.
    const unadmittedAhead = turn.prompts.filter((entry) => !entry.accepted).length;
    const pendingMessageId = this.context.transcript.nextUserMessageId(unadmittedAhead);
    // The pending row is live display only, so history does not list it and a stale history read
    // cannot restore it after a retraction.
    const pending: Extract<AgentEvent, { type: "user_message" }> = {
      type: "user_message",
      externalSessionId: sessionId,
      timestamp: sentAt,
      messageId: pendingMessageId,
      message: message.text,
      parts: message.displayParts,
      state: "pending",
    };
    if (model) pending.model = model;
    const record: AntigravityPromptRecord = {
      pendingMessageId,
      showsPending: !startsTurn,
      accepted: false,
      answered: false,
      accept: () => {
        // The message keeps the time when the user sent it, so its row does not move.
        const { closedItems, userMessage } = this.context.transcript.addLiveUserMessage({
          message,
          model,
          sentAt,
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
        if (record.showsPending && userMessage.messageId !== pendingMessageId) {
          events.push(this.retraction(record));
        }
        const compaction: AgentEvent[] = [];
        if (startsTurn && isManualCompaction(input.parts)) {
          turn.compaction = userMessage;
          compaction.push({
            type: "session_compaction_started",
            externalSessionId: sessionId,
            timestamp: userMessage.timestamp,
            messageId: userMessage.messageId,
            message: ANTIGRAVITY_COMPACTION_STARTED_MESSAGE,
          });
        }
        this.context.publish([...events, ...closedItems, userMessage, ...compaction]);
        acceptance.resolve(userMessage);
      },
      reject: acceptance.reject,
    };
    turn.prompts.push(record);
    turn.openPrompts += 1;
    // The snapshot shows the running turn at once. The busy status waits for admission.
    if (record.showsPending) this.context.publish([pending]);
    input.onWorkIssued?.();
    agent.request(methods.agent.session.prompt, { sessionId, prompt }).then(
      (response) => this.onPromptResponse(turn, record, response),
      (cause: unknown) => this.onPromptError(turn, record, cause),
    );
    if (startsTurn) admitPrompt(record);
    const userMessage = await acceptance.promise;
    input.onWorkAccepted?.();
    return userMessage;
  }

  /**
   * Stops the turn with `session/cancel`, closes its pending input, and waits for the runtime to
   * end the turn. The host has no time limit, so the session owns the deadline.
   */
  async stop(deadlineMs: number): Promise<void> {
    const turn = this.turn;
    if (!turn) return;
    const agent = this.context.connection.agent();
    const ended = new Promise<void>((resolve) => turn.endWaiters.push(resolve));
    turn.stopRequested = true;
    await this.context.connection.request(() =>
      agent.notify(methods.agent.session.cancel, { sessionId: this.context.ref.externalSessionId }),
    );
    this.context.cancelPendingInput();
    this.context.publish([]);
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
  }

  /** Drops the turn of a session that leaves the runtime. Its unadmitted messages have no answer. */
  close(reason: string): void {
    this.context.cancelPendingInput();
    const turn = this.turn;
    this.turn = null;
    if (!turn) return;
    for (const record of turn.prompts) {
      if (record.accepted) continue;
      record.accepted = true;
      record.reject(
        new AgentSessionMessageAcceptanceUnknownError({
          externalSessionId: this.context.ref.externalSessionId,
          messageId: record.pendingMessageId,
          cause: new Error(reason),
        }),
      );
    }
    settleEndWaiters(turn);
  }

  /** The terminal events of a turn that the runtime stopped running. */
  settle(reason: string): AgentSessionTranscriptEvent[] {
    if (!this.turn) return [];
    const timestamp = this.context.connection.now();
    // The runtime stop interrupts the turn. Its notice stays in the live view and in history.
    const events = this.context.transcript.finishTurn("interrupted");
    events.push({
      type: "session_idle",
      externalSessionId: this.context.ref.externalSessionId,
      timestamp,
      turnOutcome: "interrupted",
      interruption: this.context.transcript.addInterruptionNotice(timestamp, reason),
    });
    return toTranscriptEvents(this.context.ref, events);
  }

  /**
   * Admits the oldest open prompt of the turn at turn content or a runtime request. Content that
   * arrives while an earlier prompt is still open belongs to that prompt, so it admits no steer.
   */
  acceptStart(): void {
    const oldestOpen = this.turn?.prompts.find((record) => !record.answered);
    if (oldestOpen) admitPrompt(oldestOpen);
  }

  private endTurn(outcome: AgentTurnOutcome, errorMessage?: string): void {
    const turn = this.turn;
    if (!turn) return;
    this.turn = null;
    this.context.cancelPendingInput();
    const timestamp = this.context.connection.now();
    const events = this.context.transcript.finishTurn(
      outcome,
      this.context.model.selection,
      turn.startedAt,
    );
    if (turn.compaction) events.push(...this.endCompaction(turn.compaction, outcome, timestamp));
    if (errorMessage) {
      events.push({
        type: "turn_error",
        externalSessionId: this.context.ref.externalSessionId,
        timestamp,
        message: errorMessage,
      });
    }
    const idle: Extract<AgentEvent, { type: "session_idle" }> = {
      type: "session_idle",
      externalSessionId: this.context.ref.externalSessionId,
      timestamp,
      turnOutcome: outcome,
    };
    // A turn that Stop ended gets the stop notice in the live view and in history alike.
    if (outcome === "interrupted" && turn.stopRequested) {
      idle.interruption = this.context.transcript.addInterruptionNotice(
        timestamp,
        "Session stopped at your request.",
      );
    }
    events.push(idle);
    this.context.publish(events);
    settleEndWaiters(turn);
  }

  /**
   * The answer of a prompt admits that prompt only. The answer of an earlier prompt does not admit
   * a steer: the earlier turn can end on its own, and the runtime can still refuse the steer.
   */
  private onPromptResponse(
    turn: AntigravityTurn,
    record: AntigravityPromptRecord,
    response: PromptResponse,
  ): void {
    record.answered = true;
    admitPrompt(record);
    const outcome = turnOutcomeFor(response);
    turn.lastSettlement = {
      outcome,
      errorMessage: outcome === "failed" ? REFUSED_TURN_MESSAGE : undefined,
    };
    turn.openPrompts -= 1;
    if (turn.openPrompts > 0 || this.turn !== turn) return;
    this.endTurn(outcome, turn.lastSettlement.errorMessage);
  }

  private onPromptError(turn: AntigravityTurn, record: AntigravityPromptRecord, cause: unknown) {
    record.answered = true;
    turn.openPrompts -= 1;
    if (!record.accepted) {
      // Only an error answer of the runtime proves that it refused the message.
      if (cause instanceof RequestError && !this.context.connection.transportClosed()) {
        record.accepted = true;
        this.refusePrompt(turn, record, cause);
        return;
      }
      // The pending row stays, so the live view and history show the unknown delivery alike.
      record.accepted = true;
      record.reject(
        new AgentSessionMessageAcceptanceUnknownError({
          externalSessionId: this.context.ref.externalSessionId,
          messageId: record.pendingMessageId,
          cause,
        }),
      );
    }
    // A later refused steer ends the turn with this failure, so it keeps the reason.
    turn.lastSettlement = {
      outcome: "failed",
      errorMessage: describeAntigravityRequestError(cause),
    };
    if (turn.openPrompts > 0 || this.turn !== turn) return;
    this.endTurn("failed", turn.lastSettlement.errorMessage);
  }

  /**
   * A refused message never entered the transcript, so the host queue keeps it. When it was the
   * last open prompt, the turn ends: with the outcome and reason of the last earlier answer, also a
   * failure, or with no outcome when no prompt of the turn was answered.
   */
  private refusePrompt(turn: AntigravityTurn, record: AntigravityPromptRecord, cause: unknown) {
    turn.prompts.splice(turn.prompts.indexOf(record), 1);
    record.reject(
      new AgentSessionMessageRefusedError(new Error(describeAntigravityRequestError(cause))),
    );
    const retraction = this.retraction(record);
    if (turn.openPrompts > 0 || this.turn !== turn) {
      this.context.publish([retraction]);
      return;
    }
    if (turn.lastSettlement) {
      this.context.publish([retraction]);
      this.endTurn(turn.lastSettlement.outcome, turn.lastSettlement.errorMessage);
      return;
    }
    // No prompt of the turn was admitted, so no turn ran: the snapshot returns to idle, and no idle
    // event saves activity.
    this.turn = null;
    this.context.publish([retraction]);
    settleEndWaiters(turn);
  }

  /**
   * Antigravity sends nothing while it compacts, so the end of the `/compact` turn is the end of the
   * compaction. A turn that does not complete shows the `/compact` message again.
   */
  private endCompaction(
    message: Extract<AgentEvent, { type: "user_message" }>,
    outcome: AgentTurnOutcome,
    timestamp: string,
  ): AgentEvent[] {
    if (outcome !== "completed") return [message];
    this.context.transcript.completeCompaction(message.messageId, timestamp);
    return [
      {
        type: "session_compacted",
        externalSessionId: this.context.ref.externalSessionId,
        timestamp,
        messageId: message.messageId,
        message: ANTIGRAVITY_COMPACTED_MESSAGE,
      },
    ];
  }

  private retraction(record: AntigravityPromptRecord): AgentEvent {
    return {
      type: "transcript_retracted",
      externalSessionId: this.context.ref.externalSessionId,
      timestamp: this.context.connection.now(),
      messageIds: [record.pendingMessageId],
    };
  }
}

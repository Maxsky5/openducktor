import type {
  AcceptedAgentUserMessage,
  AgentMessageQueueAction,
  AgentMessageQueueSnapshot,
  AgentMessageSubmitInput,
  AgentMessageTarget,
  AgentQueuedMessage,
  AgentQueuedMessageState,
} from "@openducktor/contracts";
import { isQueuedDeliveryStarted } from "@openducktor/core";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { AgentSessionSendContent } from "./agent-session-operation-policy";

/** A message with the submission ID that names it in the queue and in its accepted form. */
export type SubmittedContent = AgentSessionSendContent & { readonly submissionId: string };

export type QueueEntry = {
  readonly submissionId: string;
  readonly queuedAt: string;
  content: SubmittedContent;
  error?: string;
  /** The native message ID of a delivery that has no conclusive result. */
  unknownMessageId?: string;
} & (
  | {
      state: "editing";
      /** Identifies the current edit, so a Save or Cancel from an older edit cannot end it. */
      editId: string;
    }
  | { state: Exclude<AgentQueuedMessageState, "editing">; editId?: undefined }
);

export type MessageQueue = {
  readonly key: string;
  target: AgentMessageTarget;
  revision: number;
  entries: QueueEntry[];
  pause: QueuePause | null;
  /**
   * True while a new turn is in flight: a send of the composer, or the delivery of the first
   * entry. It keeps the queue, because the result of the send can still change it.
   */
  sendingNewTurn: boolean;
  /** Counts completed turns, so a refused new turn can tell if a turn ended meanwhile. */
  completedTurns: number;
  /** True when delivery waited for an answer to pending input. The answer releases it. */
  waitsForInput: boolean;
};

/** Why the queue waits for the user. Only `snapshotOf` turns a pause into text. */
export type QueuePause =
  | { readonly cause: "stopped" | "turn_interrupted" | "turn_failed" | "left_runtime" }
  | { readonly cause: "acceptance_unknown" | "acceptance_confirmed" }
  | {
      readonly cause: "agent_error" | "delivery_failed" | "steer_failed" | "accepted_then_failed";
      readonly detail: string;
    };

/** No message can reach a session that left its runtime until the user reopens it. */
export const SESSION_LEFT_RUNTIME_REASON =
  "The session is not running in its runtime. Reopen the session, then resume the queue.";
export const ACCEPTANCE_UNKNOWN_REASON =
  "OpenDucktor cannot tell if the agent received a message. The queue stays paused until the conversation shows it.";

/** A pause text that tells the user how to go on. */
const resumeText = (cause: string): string => `${cause} Resume the queue to send the next message.`;

const pauseMessage = (pause: QueuePause): string => {
  switch (pause.cause) {
    case "stopped":
      return resumeText("You stopped the agent.");
    case "turn_interrupted":
      return resumeText("The turn was interrupted.");
    case "turn_failed":
      return resumeText("The turn failed.");
    case "left_runtime":
      return SESSION_LEFT_RUNTIME_REASON;
    case "acceptance_unknown":
      return ACCEPTANCE_UNKNOWN_REASON;
    case "acceptance_confirmed":
      return resumeText("The agent received the message whose delivery was unknown.");
    case "agent_error":
      return resumeText(`The agent stopped with an error: ${pause.detail}`);
    case "delivery_failed":
      return `Delivery failed: ${pause.detail} Resume the queue to try again.`;
    case "steer_failed":
      return resumeText(`Steering failed: ${pause.detail}`);
    case "accepted_then_failed":
      return `The agent received the message, but a later update failed: ${pause.detail}`;
  }
};

const ACCEPTANCE_UNKNOWN_ERROR =
  "OpenDucktor cannot tell if the agent received this message. Nobody can send it again until the conversation shows it. Restarting OpenDucktor clears the queue.";

/** The submission ID stays with the content, so the accepted message can name it. */
export const contentOf = ({
  mode: _mode,
  ...content
}: AgentMessageSubmitInput): AgentSessionSendContent => content;

export const actionError = (message: string) =>
  new HostValidationError({ field: "action", message });

export const snapshotOf = (queue: MessageQueue): AgentMessageQueueSnapshot => ({
  target: queue.target,
  revision: queue.revision,
  entries: queue.entries.map((entry): AgentQueuedMessage => {
    const fields = {
      submissionId: entry.submissionId,
      parts: entry.content.parts,
      queuedAt: entry.queuedAt,
    };
    const message: AgentQueuedMessage =
      entry.state === "editing"
        ? { ...fields, state: entry.state, editId: entry.editId }
        : { ...fields, state: entry.state };
    if (entry.content.model !== undefined) message.model = entry.content.model;
    if (entry.error !== undefined) message.error = entry.error;
    return message;
  }),
  pause: queue.pause === null ? null : { message: pauseMessage(queue.pause) },
});

/** The runtime gave no conclusive answer, so the entry must not be sent again. */
export const markAcceptanceUnknown = (entry: QueueEntry, messageId: string): void => {
  entry.state = "acceptance_unknown";
  entry.unknownMessageId = messageId;
  entry.error = ACCEPTANCE_UNKNOWN_ERROR;
};

/** Finds the pending entry of an accepted message by its submission or unknown native ID. */
export const findAcceptedEntry = (
  queue: MessageQueue,
  message: AcceptedAgentUserMessage,
): QueueEntry | undefined =>
  queue.entries.find((candidate) =>
    candidate.state === "acceptance_unknown"
      ? candidate.unknownMessageId === message.messageId ||
        candidate.submissionId === message.submissionId
      : isQueuedDeliveryStarted(candidate) && candidate.submissionId === message.submissionId,
  );

/** A pause ends with the last entry, because nothing waits. Returns true when it ended one. */
export const endPauseIfEmpty = (queue: MessageQueue): boolean => {
  if (queue.entries.length > 0 || queue.pause === null) return false;
  queue.pause = null;
  return true;
};

export const removeEntry = (queue: MessageQueue, entry: QueueEntry): void => {
  queue.entries = queue.entries.filter((candidate) => candidate !== entry);
  endPauseIfEmpty(queue);
};

const blockedActionMessage = (state: AgentQueuedMessageState): string => {
  switch (state) {
    case "sending":
    case "steering":
      return "Delivery of this message already started.";
    case "acceptance_unknown":
      return "OpenDucktor cannot tell if the agent received this message. Wait for the conversation to show it.";
    case "editing":
    case "queued":
      return "Save or cancel the edit of this message first.";
  }
};

export const findEntry = (queue: MessageQueue | undefined, submissionId: string) => {
  const entry = queue?.entries.find((candidate) => candidate.submissionId === submissionId);
  if (!queue || !entry) {
    return Effect.fail(actionError("This message is no longer in the queue."));
  }
  return Effect.succeed({ queue, entry });
};

/**
 * Checks the state of an entry and changes it in one step, so automatic delivery cannot start
 * the same entry between the check and the change.
 */
export const transitionEntry = (
  entry: QueueEntry,
  allowed: AgentQueuedMessageState[],
  apply: () => void,
): Effect.Effect<void, HostValidationError> =>
  Effect.suspend(() => {
    if (!allowed.includes(entry.state)) {
      return Effect.fail(actionError(blockedActionMessage(entry.state)));
    }
    apply();
    return Effect.void;
  });

/** Checks that a Save or Cancel belongs to the current edit of the entry. */
const requireCurrentEdit = (entry: QueueEntry, editId: string) =>
  entry.editId === editId
    ? Effect.void
    : Effect.fail(
        actionError("This edit ended or changed elsewhere. Open the message again to edit it."),
      );

/**
 * Applies an edit or a removal. It returns true when the change can release the queue.
 * `nextEditId` names the edit that `begin_edit` starts.
 */
export const changeEntry = (
  queue: MessageQueue,
  entry: QueueEntry,
  action: Exclude<AgentMessageQueueAction, { kind: "resume" | "steer" }>,
  nextEditId: () => string,
): Effect.Effect<boolean, HostValidationError> => {
  switch (action.kind) {
    case "begin_edit":
      return transitionEntry(entry, ["queued"], () => {
        entry.state = "editing";
        entry.editId = nextEditId();
      }).pipe(Effect.as(false));
    case "save_edit":
      return requireCurrentEdit(entry, action.editId).pipe(
        Effect.andThen(
          transitionEntry(entry, ["editing"], () => {
            entry.content = { ...entry.content, parts: action.parts };
            entry.state = "queued";
            delete entry.editId;
            delete entry.error;
          }),
        ),
        Effect.as(true),
      );
    case "cancel_edit":
      return requireCurrentEdit(entry, action.editId).pipe(
        Effect.andThen(
          transitionEntry(entry, ["editing"], () => {
            entry.state = "queued";
            delete entry.editId;
          }),
        ),
        Effect.as(true),
      );
    case "remove":
      // A message with an unknown result stays until the conversation shows it, so it never
      // repeats.
      return transitionEntry(entry, ["queued", "editing"], () => removeEntry(queue, entry)).pipe(
        Effect.as(true),
      );
  }
};

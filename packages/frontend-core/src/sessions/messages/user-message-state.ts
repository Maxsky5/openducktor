import type { AgentUserMessageState } from "@openducktor/core";

const USER_MESSAGE_STATE_ORDER = {
  pending: 0,
  queued: 1,
  read: 2,
} as const satisfies Record<AgentUserMessageState, number>;

/**
 * The later of two states of one user message: `pending`, then `queued`, then `read`. A state
 * never moves backward, so a late update cannot undo a later one.
 */
export const laterUserMessageState = (
  left: AgentUserMessageState,
  right: AgentUserMessageState,
): AgentUserMessageState =>
  USER_MESSAGE_STATE_ORDER[left] >= USER_MESSAGE_STATE_ORDER[right] ? left : right;

/** A `pending` or `queued` message waits for the runtime to read it, so it shows as unread. */
export const awaitsRuntime = (state: AgentUserMessageState): boolean => state !== "read";

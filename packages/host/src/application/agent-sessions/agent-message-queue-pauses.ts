import type { AgentMessageQueueSnapshot } from "@openducktor/contracts";
import type { MessageQueue, QueuePause } from "./agent-message-queue-model";
import { nextUsageLimitStop, type UsageLimitStopSignal } from "./usage-limit-stop-signal";

type UsageLimitPause = Extract<QueuePause, { cause: "usage_limit" }>;

const stopSignal = (pause: QueuePause): UsageLimitStopSignal => {
  switch (pause.cause) {
    case "usage_limit":
      return { kind: "limit_error", stopId: pause.stopId };
    case "turn_failed":
      return { kind: "turn_end", outcome: "failed" };
    case "turn_interrupted":
      return { kind: "turn_end", outcome: "interrupted" };
    default:
      return { kind: "other" };
  }
};

/** The usage-limit pause after a new pause signal. The same pause means no change. */
const followUsageLimitPause = (current: UsageLimitPause, next: QueuePause): QueuePause => {
  switch (nextUsageLimitStop(current, stopSignal(next))) {
    case "same_stop":
      return current;
    case "turn_ended":
      return { ...current, turnEnded: true };
    case "replaced":
      // A new stop, a failed resume, or a stop by the user replaces the usage-limit pause.
      return next;
  }
};

/** Owns the pause rules of the queues. Callers publish nothing for a pause. */
export const createQueuePauses = ({
  publish,
  isBlockedOnInput,
}: {
  publish: (queue: MessageQueue) => AgentMessageQueueSnapshot;
  isBlockedOnInput: (sessionKey: string) => boolean;
}) => ({
  /** Pauses queued messages and in-flight sends. The first cause stays, except a usage limit. */
  pause: (queue: MessageQueue, pause: QueuePause): void => {
    if (queue.pause?.cause === "usage_limit") {
      const next = followUsageLimitPause(queue.pause, pause);
      if (next === queue.pause) return;
      queue.pause = next;
      publish(queue);
      return;
    }
    if (queue.pause !== null) return;
    if (queue.entries.length === 0 && !queue.sendingNewTurn) return;
    queue.pause = pause;
    publish(queue);
  },
  /** A completed turn after a usage-limit stop releases the pause, as Resume queue does. */
  releaseAfterCompletedTurn: (queue: MessageQueue): void => {
    if (queue.pause?.cause !== "usage_limit" || !queue.pause.turnEnded) return;
    if (queue.entries.some((entry) => entry.state === "acceptance_unknown")) return;
    if (isBlockedOnInput(queue.key)) return;
    queue.pause = null;
    publish(queue);
  },
});

import type { AgentMessageSubmitResult } from "@openducktor/contracts";
import { Effect } from "effect";
import { type HostError, toHostOperationError } from "../../effect/host-errors";
import type { AgentSessionSendOptions } from "../../ports/agent-session-live-adapter-port";
import {
  markAcceptanceUnknown,
  removeEntry,
  type MessageQueue,
  type SubmittedContent,
} from "./agent-message-queue-model";
import type { createQueueRegistry } from "./agent-message-queue-registry";

/** Marks admission as soon as the task write commits, before the task update is published. */
export type QueuedSubmissionCommit = (onCommitted: () => void) => Effect.Effect<unknown, HostError>;

export type SubmitOptions = AgentSessionSendOptions & {
  onQueued?: (state: "queued" | "acceptance_unknown") => void;
};

export const createMessageQueueAdmission = (
  registry: ReturnType<typeof createQueueRegistry>,
  release: (queue: MessageQueue) => void,
) => {
  const { publish, forgetIfUnused } = registry;

  /** Retains an uncertain message at the front of its queue and blocks repeat delivery. */
  const queueUnknownMessage = (
    queue: MessageQueue,
    content: SubmittedContent,
    messageId?: string,
    options?: SubmitOptions,
  ): AgentMessageSubmitResult => {
    markAcceptanceUnknown(registry.enqueue(queue, content, "first"), messageId);
    queue.pause ??= { cause: "acceptance_unknown" };
    options?.onQueued?.("acceptance_unknown");
    return { kind: "queued", queue: publish(queue) };
  };

  /** Stop can run while preparation waits. Check and enqueue without yielding. */
  const enqueue = (
    queue: MessageQueue,
    content: SubmittedContent,
    position: "first" | "last",
    options?: SubmitOptions,
    queuedCommit?: QueuedSubmissionCommit,
  ) =>
    Effect.gen(function* () {
      try {
        options?.assertCurrent?.();
      } catch (cause) {
        forgetIfUnused(queue);
        return yield* toHostOperationError(cause, "agent-message-delivery.enqueue");
      }
      const entry = registry.enqueue(queue, content, position);
      if (!queuedCommit) {
        options?.onQueued?.("queued");
        return { kind: "queued" as const, queue: publish(queue) };
      }

      // Reserve the entry through the task write. The queue can pause it, but cannot deliver it yet.
      entry.state = "reserved";
      let committed = false;
      const outcome = yield* Effect.exit(
        queuedCommit(() => {
          committed = true;
          options?.onQueued?.("queued");
        }),
      );
      if (committed) entry.state = "queued";
      else removeEntry(queue, entry);
      const snapshot = publish(queue);
      release(queue);
      if (outcome._tag === "Failure") return yield* Effect.failCause(outcome.cause);
      return { kind: "queued" as const, queue: snapshot };
    });

  return { enqueue, queueUnknownMessage };
};

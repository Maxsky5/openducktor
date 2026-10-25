import type { AgentMessageQueueAction } from "@openducktor/contracts";
import { useCallback, useState } from "react";

/** One running action of a queued message. Each run is its own object, so its end clears only it. */
export type QueuedMessageActionRun = { kind: AgentMessageQueueAction["kind"] };

export type QueuedMessageActionRuns = {
  /** The action that runs now for each message, by submission ID. */
  running: ReadonlyMap<string, QueuedMessageActionRun>;
  /**
   * Runs one action of a queued message and returns its result. The message shows its action
   * until the operation ends, or until a newer action of the same message starts.
   */
  track: (
    submissionId: string,
    kind: AgentMessageQueueAction["kind"],
    operation: () => Promise<void>,
  ) => Promise<void>;
};

const NO_RUNS: ReadonlyMap<string, QueuedMessageActionRun> = new Map();

/**
 * The running actions of the Message Queue. Each message keeps its own action, so the end of an
 * action on one message never opens the buttons of another message whose action still runs, or of
 * a newer action on the same message.
 */
export function useQueuedMessageActionRuns(): QueuedMessageActionRuns {
  const [running, setRunning] = useState(NO_RUNS);
  const track = useCallback<QueuedMessageActionRuns["track"]>(
    async (submissionId, kind, operation) => {
      const run: QueuedMessageActionRun = { kind };
      setRunning((current) => new Map(current).set(submissionId, run));
      try {
        await operation();
      } finally {
        setRunning((current) => {
          if (current.get(submissionId) !== run) return current;
          const next = new Map(current);
          next.delete(submissionId);
          return next;
        });
      }
    },
    [],
  );
  return { running, track };
}

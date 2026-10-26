import type { AgentMessageQueueAction } from "@openducktor/contracts";
import {
  type ComposerFailure,
  describeComposerFailure,
} from "@openducktor/frontend-core/sessions/composer/composer-failure";
import {
  type QueuedMessageActionRun,
  useQueuedMessageActionRuns,
} from "@openducktor/frontend-core/sessions/send/use-queued-message-action-runs";
import { useCallback, useState } from "react";

export type QueueActions = {
  /** The action that runs now for each message, by submission ID. */
  running: ReadonlyMap<string, QueuedMessageActionRun>;
  /** The last failure of each message, by submission ID. */
  failures: ReadonlyMap<string, ComposerFailure>;
  /** Runs a queue action of one message. A new run clears the last failure of the message. */
  run: (
    submissionId: string,
    kind: AgentMessageQueueAction["kind"],
    operation: () => Promise<void>,
    onSuccess?: () => void,
  ) => void;
};

/**
 * Runs the actions of the Message Queue cards. Each message keeps its own running action, as
 * `useQueuedMessageActionRuns` tracks it, and its last failure.
 */
export function useQueueActions(): QueueActions {
  const { running, track } = useQueuedMessageActionRuns();
  const [failures, setFailures] = useState<ReadonlyMap<string, ComposerFailure>>(new Map());
  const run = useCallback<QueueActions["run"]>(
    (submissionId, kind, operation, onSuccess) => {
      setFailures((current) => {
        if (!current.has(submissionId)) return current;
        const next = new Map(current);
        next.delete(submissionId);
        return next;
      });
      void track(submissionId, kind, async () => {
        await operation();
        onSuccess?.();
      }).catch((cause: Error) => {
        setFailures((current) =>
          new Map(current).set(
            submissionId,
            describeComposerFailure(cause, {
              title: "Queued message action failed",
              attachmentNames: [],
            }),
          ),
        );
      });
    },
    [track],
  );
  return { running, failures, run };
}

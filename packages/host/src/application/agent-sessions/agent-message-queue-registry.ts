import type {
  AgentMessageQueueSnapshot,
  AgentMessageTarget,
  AgentSessionLiveRef,
} from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import {
  type MessageQueue,
  type QueueEntry,
  type SubmittedContent,
  snapshotOf,
} from "./agent-message-queue-model";

/**
 * Owns the live message queues of all sessions. It numbers their revisions and edits, publishes
 * their snapshots, and forgets a queue that has nothing left to keep.
 */
export const createQueueRegistry = ({
  publishSnapshot,
  now,
}: {
  readonly publishSnapshot: (snapshot: AgentMessageQueueSnapshot) => void;
  readonly now: () => string;
}) => {
  const queues = new Map<string, MessageQueue>();
  // One sequence for every queue, so a removed and re-created queue still moves forward.
  let revisionSequence = 0;
  let editSequence = 0;

  /**
   * Forgets a queue that has nothing to keep. Use it only with the current queue of a session,
   * because a newer queue can have the same key.
   */
  const forgetIfUnused = (queue: MessageQueue): void => {
    if (isUnusedQueue(queue)) queues.delete(queue.key);
  };

  return {
    find: (key: string): MessageQueue | undefined => queues.get(key),
    findFor: (ref: AgentSessionLiveRef): MessageQueue | undefined =>
      queues.get(agentSessionRefKey(ref)),
    queueFor: (content: SubmittedContent): MessageQueue => {
      const target = targetOf(content);
      const key = agentSessionRefKey(target);
      const existing = queues.get(key);
      if (existing) {
        existing.target = target;
        return existing;
      }
      const created = createQueue(key, target);
      queues.set(key, created);
      return created;
    },
    /** Publishes the queue and returns its snapshot. An empty queue is then forgotten. */
    publish: (queue: MessageQueue): AgentMessageQueueSnapshot => {
      revisionSequence += 1;
      queue.revision = revisionSequence;
      const snapshot = snapshotOf(queue);
      publishSnapshot(snapshot);
      forgetIfUnused(queue);
      return snapshot;
    },
    forgetIfUnused,
    enqueue: (
      queue: MessageQueue,
      content: SubmittedContent,
      position: "first" | "last",
    ): QueueEntry => {
      const entry: QueueEntry = {
        submissionId: content.submissionId,
        queuedAt: now(),
        content,
        state: "queued",
      };
      queue.entries = position === "first" ? [entry, ...queue.entries] : [...queue.entries, entry];
      return entry;
    },
    nextEditId: (): string => {
      editSequence += 1;
      return `edit-${editSequence}`;
    },
    /** Lists the queues of one repository that still keep messages or a pause. */
    list: (repoPath: string): AgentMessageQueueSnapshot[] =>
      [...queues.values()]
        .filter((queue) => queue.target.repoPath === repoPath && !isUnusedQueue(queue))
        .map(snapshotOf),
  };
};

const targetOf = ({
  repoPath,
  runtimeKind,
  workingDirectory,
  externalSessionId,
  sessionScope,
}: AgentMessageTarget): AgentMessageTarget => ({
  repoPath,
  runtimeKind,
  workingDirectory,
  externalSessionId,
  sessionScope,
});

const createQueue = (key: string, target: AgentMessageTarget): MessageQueue => ({
  key,
  target,
  revision: 0,
  entries: [],
  pause: null,
  sendingNewTurn: false,
  completedTurns: 0,
  waitsForInput: false,
});

const isUnusedQueue = (queue: MessageQueue) =>
  queue.entries.length === 0 && queue.pause === null && !queue.sendingNewTurn;

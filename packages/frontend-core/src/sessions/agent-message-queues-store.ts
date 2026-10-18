import type { AgentMessageQueueSnapshot, AgentSessionLiveRef } from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";

type Listener = () => void;

/** A renderer copy of the message queues that the host owns. */
export type AgentMessageQueuesStore = {
  subscribe: (listener: Listener) => () => void;
  /** Returns the queue of one session, or null when it has no message and no pause. */
  getQueue: (ref: AgentSessionLiveRef | null) => AgentMessageQueueSnapshot | null;
  /** A connection snapshot replaces every queue of its repository. */
  replaceRepository: (repoPath: string, queues: readonly AgentMessageQueueSnapshot[]) => void;
  /** An older revision cannot replace a newer one, so late command results are safe. */
  apply: (queue: AgentMessageQueueSnapshot) => void;
  /**
   * Removes the queue entry of a message that the runtime accepted. The reader calls it in
   * the step that adds the message to the transcript, so both change in one render.
   */
  removeAccepted: (ref: AgentSessionLiveRef, submissionId: string) => void;
};

const isVisibleQueue = (queue: AgentMessageQueueSnapshot): boolean =>
  queue.entries.length > 0 || queue.pause !== null;

export const createAgentMessageQueuesStore = (): AgentMessageQueuesStore => {
  let queues = new Map<string, AgentMessageQueueSnapshot>();
  const listeners = new Set<Listener>();
  const notify = (): void => {
    // A listener can unsubscribe while the store notifies, so iterate over a copy.
    for (const listener of Array.from(listeners)) listener();
  };

  const replaceRepository: AgentMessageQueuesStore["replaceRepository"] = (
    repoPath,
    nextQueues,
  ) => {
    const next = new Map([...queues].filter(([, queue]) => queue.target.repoPath !== repoPath));
    for (const queue of nextQueues) next.set(agentSessionRefKey(queue.target), queue);
    queues = next;
    notify();
  };
  const apply: AgentMessageQueuesStore["apply"] = (queue) => {
    const key = agentSessionRefKey(queue.target);
    const current = queues.get(key);
    if (current && current.revision >= queue.revision) return;
    queues = new Map(queues).set(key, queue);
    notify();
  };
  const removeAccepted: AgentMessageQueuesStore["removeAccepted"] = (ref, submissionId) => {
    const key = agentSessionRefKey(ref);
    const current = queues.get(key);
    if (!current?.entries.some((entry) => entry.submissionId === submissionId)) return;
    // The revision stays, so the host update that removes the entry still applies.
    const entries = current.entries.filter((entry) => entry.submissionId !== submissionId);
    queues = new Map(queues).set(key, { ...current, entries });
    notify();
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getQueue: (ref) => {
      if (!ref) return null;
      const queue = queues.get(agentSessionRefKey(ref));
      return queue && isVisibleQueue(queue) ? queue : null;
    },
    replaceRepository,
    apply,
    removeAccepted,
  };
};

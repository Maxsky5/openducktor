import type { ClientConnection } from "@openducktor/frontend-core/connection/client-connection";
import { perConnection } from "@openducktor/frontend-core/lib/per-connection";
import type { SessionStartMessageRetry } from "@openducktor/frontend-core/sessions/start/session-start-message-retry";

/** A first message that did not reach a started session, for one task. */
type PendingMessageRetry = {
  id: number;
  taskId: string;
  retry: SessionStartMessageRetry;
  /** The retry runs now. */
  pending: boolean;
};

/**
 * The first-message retries of one host connection. A retry outlives the sheet that started the
 * session, so the task details show it until the message reaches the session or the user
 * dismisses it. Nothing sends the message again without the user. A lost send result stays as
 * "Result unknown" without Retry.
 */
export type MessageRetryStore = {
  add: (taskId: string, retry: SessionStartMessageRetry) => void;
  retry: (id: number) => Promise<void>;
  dismiss: (id: number) => void;
  forTask: (taskId: string) => readonly PendingMessageRetry[];
  subscribe: (listener: () => void) => () => void;
};

const NONE: readonly PendingMessageRetry[] = [];

export const createMessageRetryStore = (): MessageRetryStore => {
  let entries: readonly PendingMessageRetry[] = [];
  let nextId = 0;
  const byTask = new Map<string, readonly PendingMessageRetry[]>();
  const listeners = new Set<() => void>();
  const publish = (next: readonly PendingMessageRetry[]): void => {
    entries = next;
    byTask.clear();
    for (const listener of listeners) listener();
  };
  const update = (id: number, change: (entry: PendingMessageRetry) => PendingMessageRetry | null) =>
    publish(
      entries.flatMap((entry) => {
        if (entry.id !== id) return [entry];
        const next = change(entry);
        return next ? [next] : [];
      }),
    );
  return {
    add: (taskId, retry) => {
      nextId += 1;
      publish([...entries, { id: nextId, taskId, retry, pending: false }]);
    },
    retry: async (id) => {
      const entry = entries.find((candidate) => candidate.id === id);
      if (!entry || entry.pending || entry.retry.kind !== "failed") return;
      update(id, (current) => ({ ...current, pending: true }));
      const next = await entry.retry.retry();
      update(id, (current) => (next ? { ...current, retry: next, pending: false } : null));
    },
    dismiss: (id) => update(id, () => null),
    forTask: (taskId) => {
      const known = byTask.get(taskId);
      if (known) return known;
      const list = entries.filter((entry) => entry.taskId === taskId);
      const result = list.length === 0 ? NONE : list;
      byTask.set(taskId, result);
      return result;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

/** The retry store of a connection, which lives as long as the connection. */
export const messageRetryStoreOf = perConnection(() => createMessageRetryStore());

/**
 * Keeps the retry of a first message that did not reach a started session, and tells the user
 * where to retry it. A start that opens its session leaves the sheet, and the session screen shows
 * no retry.
 */
export const reportMessageRetry = (
  connection: ClientConnection,
  taskId: string,
  retry: SessionStartMessageRetry,
): void => {
  messageRetryStoreOf(connection).add(taskId, retry);
  connection.feedback.show("error", retry.title, {
    description: `${retry.description} Open ${taskId} to retry the message.`,
  });
};

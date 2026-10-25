import { useCallback, useSyncExternalStore } from "react";

/**
 * The live state of transcript rows that changes apart from their messages: the Assistant
 * Message that streams now, and the pending input of each Subagent session. A row reads only its
 * own value, so a change renders only the rows whose value changed, not every row in the list.
 */
export type RowStateStore = {
  set: (streamingMessageId: string | null, subagentPendingCounts: SubagentPendingCounts) => void;
  isStreaming: (messageId: string) => boolean;
  subagentPendingCount: (sessionKey: string) => number;
  subscribe: (listener: () => void) => () => void;
};

type SubagentPendingCounts = Readonly<Record<string, number>>;

export const createRowStateStore = (): RowStateStore => {
  let streamingMessageId: string | null = null;
  let counts: SubagentPendingCounts = {};
  const listeners = new Set<() => void>();
  return {
    set(nextStreamingMessageId, nextCounts) {
      if (nextStreamingMessageId === streamingMessageId && nextCounts === counts) return;
      streamingMessageId = nextStreamingMessageId;
      counts = nextCounts;
      for (const listener of Array.from(listeners)) listener();
    },
    isStreaming: (messageId) => messageId === streamingMessageId,
    subagentPendingCount: (sessionKey) => counts[sessionKey] ?? 0,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

/** True while the message streams. */
export const useMessageStreaming = (store: RowStateStore, messageId: string): boolean => {
  const read = useCallback(() => store.isStreaming(messageId), [messageId, store]);
  return useSyncExternalStore(store.subscribe, read, read);
};

/** The pending input count of a Subagent session, or 0 for a row without a Subagent session. */
export const useSubagentPendingCount = (
  store: RowStateStore,
  sessionKey: string | null,
): number => {
  const read = useCallback(
    () => (sessionKey === null ? 0 : store.subagentPendingCount(sessionKey)),
    [sessionKey, store],
  );
  return useSyncExternalStore(store.subscribe, read, read);
};

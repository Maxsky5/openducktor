import type {
  NotificationCursor,
  NotificationHealth,
  NotificationStreamFrame,
} from "@openducktor/contracts";
import { notificationReplayReason } from "@openducktor/core";

type Listener = {
  onFrame(frame: NotificationStreamFrame): void;
  onFailure(cause: unknown): void;
};

/** Keep a short replay buffer so new consumers can join the shared connection. */
export const createNotificationFrameRelay = (): NotificationFrameRelay => {
  const listeners = new Set<Listener>();
  const recent: NotificationStreamFrame[] = [];
  const health = new Map<string, NotificationHealth>();
  let cursor: NotificationCursor | null = null;
  const deliver = (listener: Listener, frame: NotificationStreamFrame) => {
    try {
      listener.onFrame(structuredClone(frame));
    } catch (cause) {
      listeners.delete(listener);
      listener.onFailure(cause);
    }
  };
  return {
    hasListeners: () => listeners.size > 0,
    accept(frame: NotificationStreamFrame) {
      const copy = structuredClone(frame);
      cursor = copy.cursor;
      if (copy.type === "attached") {
        recent.length = 0;
        health.clear();
        for (const value of copy.health) health.set(`${value.scope}:${value.source}`, value);
      } else {
        recent.push(copy);
        if (recent.length > 256) recent.shift();
        if (copy.type === "health") {
          const key = `${copy.health.scope}:${copy.health.source}`;
          if (copy.health.message === null) health.delete(key);
          else health.set(key, copy.health);
        }
      }
      // oxlint-disable-next-line unicorn/no-useless-spread -- callbacks can attach or detach listeners
      for (const listener of [...listeners]) deliver(listener, copy);
    },
    fail(cause: unknown) {
      // oxlint-disable-next-line unicorn/no-useless-spread -- callbacks can attach or detach listeners
      for (const listener of [...listeners]) listener.onFailure(cause);
    },
    subscribe(
      input: { cursor: NotificationCursor | null },
      onFrame: Listener["onFrame"],
      onFailure: Listener["onFailure"],
    ) {
      const listener = { onFrame, onFailure };
      listeners.add(listener);
      if (cursor) {
        const requested = input.cursor;
        const reason = notificationReplayReason(requested, cursor, recent[0]?.cursor.sequence);
        deliver(listener, {
          type: "attached",
          reason,
          cursor: reason === "replay" && requested ? requested : cursor,
          health: [...health.values()],
        });
        if (reason === "replay" && requested) {
          for (const frame of recent) {
            if (!listeners.has(listener)) break;
            if (frame.cursor.sequence > requested.sequence) deliver(listener, frame);
          }
        }
      }
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

type NotificationFrameRelay = {
  hasListeners(): boolean;
  accept(frame: NotificationStreamFrame): void;
  fail(cause: unknown): void;
  subscribe(
    input: { cursor: NotificationCursor | null },
    onFrame: Listener["onFrame"],
    onFailure: Listener["onFailure"],
  ): () => void;
};

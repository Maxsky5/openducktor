import {
  extractThreadIdFromParams,
  parseNotificationRecord,
  parseServerRequestRecord,
} from "./codex-app-server-requests";
import {
  type CodexLiveEventPump,
  isPlainObject,
  MAX_CODEX_BUFFERED_THREAD_COUNT,
  MAX_CODEX_EVENT_BACKLOG_PER_SESSION,
  trimOldestMapKeys,
} from "./codex-app-server-shared";
import type {
  CodexAppServerAdapterOptions,
  CodexNotificationRecord,
  CodexServerRequestRecord,
} from "./types";

export type CodexRuntimeStreamEvent = {
  runtimeId: string;
  kind: "notification" | "server_request";
  message: unknown;
};

export type BufferedCodexRuntimeEvent =
  | { kind: "notification"; notification: CodexNotificationRecord }
  | { kind: "server_request"; request: CodexServerRequestRecord };

export class CodexRuntimeEventBuffer {
  readonly notificationsByThreadId = new Map<string, CodexNotificationRecord[]>();
  readonly serverRequestsByThreadId = new Map<string, CodexServerRequestRecord[]>();

  takeNotifications(threadId: string): CodexNotificationRecord[] {
    const notifications = this.notificationsByThreadId.get(threadId) ?? [];
    this.notificationsByThreadId.delete(threadId);
    return notifications;
  }

  takeServerRequests(threadId: string): CodexServerRequestRecord[] {
    const requests = this.serverRequestsByThreadId.get(threadId) ?? [];
    this.serverRequestsByThreadId.delete(threadId);
    return requests;
  }

  clearSession(threadId: string): void {
    this.notificationsByThreadId.delete(threadId);
    this.serverRequestsByThreadId.delete(threadId);
  }

  bufferNotification(notification: CodexNotificationRecord): void {
    const threadId = extractThreadIdFromParams(notification.params);
    if (!threadId) {
      return;
    }
    this.bufferNotificationForThread(threadId, notification);
  }

  bufferRuntimeStreamEvent(
    threadId: string,
    event: Pick<CodexRuntimeStreamEvent, "kind" | "message">,
  ): BufferedCodexRuntimeEvent {
    if (event.kind === "notification") {
      const notification = parseNotificationRecord(event.message);
      this.bufferNotificationForThread(threadId, notification);
      return { kind: "notification", notification };
    }

    const request = parseServerRequestRecord(event.message);
    this.bufferServerRequestForThread(threadId, request);
    return { kind: "server_request", request };
  }

  private bufferNotificationForThread(threadId: string, notification: CodexNotificationRecord) {
    const buffered = this.notificationsByThreadId.get(threadId) ?? [];
    buffered.push(notification);
    this.trimAndStore(this.notificationsByThreadId, threadId, buffered);
  }

  private bufferServerRequestForThread(threadId: string, request: CodexServerRequestRecord) {
    const buffered = this.serverRequestsByThreadId.get(threadId) ?? [];
    buffered.push(request);
    this.trimAndStore(this.serverRequestsByThreadId, threadId, buffered);
  }

  private trimAndStore<T>(buffer: Map<string, T[]>, threadId: string, entries: T[]): void {
    if (entries.length > MAX_CODEX_EVENT_BACKLOG_PER_SESSION) {
      entries.splice(0, entries.length - MAX_CODEX_EVENT_BACKLOG_PER_SESSION);
    }
    buffer.set(threadId, entries);
    trimOldestMapKeys(buffer, MAX_CODEX_BUFFERED_THREAD_COUNT);
  }
}

export class CodexRuntimeEventSubscriptions {
  private readonly pumpsByRuntimeId = new Map<string, CodexLiveEventPump>();

  constructor(private readonly subscribeEvents: CodexAppServerAdapterOptions["subscribeEvents"]) {}

  ensure(runtimeId: string, onEvent: (event: CodexRuntimeStreamEvent) => void): Promise<void> {
    if (!this.subscribeEvents) {
      return Promise.resolve();
    }
    const existing = this.pumpsByRuntimeId.get(runtimeId);
    if (existing) {
      return existing.ready;
    }

    const pump: CodexLiveEventPump = {
      unsubscribe: null,
      ready: Promise.resolve(),
    };
    this.pumpsByRuntimeId.set(runtimeId, pump);
    const unsubscribe = this.subscribeEvents(runtimeId, (event) => {
      if (event.runtimeId !== runtimeId) {
        return;
      }
      onEvent(event);
    });

    if (typeof (unsubscribe as Promise<() => void>).then === "function") {
      pump.ready = (async () => {
        try {
          const resolved = await (unsubscribe as Promise<() => void>);
          if (this.pumpsByRuntimeId.get(runtimeId) !== pump) {
            resolved();
            return;
          }
          pump.unsubscribe = resolved;
        } catch (error) {
          if (this.pumpsByRuntimeId.get(runtimeId) === pump) {
            this.pumpsByRuntimeId.delete(runtimeId);
          }
          throw error;
        }
      })();
      return pump.ready;
    }

    pump.unsubscribe = unsubscribe as () => void;
    return pump.ready;
  }

  stop(runtimeId: string): void {
    const pump = this.pumpsByRuntimeId.get(runtimeId);
    if (!pump) {
      return;
    }
    pump.unsubscribe?.();
    this.pumpsByRuntimeId.delete(runtimeId);
  }
}

export const threadIdFromRuntimeStreamEvent = (
  event: Pick<CodexRuntimeStreamEvent, "message">,
): string | null => {
  if (!isPlainObject(event.message)) {
    return null;
  }
  return extractThreadIdFromParams(event.message.params);
};

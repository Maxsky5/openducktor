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
  receivedAt: string;
  message: unknown;
};

export type BufferedCodexServerRequest = {
  request: CodexServerRequestRecord;
  receivedAt: string;
};

export type BufferedCodexRuntimeEvent =
  | { kind: "notification"; notification: CodexNotificationRecord }
  | {
      kind: "server_request";
      runtimeId: string;
      request: CodexServerRequestRecord;
      receivedAt: string;
    };

export class CodexRuntimeEventBuffer {
  readonly notificationsByRuntimeId = new Map<string, Map<string, CodexNotificationRecord[]>>();
  readonly serverRequestsByRuntimeId = new Map<string, Map<string, BufferedCodexServerRequest[]>>();

  takeNotifications(threadId: string, runtimeId: string): CodexNotificationRecord[] {
    const notificationsByThreadId = this.notificationsByRuntimeId.get(runtimeId);
    const notifications = notificationsByThreadId?.get(threadId) ?? [];
    notificationsByThreadId?.delete(threadId);
    if (notificationsByThreadId?.size === 0) {
      this.notificationsByRuntimeId.delete(runtimeId);
    }
    return notifications;
  }

  takeServerRequests(threadId: string, runtimeId?: string): BufferedCodexServerRequest[] {
    if (runtimeId) {
      return this.takeServerRequestsForRuntime(threadId, runtimeId);
    }

    const requests: BufferedCodexServerRequest[] = [];
    for (const runtime of [...this.serverRequestsByRuntimeId.keys()]) {
      requests.push(...this.takeServerRequestsForRuntime(threadId, runtime));
    }
    return requests;
  }

  private takeServerRequestsForRuntime(
    threadId: string,
    runtimeId: string,
  ): BufferedCodexServerRequest[] {
    const requestsByThreadId = this.serverRequestsByRuntimeId.get(runtimeId);
    const requests = requestsByThreadId?.get(threadId) ?? [];
    requestsByThreadId?.delete(threadId);
    if (requestsByThreadId?.size === 0) {
      this.serverRequestsByRuntimeId.delete(runtimeId);
    }
    return requests;
  }

  hasServerRequests(threadId: string, runtimeId?: string): boolean {
    if (runtimeId) {
      return Boolean(this.serverRequestsByRuntimeId.get(runtimeId)?.has(threadId));
    }
    for (const requestsByThreadId of this.serverRequestsByRuntimeId.values()) {
      if (requestsByThreadId.has(threadId)) {
        return true;
      }
    }
    return false;
  }

  clearSession(threadId: string, runtimeId?: string): void {
    if (runtimeId) {
      this.takeNotifications(threadId, runtimeId);
      this.takeServerRequestsForRuntime(threadId, runtimeId);
      return;
    }
    for (const runtime of [...this.notificationsByRuntimeId.keys()]) {
      this.takeNotifications(threadId, runtime);
    }
    for (const runtime of [...this.serverRequestsByRuntimeId.keys()]) {
      this.takeServerRequestsForRuntime(threadId, runtime);
    }
  }

  bufferNotification(runtimeId: string, notification: CodexNotificationRecord): void {
    const threadId = extractThreadIdFromParams(notification.params);
    if (!threadId) {
      return;
    }
    this.bufferNotificationForThread(threadId, runtimeId, notification);
  }

  bufferRuntimeStreamEvent(
    threadId: string,
    event: Pick<CodexRuntimeStreamEvent, "runtimeId" | "kind" | "receivedAt" | "message">,
  ): BufferedCodexRuntimeEvent {
    if (event.kind === "notification") {
      const notification = parseNotificationRecord(event.message, event.receivedAt);
      this.bufferNotificationForThread(threadId, event.runtimeId, notification);
      return { kind: "notification", notification };
    }

    const request = parseServerRequestRecord(event.message);
    this.bufferServerRequestForThread(threadId, event.runtimeId, {
      request,
      receivedAt: event.receivedAt,
    });
    return {
      kind: "server_request",
      runtimeId: event.runtimeId,
      request,
      receivedAt: event.receivedAt,
    };
  }

  private bufferNotificationForThread(
    threadId: string,
    runtimeId: string,
    notification: CodexNotificationRecord,
  ) {
    const notificationsByThreadId = this.notificationsByRuntimeId.get(runtimeId) ?? new Map();
    const buffered = notificationsByThreadId.get(threadId) ?? [];
    buffered.push(notification);
    this.trimAndStore(notificationsByThreadId, threadId, buffered);
    this.notificationsByRuntimeId.set(runtimeId, notificationsByThreadId);
    trimOldestMapKeys(this.notificationsByRuntimeId, MAX_CODEX_BUFFERED_THREAD_COUNT);
  }

  private bufferServerRequestForThread(
    threadId: string,
    runtimeId: string,
    request: BufferedCodexServerRequest,
  ) {
    const requestsByThreadId = this.serverRequestsByRuntimeId.get(runtimeId) ?? new Map();
    const buffered = requestsByThreadId.get(threadId) ?? [];
    buffered.push(request);
    this.trimAndStore(requestsByThreadId, threadId, buffered);
    this.serverRequestsByRuntimeId.set(runtimeId, requestsByThreadId);
    trimOldestMapKeys(this.serverRequestsByRuntimeId, MAX_CODEX_BUFFERED_THREAD_COUNT);
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
    let unsubscribe: (() => void) | Promise<() => void>;
    try {
      unsubscribe = this.subscribeEvents(runtimeId, (event) => {
        if (event.runtimeId !== runtimeId) {
          return;
        }
        onEvent(event);
      });
    } catch (error) {
      if (this.pumpsByRuntimeId.get(runtimeId) === pump) {
        this.pumpsByRuntimeId.delete(runtimeId);
      }
      throw error;
    }

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

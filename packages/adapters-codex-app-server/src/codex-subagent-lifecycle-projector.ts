import type { AgentEvent } from "@openducktor/core";
import { extractThreadIdFromParams } from "./codex-app-server-requests";
import {
  MAX_CODEX_BUFFERED_THREAD_COUNT,
  MAX_CODEX_EVENT_BACKLOG_PER_SESSION,
  trimOldestMapKeys,
} from "./codex-app-server-shared";
import type { CodexSessionLookup } from "./codex-local-session-state";
import { codexSubagentLifecycleUpdateFromNotification } from "./codex-subagent-lifecycle";
import type { CodexSubagentLinkState, CodexSubagentRoute } from "./codex-subagent-link-state";
import type { CodexNotificationRecord, CodexSessionState } from "./types";

type CodexSubagentLifecycleProjectorDeps = {
  sessions: CodexSessionLookup;
  subagents: CodexSubagentLinkState;
  emitParentSessionEvent: (externalSessionId: string, event: AgentEvent) => void;
};

export class CodexSubagentLifecycleProjector {
  private readonly projectedNotifications = new WeakSet<CodexNotificationRecord>();
  private readonly bufferedNotificationsByRuntimeId = new Map<
    string,
    Map<string, CodexNotificationRecord[]>
  >();

  constructor(private readonly deps: CodexSubagentLifecycleProjectorDeps) {}

  projectBufferedForParent(parentSession: CodexSessionState): void {
    for (const route of this.deps.subagents.routesForParent(
      parentSession.threadId,
      parentSession.runtimeId,
    )) {
      this.projectBufferedRoute(route);
    }
  }

  projectBufferedRoute(route: CodexSubagentRoute): void {
    const parentSession = this.deps.sessions.get(route.parentExternalSessionId);
    if (!parentSession) {
      return;
    }
    const runtimeId = route.runtimeId ?? parentSession.runtimeId;
    const notifications =
      this.bufferedNotificationsByRuntimeId.get(runtimeId)?.get(route.childExternalSessionId) ?? [];
    for (const notification of notifications) {
      if (!this.projectLinkedNotification(runtimeId, notification, route)) {
        return;
      }
    }
    this.deleteBufferedNotifications(runtimeId, route.childExternalSessionId);
  }

  projectNotification(runtimeId: string, notification: CodexNotificationRecord): void {
    if (this.projectedNotifications.has(notification)) {
      return;
    }
    if (notification.method !== "turn/started" && notification.method !== "turn/completed") {
      return;
    }
    const childThreadId = extractThreadIdFromParams(notification.params);
    if (!childThreadId) {
      throw new Error(`Codex ${notification.method} notification is missing threadId.`);
    }
    const route = this.deps.subagents.routeForChild(childThreadId, runtimeId);
    if (!route) {
      this.bufferNotification(runtimeId, childThreadId, notification);
      return;
    }
    if (!this.projectLinkedNotification(runtimeId, notification, route)) {
      this.bufferNotification(runtimeId, childThreadId, notification);
    }
  }

  clearSession(threadId: string, runtimeId?: string): void {
    if (runtimeId) {
      this.deleteBufferedNotifications(runtimeId, threadId);
      return;
    }
    for (const bufferedRuntimeId of [...this.bufferedNotificationsByRuntimeId.keys()]) {
      this.deleteBufferedNotifications(bufferedRuntimeId, threadId);
    }
  }

  private projectLinkedNotification(
    runtimeId: string,
    notification: CodexNotificationRecord,
    route: CodexSubagentRoute,
  ): boolean {
    if (this.projectedNotifications.has(notification)) {
      return true;
    }
    const childThreadId = extractThreadIdFromParams(notification.params);
    if (!childThreadId) {
      throw new Error(`Codex ${notification.method} notification is missing threadId.`);
    }
    const update = codexSubagentLifecycleUpdateFromNotification(notification);
    if (!update) {
      this.projectedNotifications.add(notification);
      return true;
    }
    if (route.runtimeId && route.runtimeId !== runtimeId) {
      throw new Error(
        `Cannot project Codex subagent lifecycle for thread '${childThreadId}' from runtime '${runtimeId}' because its route belongs to runtime '${route.runtimeId}'.`,
      );
    }
    const parentSession = this.deps.sessions.get(route.parentExternalSessionId);
    if (!parentSession) {
      return false;
    }
    if (parentSession.runtimeId !== runtimeId) {
      throw new Error(
        `Cannot project Codex subagent lifecycle for thread '${childThreadId}' because parent '${parentSession.threadId}' belongs to runtime '${parentSession.runtimeId}', not '${runtimeId}'.`,
      );
    }
    const previousStatus = this.deps.subagents.statusForChild(childThreadId, runtimeId);
    const part = this.deps.subagents.upsertLink({
      runtimeId,
      parentThreadId: route.parentExternalSessionId,
      childThreadId,
      itemId: childThreadId,
      status: update.status,
      ...(update.error ? { error: update.error } : {}),
      allowStatusRestart: update.allowStatusRestart,
    });
    this.projectedNotifications.add(notification);
    if (part.status === previousStatus) {
      return true;
    }
    const isTerminal =
      part.status === "completed" || part.status === "cancelled" || part.status === "error";
    this.deps.emitParentSessionEvent(parentSession.threadId, {
      type: "assistant_part",
      externalSessionId: parentSession.threadId,
      timestamp: new Date(update.timestampMs).toISOString(),
      part: {
        ...part,
        ...(isTerminal ? { endedAtMs: update.timestampMs } : { startedAtMs: update.timestampMs }),
      },
    });
    return true;
  }

  private bufferNotification(
    runtimeId: string,
    childThreadId: string,
    notification: CodexNotificationRecord,
  ): void {
    const notificationsByThreadId =
      this.bufferedNotificationsByRuntimeId.get(runtimeId) ?? new Map();
    const notifications = notificationsByThreadId.get(childThreadId) ?? [];
    if (!notifications.includes(notification)) {
      notifications.push(notification);
    }
    if (notifications.length > MAX_CODEX_EVENT_BACKLOG_PER_SESSION) {
      notifications.splice(0, notifications.length - MAX_CODEX_EVENT_BACKLOG_PER_SESSION);
    }
    notificationsByThreadId.set(childThreadId, notifications);
    trimOldestMapKeys(notificationsByThreadId, MAX_CODEX_BUFFERED_THREAD_COUNT);
    this.bufferedNotificationsByRuntimeId.set(runtimeId, notificationsByThreadId);
    trimOldestMapKeys(this.bufferedNotificationsByRuntimeId, MAX_CODEX_BUFFERED_THREAD_COUNT);
  }

  private deleteBufferedNotifications(runtimeId: string, childThreadId: string): void {
    const notificationsByThreadId = this.bufferedNotificationsByRuntimeId.get(runtimeId);
    notificationsByThreadId?.delete(childThreadId);
    if (notificationsByThreadId?.size === 0) {
      this.bufferedNotificationsByRuntimeId.delete(runtimeId);
    }
  }
}

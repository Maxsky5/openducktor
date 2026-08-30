import type { AgentEvent } from "@openducktor/core";
import { codexNotificationThreadId } from "./codex-app-server-requests";
import { MAX_CODEX_BUFFERED_THREAD_COUNT, trimOldestMapKeys } from "./codex-app-server-shared";
import type { CodexSessionLookup } from "./codex-local-session-state";
import {
  type CodexSubagentLifecycleUpdate,
  codexSubagentLifecycleUpdateFromNotification,
} from "./codex-subagent-lifecycle";
import type {
  CodexSubagentLinkInput,
  CodexSubagentLinkState,
  CodexSubagentRoute,
} from "./codex-subagent-link-state";
import type { CodexNotificationRecord, CodexSessionState } from "./types";

type CodexSubagentLifecycleProjectorDeps = {
  sessions: CodexSessionLookup;
  subagents: CodexSubagentLinkState;
  emitParentSessionEvent: (externalSessionId: string, event: AgentEvent) => void;
};

const LIFECYCLE_STATUS_PRECEDENCE = {
  pending: 0,
  running: 1,
  cancelled: 2,
  completed: 3,
  error: 4,
} satisfies Record<CodexSubagentLifecycleUpdate["status"], number>;

const isNewerLifecycleUpdate = (
  existing: CodexSubagentLifecycleUpdate,
  incoming: CodexSubagentLifecycleUpdate,
): boolean => {
  if (incoming.timestampMs !== existing.timestampMs) {
    return incoming.timestampMs > existing.timestampMs;
  }
  if (incoming.allowStatusRestart !== existing.allowStatusRestart) {
    return incoming.allowStatusRestart;
  }
  return (
    LIFECYCLE_STATUS_PRECEDENCE[incoming.status] >= LIFECYCLE_STATUS_PRECEDENCE[existing.status]
  );
};

const hasLifecycleStatus = (notification: CodexNotificationRecord): boolean => {
  if (notification.method !== "turn/started" && notification.method !== "turn/completed") {
    return false;
  }
  return notification.params.turn.status.length > 0;
};

export class CodexSubagentLifecycleProjector {
  private readonly pendingLifecycleByRuntimeId = new Map<
    string,
    Map<string, CodexSubagentLifecycleUpdate>
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
    const update = this.pendingLifecycleByRuntimeId
      .get(runtimeId)
      ?.get(route.childExternalSessionId);
    if (!update) {
      return;
    }
    if (this.projectLifecycleUpdate(runtimeId, route.childExternalSessionId, update, route)) {
      this.deletePendingLifecycle(runtimeId, route.childExternalSessionId);
    }
  }

  projectNotification(runtimeId: string, notification: CodexNotificationRecord): void {
    if (notification.method !== "turn/started" && notification.method !== "turn/completed") {
      return;
    }
    const childThreadId = codexNotificationThreadId(notification);
    if (!childThreadId) {
      throw new Error(`Codex ${notification.method} notification is missing threadId.`);
    }
    const route = this.deps.subagents.routeForChild(childThreadId, runtimeId);
    if (!route && !hasLifecycleStatus(notification)) {
      return;
    }
    const update = codexSubagentLifecycleUpdateFromNotification(notification);
    if (!update) {
      return;
    }
    if (!route) {
      this.rememberPendingLifecycle(runtimeId, childThreadId, update);
      return;
    }
    if (!this.projectLifecycleUpdate(runtimeId, childThreadId, update, route)) {
      this.rememberPendingLifecycle(runtimeId, childThreadId, update);
    }
  }

  clearSession(threadId: string, runtimeId?: string): void {
    if (runtimeId) {
      this.deletePendingLifecycle(runtimeId, threadId);
      return;
    }
    for (const pendingRuntimeId of this.pendingLifecycleByRuntimeId.keys()) {
      this.deletePendingLifecycle(pendingRuntimeId, threadId);
    }
  }

  clearRuntime(runtimeId: string): void {
    this.pendingLifecycleByRuntimeId.delete(runtimeId);
  }

  private projectLifecycleUpdate(
    runtimeId: string,
    childThreadId: string,
    update: CodexSubagentLifecycleUpdate,
    route: CodexSubagentRoute,
  ): boolean {
    if (route.runtimeId && route.runtimeId !== runtimeId) {
      throw new Error(
        `Cannot project Codex subagent lifecycle for thread '${childThreadId}' from runtime '${runtimeId}' because its route belongs to runtime '${route.runtimeId}'.`,
      );
    }
    const parentSession = this.deps.sessions.get(route.parentExternalSessionId);
    if (parentSession && parentSession.runtimeId !== runtimeId) {
      throw new Error(
        `Cannot project Codex subagent lifecycle for thread '${childThreadId}' because parent '${parentSession.threadId}' belongs to runtime '${parentSession.runtimeId}', not '${runtimeId}'.`,
      );
    }
    const previousStatus = this.deps.subagents.statusForChild(childThreadId, runtimeId);
    const linkInput: CodexSubagentLinkInput = {
      runtimeId,
      parentThreadId: route.parentExternalSessionId,
      childThreadId,
      itemId: childThreadId,
      status: update.status,
      allowStatusRestart: update.allowStatusRestart,
    };
    if (update.error) {
      linkInput.error = update.error;
    }
    if (update.status === "running") {
      linkInput.startedAtMs = update.timestampMs;
    } else {
      linkInput.endedAtMs = update.timestampMs;
    }
    const part = this.deps.subagents.upsertLink(linkInput);
    if (!parentSession) {
      return false;
    }
    const isTerminal =
      part.status === "completed" || part.status === "cancelled" || part.status === "error";
    const isSameTerminalLifecycle = isTerminal && part.status === update.status;
    if (part.status === previousStatus && !isSameTerminalLifecycle) {
      return true;
    }
    this.deps.emitParentSessionEvent(parentSession.threadId, {
      type: "assistant_part",
      externalSessionId: parentSession.threadId,
      timestamp: new Date(update.timestampMs).toISOString(),
      part,
    });
    return true;
  }

  private rememberPendingLifecycle(
    runtimeId: string,
    childThreadId: string,
    update: CodexSubagentLifecycleUpdate,
  ): void {
    const lifecycleByThreadId = this.pendingLifecycleByRuntimeId.get(runtimeId) ?? new Map();
    const existing = lifecycleByThreadId.get(childThreadId);
    if (!existing || isNewerLifecycleUpdate(existing, update)) {
      lifecycleByThreadId.set(childThreadId, update);
    }
    trimOldestMapKeys(lifecycleByThreadId, MAX_CODEX_BUFFERED_THREAD_COUNT);
    this.pendingLifecycleByRuntimeId.set(runtimeId, lifecycleByThreadId);
    trimOldestMapKeys(this.pendingLifecycleByRuntimeId, MAX_CODEX_BUFFERED_THREAD_COUNT);
  }

  private deletePendingLifecycle(runtimeId: string, childThreadId: string): void {
    const lifecycleByThreadId = this.pendingLifecycleByRuntimeId.get(runtimeId);
    lifecycleByThreadId?.delete(childThreadId);
    if (lifecycleByThreadId?.size === 0) {
      this.pendingLifecycleByRuntimeId.delete(runtimeId);
    }
  }
}

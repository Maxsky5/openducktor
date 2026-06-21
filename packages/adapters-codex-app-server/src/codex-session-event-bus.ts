import type { AgentEvent, EventUnsubscribe } from "@openducktor/core";
import { MAX_CODEX_EVENT_BACKLOG_PER_SESSION } from "./codex-app-server-shared";

type AgentEventListener = (event: AgentEvent) => void;

export class CodexSessionEventBus {
  private readonly listenersBySessionId = new Map<string, Set<AgentEventListener>>();
  private readonly eventBacklogBySessionId = new Map<string, AgentEvent[]>();

  subscribe(externalSessionId: string, listener: AgentEventListener): EventUnsubscribe {
    const listeners = this.listenersBySessionId.get(externalSessionId) ?? new Set();
    listeners.add(listener);
    this.listenersBySessionId.set(externalSessionId, listeners);
    this.replayBacklog(externalSessionId, listener);

    return () => {
      const current = this.listenersBySessionId.get(externalSessionId);
      current?.delete(listener);
      if (current?.size === 0) {
        this.listenersBySessionId.delete(externalSessionId);
      }
    };
  }

  emit(externalSessionId: string, event: AgentEvent): void {
    const listeners = this.listenersBySessionId.get(externalSessionId);
    if (!listeners) {
      this.buffer(externalSessionId, event);
      return;
    }

    for (const listener of listeners) {
      listener(event);
    }
  }

  clear(externalSessionId: string): void {
    this.listenersBySessionId.delete(externalSessionId);
    this.eventBacklogBySessionId.delete(externalSessionId);
  }

  private buffer(externalSessionId: string, event: AgentEvent): void {
    if (event.type === "approval_required" || event.type === "question_required") {
      return;
    }

    const backlog = this.eventBacklogBySessionId.get(externalSessionId) ?? [];
    backlog.push(event);
    if (backlog.length > MAX_CODEX_EVENT_BACKLOG_PER_SESSION) {
      backlog.splice(0, backlog.length - MAX_CODEX_EVENT_BACKLOG_PER_SESSION);
    }
    this.eventBacklogBySessionId.set(externalSessionId, backlog);
  }

  private replayBacklog(externalSessionId: string, listener: AgentEventListener): void {
    const backlog = this.eventBacklogBySessionId.get(externalSessionId);
    if (!backlog) {
      return;
    }

    this.eventBacklogBySessionId.delete(externalSessionId);
    for (const event of backlog) {
      listener(event);
    }
  }
}

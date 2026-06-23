import {
  type AgentEvent,
  type AgentSessionRef,
  agentSessionRefKey,
  type EventUnsubscribe,
} from "@openducktor/core";
import { MAX_CODEX_EVENT_BACKLOG_PER_SESSION } from "./codex-app-server-shared";

type AgentEventListener = (event: AgentEvent) => void;

export class CodexSessionEventBus {
  private readonly listenersBySessionKey = new Map<string, Set<AgentEventListener>>();
  private readonly eventBacklogBySessionKey = new Map<string, AgentEvent[]>();

  subscribe(sessionRef: AgentSessionRef, listener: AgentEventListener): EventUnsubscribe {
    const sessionKey = agentSessionRefKey(sessionRef);
    const listeners = this.listenersBySessionKey.get(sessionKey) ?? new Set();
    listeners.add(listener);
    this.listenersBySessionKey.set(sessionKey, listeners);
    this.replayBacklog(sessionKey, listener);

    return () => {
      const current = this.listenersBySessionKey.get(sessionKey);
      current?.delete(listener);
      if (current?.size === 0) {
        this.listenersBySessionKey.delete(sessionKey);
      }
    };
  }

  emit(sessionRef: AgentSessionRef, event: AgentEvent): void {
    const sessionKey = agentSessionRefKey(sessionRef);
    const listeners = this.listenersBySessionKey.get(sessionKey);
    if (!listeners) {
      this.buffer(sessionKey, event);
      return;
    }

    for (const listener of listeners) {
      listener(event);
    }
  }

  clear(sessionRef: AgentSessionRef): void {
    const sessionKey = agentSessionRefKey(sessionRef);
    this.listenersBySessionKey.delete(sessionKey);
    this.eventBacklogBySessionKey.delete(sessionKey);
  }

  private buffer(sessionKey: string, event: AgentEvent): void {
    if (event.type === "approval_required" || event.type === "question_required") {
      return;
    }

    const backlog = this.eventBacklogBySessionKey.get(sessionKey) ?? [];
    backlog.push(event);
    if (backlog.length > MAX_CODEX_EVENT_BACKLOG_PER_SESSION) {
      backlog.splice(0, backlog.length - MAX_CODEX_EVENT_BACKLOG_PER_SESSION);
    }
    this.eventBacklogBySessionKey.set(sessionKey, backlog);
  }

  private replayBacklog(sessionKey: string, listener: AgentEventListener): void {
    const backlog = this.eventBacklogBySessionKey.get(sessionKey);
    if (!backlog) {
      return;
    }

    this.eventBacklogBySessionKey.delete(sessionKey);
    for (const event of backlog) {
      listener(event);
    }
  }
}

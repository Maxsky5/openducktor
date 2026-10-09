import {
  type AgentEvent,
  agentSessionRefKey,
  type EventUnsubscribe,
  type SessionRef,
  withAgentSessionRef,
} from "@openducktor/core";
import { codexSessionRef } from "./codex-session-ref";
import type { CodexSessionState } from "./types";

type AgentEventListener = (event: AgentEvent) => void;

export class CodexSessionEventBus {
  private readonly listenersBySessionKey = new Map<string, Set<AgentEventListener>>();

  publish(session: CodexSessionState, event: AgentEvent): AgentEvent {
    const sessionRef = codexSessionRef(session);
    const sessionEvent = withAgentSessionRef(sessionRef, event);
    session.firstTurnHistory?.record(sessionEvent, session.model);
    this.emit(sessionRef, sessionEvent);
    return sessionEvent;
  }

  subscribe(sessionRef: SessionRef, listener: AgentEventListener): EventUnsubscribe {
    const sessionKey = agentSessionRefKey(sessionRef);
    const listeners = this.listenersBySessionKey.get(sessionKey) ?? new Set();
    listeners.add(listener);
    this.listenersBySessionKey.set(sessionKey, listeners);

    return () => {
      const current = this.listenersBySessionKey.get(sessionKey);
      current?.delete(listener);
      if (current?.size === 0) {
        this.listenersBySessionKey.delete(sessionKey);
      }
    };
  }

  emit(sessionRef: SessionRef, event: AgentEvent): void {
    const sessionKey = agentSessionRefKey(sessionRef);
    const listeners = this.listenersBySessionKey.get(sessionKey);
    if (!listeners) {
      return;
    }

    const deliveryErrors: unknown[] = [];
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        deliveryErrors.push(error);
      }
    }
    if (deliveryErrors.length > 0) {
      throw deliveryErrors[0];
    }
  }

  clear(sessionRef: SessionRef): void {
    const sessionKey = agentSessionRefKey(sessionRef);
    this.listenersBySessionKey.delete(sessionKey);
  }
}

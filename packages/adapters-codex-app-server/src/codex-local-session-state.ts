import type { CodexSessionState } from "./types";

export type CodexSessionLookup = {
  get(externalSessionId: string): CodexSessionState | undefined;
  values(): IterableIterator<CodexSessionState>;
};

type CodexLocalSessionStateDeps = {
  sessionEvents: { clear(externalSessionId: string): void };
  activeTurnsBySessionId: { delete(externalSessionId: string): boolean };
  pendingInput: { clearSession(externalSessionId: string): void };
  runtimeEvents: {
    clearSession(externalSessionId: string): void;
    drainBufferedStreamEvents(externalSessionId: string): Promise<void>;
    stopRuntimeEventSubscription(runtimeId: string): void;
  };
};

export class CodexLocalSessionState implements CodexSessionLookup {
  private readonly sessions = new Map<string, CodexSessionState>();

  constructor(private readonly deps: CodexLocalSessionStateDeps) {}

  get(externalSessionId: string): CodexSessionState | undefined {
    return this.sessions.get(externalSessionId);
  }

  has(externalSessionId: string): boolean {
    return this.sessions.has(externalSessionId);
  }

  remember(session: CodexSessionState): void {
    this.sessions.set(session.threadId, session);
    void this.deps.runtimeEvents.drainBufferedStreamEvents(session.threadId);
  }

  values(): IterableIterator<CodexSessionState> {
    return this.sessions.values();
  }

  release(externalSessionId: string): CodexSessionState | undefined {
    const session = this.clearSessionState(externalSessionId);
    if (session && !this.hasRuntimeSession(session.runtimeId)) {
      this.deps.runtimeEvents.stopRuntimeEventSubscription(session.runtimeId);
    }
    return session;
  }

  private clearSessionState(externalSessionId: string): CodexSessionState | undefined {
    const session = this.sessions.get(externalSessionId);
    this.sessions.delete(externalSessionId);
    this.deps.sessionEvents.clear(externalSessionId);
    this.deps.activeTurnsBySessionId.delete(externalSessionId);
    this.deps.pendingInput.clearSession(externalSessionId);
    this.deps.runtimeEvents.clearSession(externalSessionId);
    return session;
  }

  private hasRuntimeSession(runtimeId: string): boolean {
    for (const session of this.sessions.values()) {
      if (session.runtimeId === runtimeId) {
        return true;
      }
    }
    return false;
  }
}

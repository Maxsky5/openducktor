import type { CodexSessionState } from "./types";

type CodexLocalSessionStateDeps = {
  sessions: Map<string, CodexSessionState>;
  sessionEvents: { clear(externalSessionId: string): void };
  activeTurnsBySessionId: { delete(externalSessionId: string): boolean };
  pendingInput: { clearSession(externalSessionId: string): void };
  runtimeEvents: { clearSession(externalSessionId: string): void };
};

export class CodexLocalSessionState {
  constructor(private readonly deps: CodexLocalSessionStateDeps) {}

  get sessionsById(): Map<string, CodexSessionState> {
    return this.deps.sessions;
  }

  get(externalSessionId: string): CodexSessionState | undefined {
    return this.deps.sessions.get(externalSessionId);
  }

  has(externalSessionId: string): boolean {
    return this.deps.sessions.has(externalSessionId);
  }

  set(session: CodexSessionState): void {
    this.deps.sessions.set(session.threadId, session);
  }

  values(): IterableIterator<CodexSessionState> {
    return this.deps.sessions.values();
  }

  clear(externalSessionId: string): CodexSessionState | undefined {
    const session = this.deps.sessions.get(externalSessionId);
    this.deps.sessions.delete(externalSessionId);
    this.deps.sessionEvents.clear(externalSessionId);
    this.deps.activeTurnsBySessionId.delete(externalSessionId);
    this.deps.pendingInput.clearSession(externalSessionId);
    this.deps.runtimeEvents.clearSession(externalSessionId);
    return session;
  }

  hasRuntimeSession(runtimeId: string): boolean {
    for (const session of this.deps.sessions.values()) {
      if (session.runtimeId === runtimeId) {
        return true;
      }
    }
    return false;
  }
}

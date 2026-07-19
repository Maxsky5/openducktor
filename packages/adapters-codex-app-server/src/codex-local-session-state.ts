import type { CodexSessionState } from "./types";

export type CodexSessionLookup = {
  get(externalSessionId: string): CodexSessionState | undefined;
  values(): IterableIterator<CodexSessionState>;
};

type CodexLocalSessionStateDeps = {
  sessionEvents: { clear(session: CodexSessionState): void };
  activeTurnsBySessionId: { delete(externalSessionId: string): boolean };
  pendingInput: { clearSession(externalSessionId: string, runtimeId?: string): void };
  subagents: { clearSession(externalSessionId: string, runtimeId?: string): void };
  threadStatusOverrides: { clear(runtimeId: string, threadId: string): void };
  onLastRuntimeSessionReleased(runtimeId: string): void;
  runtimeEvents: {
    clearSession(externalSessionId: string, runtimeId?: string): void;
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
  }

  values(): IterableIterator<CodexSessionState> {
    return this.sessions.values();
  }

  release(externalSessionId: string): CodexSessionState | undefined {
    const session = this.clearSessionState(externalSessionId);
    if (session && !this.hasRuntimeSession(session.runtimeId)) {
      this.deps.onLastRuntimeSessionReleased(session.runtimeId);
    }
    return session;
  }

  releaseRuntime(runtimeId: string): CodexSessionState[] {
    const released: CodexSessionState[] = [];
    for (const session of [...this.sessions.values()]) {
      if (session.runtimeId !== runtimeId) {
        continue;
      }
      const cleared = this.clearSessionState(session.threadId);
      if (cleared) {
        released.push(cleared);
      }
    }
    return released;
  }

  private clearSessionState(externalSessionId: string): CodexSessionState | undefined {
    const session = this.sessions.get(externalSessionId);
    this.sessions.delete(externalSessionId);
    if (session) {
      this.deps.threadStatusOverrides.clear(session.runtimeId, session.threadId);
      this.deps.sessionEvents.clear(session);
    }
    this.deps.activeTurnsBySessionId.delete(externalSessionId);
    this.deps.pendingInput.clearSession(externalSessionId, session?.runtimeId);
    this.deps.subagents.clearSession(externalSessionId, session?.runtimeId);
    this.deps.runtimeEvents.clearSession(externalSessionId, session?.runtimeId);
    return session;
  }

  hasRuntimeSession(runtimeId: string): boolean {
    for (const session of this.sessions.values()) {
      if (session.runtimeId === runtimeId) {
        return true;
      }
    }
    return false;
  }
}

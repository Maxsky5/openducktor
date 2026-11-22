import type { SessionNotification, SessionUpdate } from "@agentclientprotocol/sdk/unstable";
import type { AgentSessionLiveRef, AgentSessionLiveSnapshot } from "@openducktor/contracts";
import type { AntigravityClientHandlers } from "./antigravity-acp-process";
import type { AntigravityLiveSession } from "./antigravity-live-session";
import { readElicitationSessionId } from "./antigravity-native-payloads";

/**
 * A native session that the runtime does not show as a live session: a history read or a text
 * generation. Its updates go to `applyUpdate`, and `refuse` ends it when the runtime asks for a
 * tool or for input.
 */
export type AntigravitySideSession = {
  readonly applyUpdate: (update: SessionUpdate) => void;
  readonly refuse: () => void;
};

/**
 * The sessions that one `agy acp` process holds, by native session ID and by caller binding. It
 * routes every update and agent request by `sessionId`, orders the operations of each session, and
 * keeps updates that arrive before `session/new` or `session/load` returns the session.
 */
export class AntigravitySessionRegistry {
  private readonly sessionsById = new Map<string, AntigravityLiveSession>();
  private readonly sessionIdsByBinding = new Map<string, string>();
  private readonly sideSessions = new Map<string, AntigravitySideSession>();
  private readonly gates = new Map<string, Promise<unknown>>();
  private readonly earlyUpdates = new Map<string, SessionNotification[]>();
  private openingSessions = 0;

  /** What the shared process asks of OpenDucktor, routed to the exact session. */
  readonly handlers: AntigravityClientHandlers = {
    sessionUpdate: (notification) => this.routeUpdate(notification),
    requestPermission: (params, signal) =>
      this.requestTarget(params.sessionId)?.handlePermission(params, signal) ??
      Promise.resolve({ outcome: { outcome: "cancelled" } }),
    createElicitation: (params, signal) =>
      this.requestTarget(readElicitationSessionId(params))?.handleElicitation(params, signal) ??
      Promise.resolve({ action: "decline" }),
  };

  /** Runs `run` while the updates and requests of the native session go to `sideSession`. */
  async withSideSession<Result>(
    sessionId: string,
    sideSession: AntigravitySideSession,
    run: () => Promise<Result>,
  ): Promise<Result> {
    this.sideSessions.set(sessionId, sideSession);
    try {
      return await run();
    } finally {
      this.sideSessions.delete(sessionId);
    }
  }

  private routeUpdate(notification: SessionNotification): void {
    const sideSession = this.sideSessions.get(notification.sessionId);
    if (sideSession) {
      sideSession.applyUpdate(notification.update);
      return;
    }
    const session = this.sessionsById.get(notification.sessionId);
    if (session) session.applyUpdate(notification.update);
    else this.keepEarlyUpdate(notification);
  }

  /** The live session that answers a native request. A side session refuses the request. */
  private requestTarget(sessionId: string | null): AntigravityLiveSession | null {
    if (sessionId === null) return null;
    const session = this.sessionsById.get(sessionId);
    if (session && !session.loading) return session;
    this.sideSessions.get(sessionId)?.refuse();
    return null;
  }

  get(sessionId: string): AntigravityLiveSession | undefined {
    return this.sessionsById.get(sessionId);
  }

  values(): AntigravityLiveSession[] {
    return [...this.sessionsById.values()];
  }

  /** The snapshots of the open sessions. A session in setup is not open. */
  snapshots(): AgentSessionLiveSnapshot[] {
    return this.values()
      .filter((session) => !session.loading)
      .map((session) => session.snapshot());
  }

  /** True when the runtime holds the session with an open prompt. ACP has no status read. */
  hasRunningTurn(sessionId: string): boolean {
    return this.sessionsById.get(sessionId)?.running === true;
  }

  /** The open session with this exact ref. A session that `session/load` still replays is not open. */
  find(ref: AgentSessionLiveRef): AntigravityLiveSession | null {
    const session = this.sessionsById.get(ref.externalSessionId);
    return session &&
      !session.loading &&
      session.ref.repoPath === ref.repoPath &&
      session.ref.workingDirectory === ref.workingDirectory
      ? session
      : null;
  }

  require(ref: AgentSessionLiveRef): AntigravityLiveSession {
    const session = this.find(ref);
    if (!session) {
      throw new Error(
        `Antigravity session '${ref.externalSessionId}' is not open in this runtime. Open the session again, then retry.`,
      );
    }
    return session;
  }

  /** Fails when the runtime holds this native session under another workspace or directory. */
  assertNotHeldElsewhere(ref: AgentSessionLiveRef): void {
    const held = this.sessionsById.get(ref.externalSessionId);
    if (
      held &&
      (held.ref.repoPath !== ref.repoPath || held.ref.workingDirectory !== ref.workingDirectory)
    ) {
      throw new Error(
        `Antigravity session '${ref.externalSessionId}' is already open for another workspace or directory.`,
      );
    }
  }

  add(session: AntigravityLiveSession): void {
    this.sessionsById.set(session.ref.externalSessionId, session);
    this.sessionIdsByBinding.set(session.callerBindingId, session.ref.externalSessionId);
  }

  drop(session: AntigravityLiveSession): void {
    if (this.sessionsById.get(session.ref.externalSessionId) === session) {
      this.sessionsById.delete(session.ref.externalSessionId);
    }
    this.sessionIdsByBinding.delete(session.callerBindingId);
  }

  /** The session whose managed MCP process got this caller binding. */
  resolveCallerBinding(callerBindingId: string): AgentSessionLiveRef | null {
    const sessionId = this.sessionIdsByBinding.get(callerBindingId);
    const session = sessionId === undefined ? undefined : this.sessionsById.get(sessionId);
    return session?.callerBindingId === callerBindingId ? session.ref : null;
  }

  /** Runs one operation of a session at a time: loads, attaches, history reads, and releases. */
  withGate<Result>(sessionId: string, run: () => Promise<Result>): Promise<Result> {
    const previous = this.gates.get(sessionId) ?? Promise.resolve();
    const next = previous.then(run, run);
    const settled = next.catch(() => undefined);
    this.gates.set(sessionId, settled);
    void settled.then(() => {
      if (this.gates.get(sessionId) === settled) this.gates.delete(sessionId);
    });
    return next;
  }

  /**
   * Runs `session/new` or `session/load`. Updates of an unknown session wait until it returns, and
   * the result carries the updates of the session that it names.
   */
  async openNativeSession<Result>(
    run: () => Promise<Result>,
    sessionIdOf: (result: Result) => string,
  ): Promise<{ readonly result: Result; readonly earlyUpdates: SessionNotification[] }> {
    this.openingSessions += 1;
    try {
      const result = await run();
      return { result, earlyUpdates: this.takeEarlyUpdates(sessionIdOf(result)) };
    } finally {
      this.openingSessions -= 1;
      if (this.openingSessions === 0) this.earlyUpdates.clear();
    }
  }

  /** Keeps an update of an unknown session while a session opens. */
  private keepEarlyUpdate(notification: SessionNotification): void {
    if (this.openingSessions === 0) return;
    const updates = this.earlyUpdates.get(notification.sessionId) ?? [];
    updates.push(notification);
    this.earlyUpdates.set(notification.sessionId, updates);
  }

  private takeEarlyUpdates(sessionId: string): SessionNotification[] {
    const updates = this.earlyUpdates.get(sessionId) ?? [];
    this.earlyUpdates.delete(sessionId);
    return updates;
  }
}

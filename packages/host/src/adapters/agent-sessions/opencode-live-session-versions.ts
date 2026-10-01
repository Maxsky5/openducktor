import type { AgentSessionLiveRef } from "@openducktor/contracts";
import { refKey } from "./opencode-live-session-normalization";

/** The session versions when a runtime read starts. */
export type OpenCodeSessionReadStart = {
  readonly snapshots: ReadonlyMap<string, number>;
  readonly statuses: ReadonlyMap<string, number>;
};

/**
 * What a runtime read can still change for one session:
 * - `session`: no update arrived during the read, so the read replaces the session.
 * - `status`: only context, title, or pending input changed, so the read sets only the status.
 * - `none`: a live status event or another read confirmed the status during the read.
 */
export type OpenCodeReadScope = "session" | "status" | "none";

export class OpenCodeSessionVersions {
  private readonly snapshots = new Map<string, number>();
  private readonly statuses = new Map<string, number>();

  snapshotChanged(ref: AgentSessionLiveRef): void {
    increment(this.snapshots, refKey(ref));
  }

  /** Counts each update that confirms the status, also when the snapshot stays equal. */
  statusConfirmed(ref: AgentSessionLiveRef): void {
    increment(this.statuses, refKey(ref));
  }

  /** A removed session makes every read in progress outdated for that session. */
  removed(ref: AgentSessionLiveRef): void {
    increment(this.snapshots, refKey(ref));
    increment(this.statuses, refKey(ref));
  }

  readStart(): OpenCodeSessionReadStart {
    return { snapshots: new Map(this.snapshots), statuses: new Map(this.statuses) };
  }

  readScope(ref: AgentSessionLiveRef, start: OpenCodeSessionReadStart): OpenCodeReadScope {
    const key = refKey(ref);
    if (changedSince(start.statuses, this.statuses, key)) {
      return "none";
    }
    return changedSince(start.snapshots, this.snapshots, key) ? "status" : "session";
  }
}

const increment = (versions: Map<string, number>, key: string): void => {
  versions.set(key, (versions.get(key) ?? 0) + 1);
};

const changedSince = (
  start: ReadonlyMap<string, number>,
  current: ReadonlyMap<string, number>,
  key: string,
): boolean => (start.get(key) ?? 0) !== (current.get(key) ?? 0);

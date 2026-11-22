import type {
  AgentSessionLiveReadResult,
  AgentSessionLiveRef,
  AgentSessionLiveSnapshot,
} from "@openducktor/contracts";
import { liveSessionRefKey, toLiveSessionRef } from "./live-session-ref";
import {
  openCodeLiveSnapshotsEqual,
  parseOpenCodeLiveSnapshot,
} from "./opencode-live-session-state-policy";

/** The snapshots that clients see: the stored snapshots with their live overlays. */
export const createOpenCodePublishedSnapshots = () => {
  const snapshots = new Map<string, AgentSessionLiveSnapshot>();
  return {
    /** Stores the snapshot. Returns false when it did not change. */
    publish: (key: string, snapshot: AgentSessionLiveSnapshot): boolean => {
      const previous = snapshots.get(key);
      snapshots.set(key, snapshot);
      return !previous || !openCodeLiveSnapshotsEqual(previous, snapshot);
    },
    /** A copy of the published snapshot of the session. */
    read: (ref: AgentSessionLiveRef): AgentSessionLiveReadResult => {
      const snapshot = snapshots.get(liveSessionRefKey(ref));
      return snapshot
        ? {
            type: "live",
            session: parseOpenCodeLiveSnapshot(snapshot, "opencode-live-session.read-snapshot"),
          }
        : { type: "missing", ref: toLiveSessionRef(ref) };
    },
    /** Copies of the published snapshots. */
    list: (): AgentSessionLiveSnapshot[] =>
      [...snapshots.values()].map((snapshot) =>
        parseOpenCodeLiveSnapshot(snapshot, "opencode-live-session.clone-snapshot"),
      ),
    remove: (key: string): void => {
      snapshots.delete(key);
    },
    clear: (): void => {
      snapshots.clear();
    },
  };
};

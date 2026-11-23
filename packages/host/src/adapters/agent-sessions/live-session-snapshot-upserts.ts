import type { AgentSessionLiveSnapshot } from "@openducktor/contracts";
import { agentSessionStatusFromActivity } from "@openducktor/core";
import type { AgentSessionLiveAdapterChange } from "../../ports/agent-session-live-adapter-port";
import { liveSessionRefKey } from "./live-session-ref";

/** The upserts of a change, and the settling upserts that go after its transcript events. */
type LiveSessionSnapshotUpserts = {
  readonly upserts: AgentSessionLiveAdapterChange[];
  readonly settling: AgentSessionLiveAdapterChange[];
};

/**
 * Stores the snapshots of a change and returns an upsert for each one that changed. An adapter
 * emits the final reply of a turn before the snapshot that settles the turn, but a change keeps
 * snapshots apart from transcript events. So the settling upsert of a known session must go after
 * the transcript events of the change, and a client never shows a settled turn without its final
 * reply.
 */
export const upsertLiveSessionSnapshots = (
  snapshotsByRef: Map<string, AgentSessionLiveSnapshot>,
  snapshots: readonly AgentSessionLiveSnapshot[],
): LiveSessionSnapshotUpserts => {
  const upserts: AgentSessionLiveAdapterChange[] = [];
  const settling: AgentSessionLiveAdapterChange[] = [];
  for (const snapshot of snapshots) {
    const key = liveSessionRefKey(snapshot.ref);
    const previous = snapshotsByRef.get(key);
    snapshotsByRef.set(key, snapshot);
    if (previous && JSON.stringify(previous) === JSON.stringify(snapshot)) continue;
    const settles = previous && agentSessionStatusFromActivity(snapshot.activity) === "idle";
    (settles ? settling : upserts).push({ type: "session_upsert", snapshot });
  }
  return { upserts, settling };
};

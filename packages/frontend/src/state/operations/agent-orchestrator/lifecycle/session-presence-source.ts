import {
  type AgentEnginePort,
  type AgentSessionPresenceSnapshot,
  type AgentSessionRef,
  toAgentSessionPresenceSnapshotFromLiveSnapshot,
} from "@openducktor/core";
import { AgentSessionPresenceCache, agentSessionPresenceLookupKey } from "./session-presence-cache";
import type { AgentSessionPresenceStore } from "./session-presence-store";

type AgentSessionPresenceSnapshotSourceAdapter = {
  listSessionPresence?: AgentEnginePort["listSessionPresence"];
  readSessionPresence?: AgentEnginePort["readSessionPresence"];
};

export type AgentSessionPresenceSnapshotSource = {
  read: (ref: AgentSessionRef) => Promise<AgentSessionPresenceSnapshot>;
};

type PreloadedPresenceLookup =
  | { type: "hit"; snapshot: AgentSessionPresenceSnapshot }
  | { type: "miss"; hasAuthoritativeEntry: boolean };

export const createAgentSessionPresenceSnapshotSource = ({
  adapter,
  agentSessionPresenceStore,
  preloadedSessionPresenceByKey,
}: {
  adapter: AgentSessionPresenceSnapshotSourceAdapter;
  agentSessionPresenceStore?: AgentSessionPresenceStore;
  preloadedSessionPresenceByKey?: Map<string, AgentSessionPresenceSnapshot[]>;
}): AgentSessionPresenceSnapshotSource => {
  const preloadedPresenceByKey =
    preloadedSessionPresenceByKey ?? new Map<string, AgentSessionPresenceSnapshot[]>();
  const sessionPresenceScanCache = adapter.listSessionPresence
    ? new AgentSessionPresenceCache(
        { listSessionPresence: adapter.listSessionPresence },
        preloadedPresenceByKey.size > 0 ? preloadedPresenceByKey : undefined,
      )
    : null;

  const toStalePresence = (ref: AgentSessionRef): AgentSessionPresenceSnapshot =>
    toAgentSessionPresenceSnapshotFromLiveSnapshot({
      ref,
      runtimeId: null,
      snapshot: null,
    });

  const readPreloadedPresence = (ref: AgentSessionRef): PreloadedPresenceLookup => {
    const lookupKey = agentSessionPresenceLookupKey(
      ref.repoPath,
      ref.runtimeKind,
      ref.workingDirectory,
    );
    if (!preloadedPresenceByKey.has(lookupKey)) {
      return { type: "miss", hasAuthoritativeEntry: false };
    }
    const snapshots = preloadedPresenceByKey.get(lookupKey) ?? [];
    const snapshot = snapshots.find(
      (candidate) => candidate.ref.externalSessionId === ref.externalSessionId,
    );
    if (snapshot) {
      return { type: "hit", snapshot };
    }
    return { type: "miss", hasAuthoritativeEntry: true };
  };

  const read = async (ref: AgentSessionRef): Promise<AgentSessionPresenceSnapshot> => {
    const storedPresence = agentSessionPresenceStore?.readPresence(ref);
    if (storedPresence) {
      return storedPresence;
    }

    const preloadedPresence = readPreloadedPresence(ref);
    if (preloadedPresence.type === "hit") {
      return preloadedPresence.snapshot;
    }
    if (preloadedPresence.hasAuthoritativeEntry && sessionPresenceScanCache) {
      return toStalePresence(ref);
    }

    if (sessionPresenceScanCache) {
      const snapshots = await sessionPresenceScanCache.load({
        repoPath: ref.repoPath,
        runtimeKind: ref.runtimeKind,
        directories: [ref.workingDirectory],
      });
      const scannedPresence = snapshots.find(
        (candidate) => candidate.ref.externalSessionId === ref.externalSessionId,
      );
      if (scannedPresence) {
        return scannedPresence;
      }
      // OpenCode direct presence reads repeat the same directory-scoped scan. A successful
      // scan miss is authoritative; do not probe again and multiply hydration latency.
      return toStalePresence(ref);
    }

    if (!adapter.readSessionPresence) {
      throw new Error("Session presence reads are unavailable for session hydration.");
    }
    return adapter.readSessionPresence(ref);
  };

  return { read };
};

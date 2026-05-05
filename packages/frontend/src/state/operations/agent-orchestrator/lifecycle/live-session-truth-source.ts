import {
  type AgentEnginePort,
  type LiveAgentSessionRef,
  type LiveSessionTruth,
  toLiveSessionTruthFromSnapshot,
} from "@openducktor/core";
import { LiveAgentSessionCache, liveAgentSessionLookupKey } from "./live-agent-session-cache";
import type { LiveAgentSessionStore } from "./live-agent-session-store";

type LiveSessionTruthSourceAdapter = {
  listLiveSessionTruths?: AgentEnginePort["listLiveSessionTruths"];
  readLiveSessionTruth?: AgentEnginePort["readLiveSessionTruth"];
};

export type LiveSessionTruthSource = {
  read: (ref: LiveAgentSessionRef) => Promise<LiveSessionTruth>;
};

type PreloadedTruthLookup =
  | { type: "hit"; truth: LiveSessionTruth }
  | { type: "miss"; hasAuthoritativeEntry: boolean };

export const createLiveSessionTruthSource = ({
  adapter,
  liveAgentSessionStore,
  preloadedLiveAgentSessionsByKey,
}: {
  adapter: LiveSessionTruthSourceAdapter;
  liveAgentSessionStore?: LiveAgentSessionStore;
  preloadedLiveAgentSessionsByKey?: Map<string, LiveSessionTruth[]>;
}): LiveSessionTruthSource => {
  const preloadedTruthsByKey =
    preloadedLiveAgentSessionsByKey ?? new Map<string, LiveSessionTruth[]>();
  const liveAgentSessionScanCache = adapter.listLiveSessionTruths
    ? new LiveAgentSessionCache(
        { listLiveSessionTruths: adapter.listLiveSessionTruths },
        preloadedTruthsByKey.size > 0 ? preloadedTruthsByKey : undefined,
      )
    : null;

  const toStaleTruth = (ref: LiveAgentSessionRef): LiveSessionTruth =>
    toLiveSessionTruthFromSnapshot({
      ref,
      runtimeId: null,
      snapshot: null,
    });

  const readPreloadedTruth = (ref: LiveAgentSessionRef): PreloadedTruthLookup => {
    const lookupKey = liveAgentSessionLookupKey(
      ref.repoPath,
      ref.runtimeKind,
      ref.workingDirectory,
    );
    if (!preloadedTruthsByKey.has(lookupKey)) {
      return { type: "miss", hasAuthoritativeEntry: false };
    }
    const truths = preloadedTruthsByKey.get(lookupKey) ?? [];
    const truth = truths.find(
      (candidate) => candidate.ref.externalSessionId === ref.externalSessionId,
    );
    if (truth) {
      return { type: "hit", truth };
    }
    return { type: "miss", hasAuthoritativeEntry: true };
  };

  const read = async (ref: LiveAgentSessionRef): Promise<LiveSessionTruth> => {
    const storedTruth = liveAgentSessionStore?.readTruth(ref);
    if (storedTruth) {
      return storedTruth;
    }

    const preloadedTruth = readPreloadedTruth(ref);
    if (preloadedTruth.type === "hit") {
      return preloadedTruth.truth;
    }
    if (preloadedTruth.hasAuthoritativeEntry && liveAgentSessionScanCache) {
      return toStaleTruth(ref);
    }

    if (liveAgentSessionScanCache) {
      const truths = await liveAgentSessionScanCache.load({
        repoPath: ref.repoPath,
        runtimeKind: ref.runtimeKind,
        directories: [ref.workingDirectory],
      });
      const scannedTruth = truths.find(
        (candidate) => candidate.ref.externalSessionId === ref.externalSessionId,
      );
      if (scannedTruth) {
        return scannedTruth;
      }
      // OpenCode direct truth reads repeat the same directory-scoped scan. A successful
      // scan miss is authoritative; do not probe again and multiply hydration latency.
      return toStaleTruth(ref);
    }

    if (!adapter.readLiveSessionTruth) {
      throw new Error("Live session truth reads are unavailable for session hydration.");
    }
    return adapter.readLiveSessionTruth(ref);
  };

  return { read };
};

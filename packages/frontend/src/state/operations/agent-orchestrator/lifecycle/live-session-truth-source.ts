import type { AgentEnginePort, LiveAgentSessionRef, LiveSessionTruth } from "@openducktor/core";
import { LiveAgentSessionCache, liveAgentSessionLookupKey } from "./live-agent-session-cache";
import type { LiveAgentSessionStore } from "./live-agent-session-store";

type LiveSessionTruthSourceAdapter = {
  listLiveSessionTruths?: AgentEnginePort["listLiveSessionTruths"];
  readLiveSessionTruth?: AgentEnginePort["readLiveSessionTruth"];
};

export type LiveSessionTruthSource = {
  read: (ref: LiveAgentSessionRef) => Promise<LiveSessionTruth>;
};

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

  const readPreloadedTruth = (ref: LiveAgentSessionRef): LiveSessionTruth | null => {
    const truths = preloadedTruthsByKey.get(
      liveAgentSessionLookupKey(ref.repoPath, ref.runtimeKind, ref.workingDirectory),
    );
    return (
      truths?.find((candidate) => candidate.ref.externalSessionId === ref.externalSessionId) ?? null
    );
  };

  const read = async (ref: LiveAgentSessionRef): Promise<LiveSessionTruth> => {
    const storedTruth = liveAgentSessionStore?.readTruth(ref);
    if (storedTruth) {
      return storedTruth;
    }

    const preloadedTruth = readPreloadedTruth(ref);
    if (preloadedTruth) {
      return preloadedTruth;
    }

    const truths = liveAgentSessionScanCache
      ? await liveAgentSessionScanCache.load({
          repoPath: ref.repoPath,
          runtimeKind: ref.runtimeKind,
          directories: [ref.workingDirectory],
        })
      : [];
    const scannedTruth = truths.find(
      (candidate) => candidate.ref.externalSessionId === ref.externalSessionId,
    );
    if (scannedTruth) {
      return scannedTruth;
    }

    if (!adapter.readLiveSessionTruth) {
      throw new Error("Live session truth reads are unavailable for session hydration.");
    }
    return adapter.readLiveSessionTruth(ref);
  };

  return { read };
};

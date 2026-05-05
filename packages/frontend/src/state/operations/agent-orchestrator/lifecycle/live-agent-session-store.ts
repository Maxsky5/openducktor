import type { LiveAgentSessionRef, LiveSessionTruth } from "@openducktor/core";
import { liveAgentSessionLookupKey } from "./live-agent-session-cache";

const DEFAULT_TRUTH_MAX_AGE_MS = 5_000;

type StoredLiveAgentSessions = {
  loadedAtMs: number;
  sessions: LiveSessionTruth[];
};

export class LiveAgentSessionStore {
  private readonly truthsByRepo = new Map<string, Map<string, StoredLiveAgentSessions>>();

  clearRepo(repoPath: string): void {
    this.truthsByRepo.delete(repoPath);
  }

  replaceRepoTruths(
    repoPath: string,
    truthsByKey: Map<string, LiveSessionTruth[]>,
    loadedAtMs = Date.now(),
  ): void {
    const nextTruths = new Map<string, StoredLiveAgentSessions>();
    for (const [lookupKey, sessions] of truthsByKey) {
      nextTruths.set(lookupKey, {
        loadedAtMs,
        sessions,
      });
    }
    this.truthsByRepo.set(repoPath, nextTruths);
  }

  readTruth(
    input: LiveAgentSessionRef & {
      maxAgeMs?: number;
      nowMs?: number;
    },
  ): LiveSessionTruth | null {
    const repoTruths = this.truthsByRepo.get(input.repoPath);
    if (!repoTruths) {
      return null;
    }

    const lookupKey = liveAgentSessionLookupKey(
      input.repoPath,
      input.runtimeKind,
      input.workingDirectory,
    );
    const storedTruths = repoTruths.get(lookupKey);
    if (!storedTruths) {
      return null;
    }

    const maxAgeMs = input.maxAgeMs ?? DEFAULT_TRUTH_MAX_AGE_MS;
    const nowMs = input.nowMs ?? Date.now();
    if (nowMs - storedTruths.loadedAtMs > maxAgeMs) {
      return null;
    }

    return (
      storedTruths.sessions.find(
        (session) => session.ref.externalSessionId === input.externalSessionId,
      ) ?? null
    );
  }
}

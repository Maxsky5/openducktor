import type { RuntimeKind } from "@openducktor/contracts";
import type { LiveAgentSessionSnapshot } from "@openducktor/core";
import { liveAgentSessionLookupKey } from "./live-agent-session-cache";

const DEFAULT_SNAPSHOT_MAX_AGE_MS = 5_000;

type StoredLiveAgentSessions = {
  loadedAtMs: number;
  sessions: LiveAgentSessionSnapshot[];
};

export class LiveAgentSessionStore {
  private readonly snapshotsByRepo = new Map<string, Map<string, StoredLiveAgentSessions>>();

  clearRepo(repoPath: string): void {
    this.snapshotsByRepo.delete(repoPath);
  }

  replaceRepoSnapshots(
    repoPath: string,
    snapshotsByKey: Map<string, LiveAgentSessionSnapshot[]>,
    loadedAtMs = Date.now(),
  ): void {
    const nextSnapshots = new Map<string, StoredLiveAgentSessions>();
    for (const [lookupKey, sessions] of snapshotsByKey) {
      nextSnapshots.set(lookupKey, {
        loadedAtMs,
        sessions,
      });
    }
    this.snapshotsByRepo.set(repoPath, nextSnapshots);
  }

  readSnapshot(input: {
    repoPath: string;
    runtimeKind: RuntimeKind;
    workingDirectory: string;
    externalSessionId: string;
    maxAgeMs?: number;
    nowMs?: number;
  }): LiveAgentSessionSnapshot | null {
    const repoSnapshots = this.snapshotsByRepo.get(input.repoPath);
    if (!repoSnapshots) {
      return null;
    }

    const lookupKey = liveAgentSessionLookupKey(
      input.repoPath,
      input.runtimeKind,
      input.workingDirectory,
    );
    const storedSnapshots = repoSnapshots.get(lookupKey);
    if (!storedSnapshots) {
      return null;
    }

    const maxAgeMs = input.maxAgeMs ?? DEFAULT_SNAPSHOT_MAX_AGE_MS;
    const nowMs = input.nowMs ?? Date.now();
    if (nowMs - storedSnapshots.loadedAtMs > maxAgeMs) {
      return null;
    }

    return (
      storedSnapshots.sessions.find(
        (session) => session.externalSessionId === input.externalSessionId,
      ) ?? null
    );
  }
}

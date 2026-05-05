import type { AgentSessionPresenceSnapshot, AgentSessionRef } from "@openducktor/core";
import { agentSessionPresenceLookupKey } from "./session-presence-cache";

const DEFAULT_PRESENCE_MAX_AGE_MS = 5_000;

type StoredAgentSessionPresence = {
  loadedAtMs: number;
  sessions: AgentSessionPresenceSnapshot[];
};

export class AgentSessionPresenceStore {
  private readonly presenceByRepo = new Map<string, Map<string, StoredAgentSessionPresence>>();

  clearRepo(repoPath: string): void {
    this.presenceByRepo.delete(repoPath);
  }

  replaceRepoPresence(
    repoPath: string,
    presenceByKey: Map<string, AgentSessionPresenceSnapshot[]>,
    loadedAtMs = Date.now(),
  ): void {
    const nextPresence = new Map<string, StoredAgentSessionPresence>();
    for (const [lookupKey, sessions] of presenceByKey) {
      nextPresence.set(lookupKey, {
        loadedAtMs,
        sessions,
      });
    }
    this.presenceByRepo.set(repoPath, nextPresence);
  }

  readPresence(
    input: AgentSessionRef & {
      maxAgeMs?: number;
      nowMs?: number;
    },
  ): AgentSessionPresenceSnapshot | null {
    const repoPresence = this.presenceByRepo.get(input.repoPath);
    if (!repoPresence) {
      return null;
    }

    const lookupKey = agentSessionPresenceLookupKey(
      input.repoPath,
      input.runtimeKind,
      input.workingDirectory,
    );
    const storedPresences = repoPresence.get(lookupKey);
    if (!storedPresences) {
      return null;
    }

    const maxAgeMs = input.maxAgeMs ?? DEFAULT_PRESENCE_MAX_AGE_MS;
    const nowMs = input.nowMs ?? Date.now();
    if (nowMs - storedPresences.loadedAtMs > maxAgeMs) {
      return null;
    }

    return (
      storedPresences.sessions.find(
        (session) => session.ref.externalSessionId === input.externalSessionId,
      ) ?? null
    );
  }
}

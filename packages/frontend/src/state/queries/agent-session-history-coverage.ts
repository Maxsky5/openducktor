import type { AgentSessionLiveEnvelope, AgentSessionLiveSnapshot } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";

export type SessionHistoryVersion = { epoch: number; revision: number };

type Coverage = {
  ready: boolean;
  epoch: number;
  revisions: Map<string, SessionHistoryVersion["revision"]>;
  sessions: Map<string, { parent: AgentSessionIdentity | null; historyState: string }>;
};

type HistorySessions = Coverage["sessions"];

const rememberSession = (sessions: HistorySessions, session: AgentSessionLiveSnapshot): boolean => {
  const { ref, parentExternalSessionId, activity, executionEpisodeId, pendingQuestions } = session;
  const key = agentSessionIdentityKey(ref);
  const historyState = JSON.stringify([
    parentExternalSessionId,
    activity,
    executionEpisodeId,
    pendingQuestions,
  ]);
  const changed = sessions.get(key)?.historyState !== historyState;
  sessions.set(key, {
    parent: parentExternalSessionId ? { ...ref, externalSessionId: parentExternalSessionId } : null,
    historyState,
  });
  return changed;
};

const applyHistoryEnvelope = (
  sessions: HistorySessions,
  envelope: AgentSessionLiveEnvelope,
): AgentSessionIdentity[] => {
  let identity: AgentSessionIdentity | undefined;
  let previousParent: AgentSessionIdentity | undefined;
  switch (envelope.type) {
    case "snapshot":
      sessions.clear();
      for (const session of envelope.sessions) rememberSession(sessions, session);
      return [];
    case "transcript_event":
      identity = envelope.event.sessionRef;
      break;
    case "session_upsert":
    case "task_session_records_updated": {
      const session = envelope.type === "session_upsert" ? envelope.session : envelope.liveSession;
      if (!session) break;
      const parent = sessions.get(agentSessionIdentityKey(session.ref))?.parent;
      if (rememberSession(sessions, session)) {
        identity = session.ref;
        previousParent = parent ?? undefined;
      }
      break;
    }
    case "session_removed":
      identity = envelope.ref;
      break;
    case "fault":
      identity = envelope.ref;
      break;
  }
  const changed: AgentSessionIdentity[] = [];
  const visited = new Set<string>();
  // Parent metadata changes affect the old root transcript as well as the new one.
  for (let current of [identity, previousParent]) {
    while (current) {
      const key = agentSessionIdentityKey(current);
      if (visited.has(key)) break;
      visited.add(key);
      changed.push(current);
      current = sessions.get(key)?.parent ?? undefined;
    }
  }
  if (envelope.type === "session_removed") sessions.delete(agentSessionIdentityKey(envelope.ref));
  return changed;
};

/** The rail's existing subscriptions prove history freshness, including inactive workspaces. */
export const createSessionHistoryCoverage = (queryClient: QueryClient) => {
  const repositories = new Map<string, Coverage>();
  const resetListeners = new Set<(repoPath: string) => void>();
  const notifyReset = (repoPath: string): void => {
    for (const listener of resetListeners) listener(repoPath);
  };
  const read = (repoPath: string, identity: AgentSessionIdentity): SessionHistoryVersion | null => {
    const coverage = repositories.get(normalizeWorkingDirectory(repoPath));
    return coverage?.ready && coverage.sessions.has(agentSessionIdentityKey(identity))
      ? {
          epoch: coverage.epoch,
          revision: coverage.revisions.get(agentSessionIdentityKey(identity)) ?? 0,
        }
      : null;
  };
  const isCurrent = (
    repoPath: string,
    identity: AgentSessionIdentity,
    version: SessionHistoryVersion | null,
  ): boolean => {
    const current = read(repoPath, identity);
    return (
      version !== null &&
      current !== null &&
      version.epoch === current.epoch &&
      version.revision === current.revision
    );
  };

  const observe = (repoPath: string) => {
    const repo = normalizeWorkingDirectory(repoPath);
    const previous = repositories.get(repo);
    const coverage: Coverage = {
      ready: false,
      epoch: (previous?.epoch ?? 0) + 1,
      revisions: new Map(),
      sessions: new Map(),
    };
    repositories.set(repo, coverage);
    let localRevision = 0;
    if (previous) notifyReset(repo);
    const invalidate = (identity?: AgentSessionIdentity): void => {
      void queryClient.invalidateQueries({
        queryKey: identity
          ? [
              "agent-session-history",
              repo,
              identity.runtimeKind,
              normalizeWorkingDirectory(identity.workingDirectory),
              identity.externalSessionId,
            ]
          : ["agent-session-history", repo],
        refetchType: "none",
      });
    };
    invalidate();
    return {
      accept(envelope: AgentSessionLiveEnvelope): void {
        if (repositories.get(repo) !== coverage) return;
        const changed = applyHistoryEnvelope(coverage.sessions, envelope);
        switch (envelope.type) {
          case "snapshot": {
            // A repeated connection snapshot is the transport's repair for an actual gap.
            const resets = coverage.ready || envelope.historyReplayGap;
            if (resets) {
              coverage.epoch += 1;
              coverage.revisions.clear();
            }
            coverage.ready = true;
            invalidate();
            if (resets) notifyReset(repo);
            return;
          }
          case "fault":
            if (!envelope.ref) {
              coverage.ready = false;
              coverage.epoch += 1;
              invalidate();
              notifyReset(repo);
            }
            break;
        }
        for (const identity of changed) {
          const key = agentSessionIdentityKey(identity);
          coverage.revisions.set(
            key,
            "sequence" in envelope && envelope.sequence !== undefined
              ? envelope.sequence
              : // Faults and older hosts can omit a position. Negative tokens cannot collide with host positions.
                --localRevision,
          );
          invalidate(identity);
        }
      },
      close(): void {
        if (repositories.get(repo) !== coverage) return;
        coverage.ready = false;
        coverage.epoch += 1;
        invalidate();
        notifyReset(repo);
      },
    };
  };
  const isObserved = (repoPath: string): boolean =>
    repositories.get(normalizeWorkingDirectory(repoPath))?.ready === true;
  const createProjection = () => {
    const sessions: HistorySessions = new Map();
    const versions = new Map<string, SessionHistoryVersion>();
    return {
      capture(repoPath: string, identity: AgentSessionIdentity): void {
        const version = read(repoPath, identity);
        const key = agentSessionIdentityKey(identity);
        if (version) versions.set(key, version);
        else versions.delete(key);
      },
      restore(identity: AgentSessionIdentity, version: SessionHistoryVersion): void {
        versions.set(agentSessionIdentityKey(identity), version);
      },
      read(identity: AgentSessionIdentity): SessionHistoryVersion | null {
        return versions.get(agentSessionIdentityKey(identity)) ?? null;
      },
      accept(envelope: AgentSessionLiveEnvelope): void {
        for (const identity of applyHistoryEnvelope(sessions, envelope)) {
          const key = agentSessionIdentityKey(identity);
          const version = versions.get(key);
          if (!version) continue;
          // A snapshot is not a transcript baseline. Keep the read's epoch until another full read.
          if (!("sequence" in envelope) || envelope.sequence === undefined) versions.delete(key);
          else if (envelope.sequence > version.revision) {
            versions.set(key, { epoch: version.epoch, revision: envelope.sequence });
          }
        }
      },
      reset(): void {
        versions.clear();
        sessions.clear();
      },
    };
  };
  const subscribeResets = (listener: (repoPath: string) => void): (() => void) => {
    resetListeners.add(listener);
    return () => {
      resetListeners.delete(listener);
    };
  };
  return { read, isCurrent, isObserved, observe, createProjection, subscribeResets };
};

export type SessionHistoryCoverage = ReturnType<typeof createSessionHistoryCoverage>;
const owners = new WeakMap<QueryClient, SessionHistoryCoverage>();

export const sessionHistoryCoverage = (queryClient: QueryClient): SessionHistoryCoverage => {
  let owner = owners.get(queryClient);
  if (!owner) {
    owner = createSessionHistoryCoverage(queryClient);
    owners.set(queryClient, owner);
  }
  return owner;
};

import type { AgentSessionLiveEnvelope, AgentSessionLiveSnapshot } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";

export type SessionHistoryVersion = { epoch: number; revision: number };

type HistoryEventObserver = {
  recordEvent: (envelope: AgentSessionLiveEnvelope) => void;
  close: () => void;
};

type HistoryProgressTracker = {
  captureReadVersion: (repoPath: string, identity: AgentSessionIdentity) => void;
  getVersion: (identity: AgentSessionIdentity) => SessionHistoryVersion | null;
  recordEvent: (envelope: AgentSessionLiveEnvelope) => void;
};

export type SessionHistoryFreshnessTracker = {
  getVersion: (repoPath: string, identity: AgentSessionIdentity) => SessionHistoryVersion | null;
  isCurrent: (
    repoPath: string,
    identity: AgentSessionIdentity,
    version: SessionHistoryVersion | null,
  ) => boolean;
  isWorkspaceObserved: (repoPath: string) => boolean;
  observeWorkspace: (repoPath: string) => HistoryEventObserver;
  createHistoryProgressTracker: () => HistoryProgressTracker;
  subscribeWorkspaceResets: (listener: (repoPath: string) => void) => () => void;
};

type WorkspaceHistoryState = {
  ready: boolean;
  epoch: number;
  revisions: Map<string, SessionHistoryVersion["revision"]>;
  sessions: Map<string, { parent: AgentSessionIdentity | null; historyFingerprint: string }>;
};

type SessionHistoryMetadata = WorkspaceHistoryState["sessions"];

const updateSessionHistoryMetadata = (
  sessions: SessionHistoryMetadata,
  session: AgentSessionLiveSnapshot,
): boolean => {
  const { ref, parentExternalSessionId, activity, executionEpisodeId, pendingQuestions } = session;
  const key = agentSessionIdentityKey(ref);
  const historyFingerprint = JSON.stringify([
    parentExternalSessionId,
    activity,
    executionEpisodeId,
    pendingQuestions,
  ]);
  const changed = sessions.get(key)?.historyFingerprint !== historyFingerprint;
  sessions.set(key, {
    parent: parentExternalSessionId ? { ...ref, externalSessionId: parentExternalSessionId } : null,
    historyFingerprint,
  });
  return changed;
};

const applyHistoryEvent = (
  sessions: SessionHistoryMetadata,
  envelope: AgentSessionLiveEnvelope,
): AgentSessionIdentity[] => {
  let identity: AgentSessionIdentity | undefined;
  let previousParent: AgentSessionIdentity | undefined;
  switch (envelope.type) {
    case "snapshot":
      sessions.clear();
      for (const session of envelope.sessions) updateSessionHistoryMetadata(sessions, session);
      return [];
    case "transcript_event":
      identity = envelope.event.sessionRef;
      break;
    case "session_upsert":
    case "task_session_records_updated": {
      const session = envelope.type === "session_upsert" ? envelope.session : envelope.liveSession;
      if (!session) break;
      const parent = sessions.get(agentSessionIdentityKey(session.ref))?.parent;
      if (updateSessionHistoryMetadata(sessions, session)) {
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

/** Tracks whether cached and retained histories include the current live session updates. */
const createSessionHistoryFreshnessTracker = (
  queryClient: QueryClient,
): SessionHistoryFreshnessTracker => {
  const workspaceStates = new Map<string, WorkspaceHistoryState>();
  const resetListeners = new Set<(repoPath: string) => void>();
  const notifyReset = (repoPath: string): void => {
    for (const listener of resetListeners) listener(repoPath);
  };
  const getVersion = (
    repoPath: string,
    identity: AgentSessionIdentity,
  ): SessionHistoryVersion | null => {
    const workspaceState = workspaceStates.get(normalizeWorkingDirectory(repoPath));
    if (!workspaceState?.ready || !workspaceState.sessions.has(agentSessionIdentityKey(identity))) {
      return null;
    }
    return {
      epoch: workspaceState.epoch,
      revision: workspaceState.revisions.get(agentSessionIdentityKey(identity)) ?? 0,
    };
  };
  const isCurrent = (
    repoPath: string,
    identity: AgentSessionIdentity,
    version: SessionHistoryVersion | null,
  ): boolean => {
    const current = getVersion(repoPath, identity);
    return (
      version !== null &&
      current !== null &&
      version.epoch === current.epoch &&
      version.revision === current.revision
    );
  };

  const observeWorkspace = (repoPath: string): HistoryEventObserver => {
    const repo = normalizeWorkingDirectory(repoPath);
    const previous = workspaceStates.get(repo);
    const workspaceState: WorkspaceHistoryState = {
      ready: false,
      epoch: (previous?.epoch ?? 0) + 1,
      revisions: new Map(),
      sessions: new Map(),
    };
    workspaceStates.set(repo, workspaceState);
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
      recordEvent(envelope: AgentSessionLiveEnvelope): void {
        if (workspaceStates.get(repo) !== workspaceState) return;
        const changed = applyHistoryEvent(workspaceState.sessions, envelope);
        switch (envelope.type) {
          case "snapshot": {
            // A repeated connection snapshot is the transport's repair for an actual gap.
            const resets = workspaceState.ready || envelope.historyReplayGap;
            if (resets) {
              workspaceState.epoch += 1;
              workspaceState.revisions.clear();
            }
            workspaceState.ready = true;
            invalidate();
            if (resets) notifyReset(repo);
            return;
          }
          case "fault":
            if (!envelope.ref) {
              workspaceState.ready = false;
              workspaceState.epoch += 1;
              invalidate();
              notifyReset(repo);
            }
            break;
        }
        for (const identity of changed) {
          const key = agentSessionIdentityKey(identity);
          workspaceState.revisions.set(
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
        if (workspaceStates.get(repo) !== workspaceState) return;
        workspaceState.ready = false;
        workspaceState.epoch += 1;
        invalidate();
        notifyReset(repo);
      },
    };
  };
  const isWorkspaceObserved = (repoPath: string): boolean =>
    workspaceStates.get(normalizeWorkingDirectory(repoPath))?.ready === true;
  const createHistoryProgressTracker = (): HistoryProgressTracker => {
    const sessions: SessionHistoryMetadata = new Map();
    const versions = new Map<string, SessionHistoryVersion>();
    return {
      captureReadVersion(repoPath: string, identity: AgentSessionIdentity): void {
        const version = getVersion(repoPath, identity);
        const key = agentSessionIdentityKey(identity);
        if (version) versions.set(key, version);
        else versions.delete(key);
      },
      getVersion(identity: AgentSessionIdentity): SessionHistoryVersion | null {
        return versions.get(agentSessionIdentityKey(identity)) ?? null;
      },
      recordEvent(envelope: AgentSessionLiveEnvelope): void {
        for (const identity of applyHistoryEvent(sessions, envelope)) {
          const key = agentSessionIdentityKey(identity);
          const version = versions.get(key);
          if (!version) continue;
          // A snapshot has no transcript. Only a full history read establishes a new epoch.
          if (!("sequence" in envelope) || envelope.sequence === undefined) versions.delete(key);
          else if (envelope.sequence > version.revision) {
            versions.set(key, { epoch: version.epoch, revision: envelope.sequence });
          }
        }
      },
    };
  };
  const subscribeWorkspaceResets = (listener: (repoPath: string) => void): (() => void) => {
    resetListeners.add(listener);
    return () => {
      resetListeners.delete(listener);
    };
  };
  return {
    getVersion,
    isCurrent,
    isWorkspaceObserved,
    observeWorkspace,
    createHistoryProgressTracker,
    subscribeWorkspaceResets,
  };
};

const trackersByQueryClient = new WeakMap<QueryClient, SessionHistoryFreshnessTracker>();

export const getSessionHistoryFreshnessTracker = (
  queryClient: QueryClient,
): SessionHistoryFreshnessTracker => {
  let tracker = trackersByQueryClient.get(queryClient);
  if (!tracker) {
    tracker = createSessionHistoryFreshnessTracker(queryClient);
    trackersByQueryClient.set(queryClient, tracker);
  }
  return tracker;
};

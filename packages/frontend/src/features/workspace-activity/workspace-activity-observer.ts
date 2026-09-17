import type { AgentSessionLiveEnvelope } from "@openducktor/contracts";
import { errorMessage } from "@/lib/errors";
import {
  applyWorkspaceActivityEnvelope,
  emptyWorkspaceActivityProjection,
  type WorkspaceActivityProjection,
} from "./workspace-activity-projection";
import {
  foldWorkspaceActivityBadges,
  sameWorkspaceActivityState,
  UNKNOWN_WORKSPACE_ACTIVITY,
  type WorkspaceActivityState,
} from "./workspace-activity-state";

export type WorkspaceActivityWorkspace = {
  workspaceId: string;
  repoPath: string;
};

/**
 * Current archived chat state of one workspace, keyed by agent session identity.
 *
 * The state is read from the source on every fold instead of being kept by the
 * observer, so a read that fails and later succeeds clears the tile by itself.
 */
export type WorkspaceActivityArchivedSessions =
  | { status: "unknown" }
  | { status: "ready"; keys: ReadonlySet<string> }
  | { status: "error"; reason: string };

/**
 * Archived chat records of a workspace, keyed by agent session identity.
 *
 * Archived chats must not produce a badge, and the workspace session record
 * list is the only place the archived flag exists.
 */
export type WorkspaceActivityArchivedSessionsPort = {
  load(workspaceId: string): Promise<void>;
  read(workspaceId: string): WorkspaceActivityArchivedSessions;
  subscribe(onChange: () => void): () => void;
};

export type WorkspaceActivityObserver = {
  syncWorkspaces(workspaces: readonly WorkspaceActivityWorkspace[]): void;
  /** Report the health of the shared workspace session record stream. */
  setSessionRecordsError(message: string | null): void;
  subscribe(listener: () => void): () => void;
  getWorkspaceActivity(workspaceId: string): WorkspaceActivityState;
  dispose(): void;
};

type Observation = {
  repoPath: string;
  cancelled: boolean;
  stop: (() => void) | null;
  projection: WorkspaceActivityProjection;
};

/**
 * Keep one reduced live projection per workspace of the rail.
 *
 * Every workspace of the rail is observed, selected or not, so a tile reports
 * its own activity without a workspace switch.
 */
export const createWorkspaceActivityObserver = ({
  observe,
  archivedSessions,
}: {
  observe(
    input: { repoPath: string },
    listener: (envelope: AgentSessionLiveEnvelope) => void,
  ): Promise<() => void>;
  archivedSessions: WorkspaceActivityArchivedSessionsPort;
}): WorkspaceActivityObserver => {
  const observations = new Map<string, Observation>();
  const listeners = new Set<() => void>();
  const cache = new Map<string, { version: number; state: WorkspaceActivityState }>();
  let sessionRecordsError: string | null = null;
  let stopArchivedSubscription: (() => void) | null = null;
  let version = 0;

  const emit = (): void => {
    version += 1;
    for (const listener of listeners) {
      listener();
    }
  };

  const computeWorkspaceActivity = (workspaceId: string): WorkspaceActivityState => {
    const observation = observations.get(workspaceId);
    if (!observation) {
      return UNKNOWN_WORKSPACE_ACTIVITY;
    }
    const archived = archivedSessions.read(workspaceId);
    const reason =
      (archived.status === "error" ? archived.reason : null) ??
      observation.projection.unavailableReason ??
      sessionRecordsError;
    if (reason !== null) {
      return { kind: "unavailable", reason };
    }
    if (!observation.projection.hasSnapshot || archived.status !== "ready") {
      return UNKNOWN_WORKSPACE_ACTIVITY;
    }
    return {
      kind: "ready",
      ...foldWorkspaceActivityBadges(observation.projection.sessions, archived.keys),
    };
  };

  const stopObservation = (workspaceId: string): void => {
    const observation = observations.get(workspaceId);
    if (!observation) {
      return;
    }
    observation.cancelled = true;
    observation.stop?.();
    observations.delete(workspaceId);
    cache.delete(workspaceId);
  };

  const startObservation = (workspace: WorkspaceActivityWorkspace): void => {
    const observation: Observation = {
      repoPath: workspace.repoPath,
      cancelled: false,
      stop: null,
      projection: emptyWorkspaceActivityProjection(),
    };
    observations.set(workspace.workspaceId, observation);

    // The load outcome is read back from the port, which reports both the
    // archived keys and a failed read, so neither is kept here.
    const settleArchived = (): void => {
      if (!observation.cancelled) {
        emit();
      }
    };
    void archivedSessions.load(workspace.workspaceId).then(settleArchived, settleArchived);

    void observe({ repoPath: workspace.repoPath }, (envelope) => {
      if (observation.cancelled) {
        return;
      }
      const projection = applyWorkspaceActivityEnvelope(observation.projection, envelope);
      if (projection === observation.projection) {
        return;
      }
      observation.projection = projection;
      emit();
    })
      .then((stop) => {
        if (observation.cancelled) {
          stop();
          return;
        }
        observation.stop = stop;
      })
      .catch((cause: unknown) => {
        if (observation.cancelled) {
          return;
        }
        observation.projection = {
          ...observation.projection,
          unavailableReason: errorMessage(cause),
        };
        emit();
      });
  };

  return {
    // Reusable after dispose. React StrictMode mounts, tears down, then mounts
    // the same observer again, so a disposed observer must observe again.
    syncWorkspaces(workspaces: readonly WorkspaceActivityWorkspace[]): void {
      stopArchivedSubscription ??= archivedSessions.subscribe(emit);
      const nextWorkspaceIds = new Set(workspaces.map((workspace) => workspace.workspaceId));
      let changed = false;
      for (const workspaceId of observations.keys()) {
        if (!nextWorkspaceIds.has(workspaceId)) {
          stopObservation(workspaceId);
          changed = true;
        }
      }
      for (const workspace of workspaces) {
        const current = observations.get(workspace.workspaceId);
        if (current?.repoPath === workspace.repoPath) {
          continue;
        }
        if (current) {
          stopObservation(workspace.workspaceId);
        }
        startObservation(workspace);
        changed = true;
      }
      if (changed) {
        emit();
      }
    },
    setSessionRecordsError(message: string | null): void {
      if (sessionRecordsError === message) {
        return;
      }
      sessionRecordsError = message;
      emit();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    // Returns a stable object identity while the state is unchanged, so a tile
    // subscribed through useSyncExternalStore does not re-render needlessly.
    getWorkspaceActivity(workspaceId: string): WorkspaceActivityState {
      const entry = cache.get(workspaceId);
      if (entry && entry.version === version) {
        return entry.state;
      }
      const computed = computeWorkspaceActivity(workspaceId);
      const state =
        entry && sameWorkspaceActivityState(entry.state, computed) ? entry.state : computed;
      cache.set(workspaceId, { version, state });
      return state;
    },
    dispose(): void {
      stopArchivedSubscription?.();
      stopArchivedSubscription = null;
      for (const workspaceId of observations.keys()) {
        stopObservation(workspaceId);
      }
      listeners.clear();
      cache.clear();
    },
  };
};

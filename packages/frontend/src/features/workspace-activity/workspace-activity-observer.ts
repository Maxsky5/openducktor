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
 * Archived chat records of a workspace, keyed by agent session identity.
 *
 * Archived chats must not produce a badge, and the workspace session record
 * list is the only place the archived flag exists.
 */
export type WorkspaceActivityArchivedSessionsPort = {
  load(workspaceId: string): Promise<void>;
  read(workspaceId: string): ReadonlySet<string>;
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
  archivedLoaded: boolean;
  archivedError: string | null;
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
  let disposed = false;

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
    const reason =
      observation.archivedError ?? observation.projection.unavailableReason ?? sessionRecordsError;
    if (reason !== null) {
      return { kind: "unavailable", reason };
    }
    if (!observation.projection.hasSnapshot || !observation.archivedLoaded) {
      return UNKNOWN_WORKSPACE_ACTIVITY;
    }
    return {
      kind: "ready",
      ...foldWorkspaceActivityBadges(
        observation.projection.sessions,
        archivedSessions.read(workspaceId),
      ),
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
      archivedLoaded: false,
      archivedError: null,
    };
    observations.set(workspace.workspaceId, observation);

    void archivedSessions
      .load(workspace.workspaceId)
      .then(() => {
        if (observation.cancelled) {
          return;
        }
        observation.archivedLoaded = true;
        emit();
      })
      .catch((cause: unknown) => {
        if (observation.cancelled) {
          return;
        }
        observation.archivedError = errorMessage(cause);
        emit();
      });

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
    syncWorkspaces(workspaces: readonly WorkspaceActivityWorkspace[]): void {
      if (disposed) {
        return;
      }
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
      disposed = true;
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

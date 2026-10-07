import type { z } from "zod";
import type { SessionLaunchState } from "@openducktor/contracts";
import type { HostBridge } from "@/lib/shell-bridge";
import { isBrowserLiveControlEvent } from "@/lib/browser-live-control-events";

/** Subscribe before reading so a saved response cannot replace newer live facts. */
export const observeSessionLaunches = async <State extends SessionLaunchState>({
  workspaceId,
  repoPath,
  ownerIds,
  bridge,
  owner,
  readOwner,
  schema,
  eventType,
  onSnapshot,
  onError,
}: {
  workspaceId: string;
  repoPath: string;
  ownerIds: string[];
  bridge: Pick<HostBridge, "subscribeRunEvents">;
  owner: (state: State) => string;
  readOwner: (ownerId: string, refresh: boolean) => Promise<State[]>;
  schema: z.ZodType<State>;
  eventType: string;
  onSnapshot: (state: State) => void;
  onError: (cause: unknown) => void;
}): Promise<() => void> => {
  let disposed = false;
  let generation = 0;
  const owners = new Set(ownerIds);
  const pending = new Map<string, Map<string, State>>();
  const presented = new Map<string, string>();
  const present = (snapshot: State) => {
    const signature = JSON.stringify(snapshot);
    if (presented.get(snapshot.launchAttemptId) === signature) return;
    presented.set(snapshot.launchAttemptId, signature);
    onSnapshot(snapshot);
  };
  const read = async () => {
    const current = ++generation;
    await Promise.all(
      ownerIds.map(async (ownerId) => {
        const updates = new Map<string, State>();
        pending.set(ownerId, updates);
        try {
          const snapshots = await readOwner(ownerId, current > 1);
          if (disposed || generation !== current) return;
          for (const snapshot of snapshots) {
            if (
              snapshot.workspaceId !== workspaceId ||
              snapshot.repoPath !== repoPath ||
              owner(snapshot) !== ownerId
            )
              throw new Error("Session launch read returned an outcome for another owner.");
            if (!updates.has(snapshot.launchAttemptId)) present(snapshot);
          }
        } catch (cause) {
          if (!disposed && generation === current) onError(cause);
        } finally {
          if (!disposed && generation === current) {
            pending.delete(ownerId);
            for (const snapshot of updates.values()) present(snapshot);
          }
        }
      }),
    );
  };
  const unsubscribe = await bridge.subscribeRunEvents((event) => {
    if (disposed) return;
    if (isBrowserLiveControlEvent(event)) {
      if (event.kind === "reconnected") void read();
      else onError(new Error(event.message ?? "Session launch event stream was interrupted."));
      return;
    }
    if (event.type !== eventType) return;
    try {
      const snapshot = schema.parse(JSON.parse(String(event.snapshot)));
      if (
        snapshot.workspaceId !== workspaceId ||
        snapshot.repoPath !== repoPath ||
        !owners.has(owner(snapshot))
      )
        return;
      const updates = pending.get(owner(snapshot));
      if (updates) updates.set(snapshot.launchAttemptId, snapshot);
      else present(snapshot);
    } catch (cause) {
      onError(cause);
    }
  });
  // Subscribe first so an older read cannot replace a newer event.
  void read();
  return () => {
    disposed = true;
    unsubscribe();
  };
};

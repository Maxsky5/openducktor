import type { WorkspaceSessionRefInput } from "@openducktor/contracts";
import { Effect } from "effect";

type SessionGateEntry = {
  semaphore: Effect.Semaphore;
  users: number;
};

export const createWorkspaceSessionOperationGate = () => {
  const entries = new Map<string, SessionGateEntry>();

  return {
    run: <A, E, R>(ref: WorkspaceSessionRefInput, operation: Effect.Effect<A, E, R>) => {
      const key = JSON.stringify([ref.workspaceId, ref.sessionId]);
      return Effect.acquireUseRelease(
        Effect.sync(() => {
          let entry = entries.get(key);
          if (!entry) {
            entry = { semaphore: Effect.runSync(Effect.makeSemaphore(1)), users: 0 };
            entries.set(key, entry);
          }
          // Count waiters before permit acquisition can yield or be interrupted.
          entry.users += 1;
          return entry;
        }),
        (entry) => entry.semaphore.withPermits(1)(operation),
        (entry) =>
          Effect.sync(() => {
            entry.users -= 1;
            if (entry.users === 0 && entries.get(key) === entry) entries.delete(key);
          }),
      );
    },
    /** Reports whether an operation holds or waits for the gate. Never waits. */
    isActive: (ref: WorkspaceSessionRefInput): boolean => {
      const entry = entries.get(JSON.stringify([ref.workspaceId, ref.sessionId]));
      return entry !== undefined && entry.users > 0;
    },
  };
};

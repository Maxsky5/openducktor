import { Effect } from "effect";

export type WorkspaceOwnershipLock = {
  runExclusive: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
};

export const createWorkspaceOwnershipLock = (): WorkspaceOwnershipLock => {
  const semaphore = Effect.unsafeMakeSemaphore(1);
  return {
    runExclusive: (effect) => semaphore.withPermits(1)(effect),
  };
};

import { Effect } from "effect";
import { normalizePathForComparison } from "../../../domain/path-comparison";
import { HostOperationError } from "../../../effect/host-errors";

export type TaskSessionLifecycleCoordinator = ReturnType<
  typeof createTaskSessionLifecycleCoordinator
>;

export const createTaskSessionLifecycleCoordinator = () => {
  const lifecycleLocks = new Set<string>();
  const worktreeGates = new Map<string, Effect.Semaphore>();
  const taskKey = (repoPath: string, taskId: string): string => `${repoPath}\0${taskId}`;
  const worktreeGate = (path: string): Effect.Semaphore => {
    const pathKey = normalizePathForComparison(path);
    const current = worktreeGates.get(pathKey);
    if (current) {
      return current;
    }
    const gate = Effect.runSync(Effect.makeSemaphore(1));
    worktreeGates.set(pathKey, gate);
    return gate;
  };

  return {
    acquireLifecycle(repoPath: string, taskIds: string[], operation: string) {
      return Effect.acquireRelease(
        Effect.gen(function* () {
          const existingLifecycle = taskIds.find((taskId) =>
            lifecycleLocks.has(taskKey(repoPath, taskId)),
          );
          if (existingLifecycle) {
            return yield* Effect.fail(
              new HostOperationError({
                operation: `task.${operation}.lifecycle_guard`,
                message: `Cannot ${operation} while another lifecycle operation is in progress for task ${existingLifecycle}.`,
                details: { repoPath, taskIds },
              }),
            );
          }
          for (const taskId of taskIds) {
            lifecycleLocks.add(taskKey(repoPath, taskId));
          }
        }),
        () =>
          Effect.sync(() => {
            for (const taskId of taskIds) {
              lifecycleLocks.delete(taskKey(repoPath, taskId));
            }
          }),
      );
    },
    acquireWorktreeLifecycle(paths: readonly string[]) {
      const uniquePaths = [...new Set(paths.map(normalizePathForComparison))].sort();
      return Effect.gen(function* () {
        for (const path of uniquePaths) {
          const gate = worktreeGate(path);
          yield* Effect.acquireRelease(gate.take(1), () => gate.release(1));
        }
      });
    },
    runWorktreeRead<Value, Error, Requirements>(
      path: string,
      read: Effect.Effect<Value, Error, Requirements>,
    ): Effect.Effect<Value, Error, Requirements> {
      return worktreeGate(path).withPermits(1)(read);
    },
  };
};

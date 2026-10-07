import { Context, Effect, Semaphore } from "effect";
import { normalizePathForComparison } from "../../../domain/path-comparison";
import { HostOperationError } from "../../../effect/host-errors";

export type TaskSessionLifecycleCoordinator = ReturnType<
  typeof createTaskSessionLifecycleCoordinator
>;

export const createTaskSessionLifecycleCoordinator = () => {
  const lifecycleLocks = new Set<string>();
  const reservations = new Map<string, symbol>();
  const reservedTaskKeys = Context.Reference<ReadonlyMap<string, symbol>>(
    `@openducktor/host/ReservedTaskKeys/${crypto.randomUUID()}`,
    { defaultValue: () => new Map() },
  );
  const workspaceLifecycleLocks = new Set<string>();
  const worktreeGates = new Map<string, Semaphore.Semaphore>();
  const taskKey = (repoPath: string, taskId: string): string => `${repoPath}\0${taskId}`;
  const hasTaskLifecycle = (repoPath: string): boolean => {
    const prefix = `${repoPath}\0`;
    return [...lifecycleLocks].some((key) => key.startsWith(prefix));
  };
  const worktreeGate = (path: string): Semaphore.Semaphore => {
    const pathKey = normalizePathForComparison(path);
    const current = worktreeGates.get(pathKey);
    if (current) {
      return current;
    }
    const gate = Semaphore.makeUnsafe(1);
    worktreeGates.set(pathKey, gate);
    return gate;
  };
  const acquireWorkspaceLifecycle = (repoPath: string, operation: string) =>
    Effect.acquireRelease(
      Effect.gen(function* () {
        if (workspaceLifecycleLocks.has(repoPath) || hasTaskLifecycle(repoPath)) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: `workspace.${operation}.task_lifecycle_guard`,
              message: `Cannot ${operation} while a task lifecycle operation is in progress for ${repoPath}. Wait for it to finish and retry.`,
              details: { repoPath },
            }),
          );
        }
        workspaceLifecycleLocks.add(repoPath);
      }),
      () => Effect.sync(() => workspaceLifecycleLocks.delete(repoPath)),
    );

  const coordinator = {
    runReservedTaskOperation<A, E, R>(
      repoPath: string,
      taskId: string,
      effect: Effect.Effect<A, E, R>,
    ) {
      return Effect.scoped(
        Effect.gen(function* () {
          yield* coordinator.acquireLifecycle(repoPath, [taskId], "launch workflow");
          const key = taskKey(repoPath, taskId);
          const token = Symbol("workflow launch reservation");
          yield* Effect.acquireRelease(
            Effect.sync(() => reservations.set(key, token)),
            () => Effect.sync(() => reservations.delete(key)),
          );
          const inherited = yield* reservedTaskKeys;
          return yield* Effect.provideService(
            effect,
            reservedTaskKeys,
            new Map([...inherited, [key, token]]),
          );
        }),
      );
    },
    acquireLifecycle(repoPath: string, taskIds: string[], operation: string) {
      return Effect.acquireRelease(
        Effect.gen(function* () {
          const reserved = yield* reservedTaskKeys;
          if (
            taskIds.length > 0 &&
            taskIds.every((id) => {
              const key = taskKey(repoPath, id);
              const token = reserved.get(key);
              return token !== undefined && reservations.get(key) === token;
            })
          )
            return false;
          if (workspaceLifecycleLocks.has(repoPath)) {
            return yield* Effect.fail(
              new HostOperationError({
                operation: `task.${operation}.lifecycle_guard`,
                message: `Cannot ${operation} while a workspace lifecycle operation is in progress for ${repoPath}.`,
                details: { repoPath, taskIds },
              }),
            );
          }
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
          return true;
        }),
        (acquired) =>
          Effect.sync(() => {
            if (!acquired) return;
            for (const taskId of taskIds) {
              lifecycleLocks.delete(taskKey(repoPath, taskId));
            }
          }),
      ).pipe(Effect.asVoid);
    },
    runWorkspaceLifecycle<Value, Error, Requirements>(
      repoPath: string,
      operation: string,
      effect: Effect.Effect<Value, Error, Requirements>,
    ) {
      return Effect.scoped(
        acquireWorkspaceLifecycle(repoPath, operation).pipe(Effect.andThen(effect)),
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
  return coordinator;
};

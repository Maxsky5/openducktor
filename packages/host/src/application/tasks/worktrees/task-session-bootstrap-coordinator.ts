import type { AgentRole, TaskStatus } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError, HostValidationError } from "../../../effect/host-errors";

export type TaskSessionBootstrapCleanup = () => Effect.Effect<string>;

export type TaskSessionBootstrapReservation = {
  bootstrapId: string;
  canonicalRepoPath: string;
  taskId: string;
  role: AgentRole;
  preparedStatus: TaskStatus;
  cleanup: TaskSessionBootstrapCleanup;
};

export type TaskSessionBootstrapTerminalOutcome = {
  outcome: "aborted" | "abort_failed" | "completed";
  repoPath: string;
  taskId: string;
  failureMessage?: string;
};

type TaskSessionBootstrapLock = {
  bootstrapId: string;
  role: AgentRole;
};

export type TaskSessionBootstrapCoordinator = ReturnType<
  typeof createTaskSessionBootstrapCoordinator
>;

export const createTaskSessionBootstrapCoordinator = () => {
  const reservations = new Map<string, TaskSessionBootstrapReservation>();
  const bootstrapLocks = new Map<string, TaskSessionBootstrapLock>();
  const lifecycleLocks = new Map<string, string>();
  const terminalOutcomes = new Map<string, TaskSessionBootstrapTerminalOutcome>();
  const key = (repoPath: string, taskId: string): string => `${repoPath}\0${taskId}`;
  const recordTerminal = (
    bootstrapId: string,
    outcome: TaskSessionBootstrapTerminalOutcome["outcome"],
    repoPath: string,
    taskId: string,
    failureMessage?: string,
  ): TaskSessionBootstrapTerminalOutcome => {
    const terminal = {
      outcome,
      repoPath,
      taskId,
      ...(failureMessage ? { failureMessage } : {}),
    };
    terminalOutcomes.set(bootstrapId, terminal);
    if (terminalOutcomes.size > 128) {
      const oldest = terminalOutcomes.keys().next().value;
      if (oldest) terminalOutcomes.delete(oldest);
    }
    return terminal;
  };

  const inspectBootstrap = (repoPath: string, taskId: string, bootstrapId: string) => {
    const terminal = terminalOutcomes.get(bootstrapId);
    if (terminal) {
      if (terminal.repoPath === repoPath && terminal.taskId === taskId) {
        return Effect.succeed({ state: "terminal" as const, terminal });
      }
      return Effect.fail(
        new HostValidationError({
          field: "bootstrapId",
          message: `Unknown or mismatched task session bootstrap for task ${taskId}.`,
        }),
      );
    }
    const taskKey = key(repoPath, taskId);
    const lock = bootstrapLocks.get(taskKey);
    if (lock?.bootstrapId !== bootstrapId) {
      return Effect.fail(
        new HostValidationError({
          field: "bootstrapId",
          message: `Unknown or mismatched task session bootstrap for task ${taskId}.`,
          details: { repoPath, taskId, bootstrapId },
        }),
      );
    }
    return Effect.succeed({
      state: "active" as const,
      role: lock.role,
      reservation: reservations.get(taskKey),
    });
  };

  const releaseActiveBootstrap = (repoPath: string, taskId: string): void => {
    const taskKey = key(repoPath, taskId);
    reservations.delete(taskKey);
    bootstrapLocks.delete(taskKey);
  };

  const beginLifecycle = (repoPath: string, taskIds: string[], operation: string) => {
    const existingLifecycle = taskIds.find((taskId) => lifecycleLocks.has(key(repoPath, taskId)));
    if (existingLifecycle) {
      return Effect.fail(
        new HostOperationError({
          operation: `task.${operation}.lifecycle_guard`,
          message: `Cannot ${operation} while another lifecycle operation is in progress for task ${existingLifecycle}.`,
          details: { repoPath, taskIds },
        }),
      );
    }
    const activeBootstraps: Array<{ taskId: string; lock: TaskSessionBootstrapLock }> = [];
    for (const taskId of taskIds) {
      const lock = bootstrapLocks.get(key(repoPath, taskId));
      if (lock) activeBootstraps.push({ taskId, lock });
    }
    if (activeBootstraps.length > 0) {
      return Effect.fail(
        new HostOperationError({
          operation: `task.${operation}.bootstrap_guard`,
          message: `Cannot ${operation} while task session bootstrap is in progress for ${activeBootstraps
            .map((entry) => `${entry.taskId} (${entry.lock.role})`)
            .join(", ")}.`,
          details: {
            repoPath,
            taskIds,
            activeBootstrapIds: activeBootstraps.map((entry) => entry.lock.bootstrapId),
          },
        }),
      );
    }
    for (const taskId of taskIds) lifecycleLocks.set(key(repoPath, taskId), operation);
    return Effect.succeed(() => {
      for (const taskId of taskIds) lifecycleLocks.delete(key(repoPath, taskId));
    });
  };

  return {
    attachBootstrapReservation(reservation: TaskSessionBootstrapReservation) {
      return Effect.gen(function* () {
        const current = yield* inspectBootstrap(
          reservation.canonicalRepoPath,
          reservation.taskId,
          reservation.bootstrapId,
        );
        if (current.state !== "active" || current.role !== reservation.role) {
          let activeRole = reservation.role;
          if (current.state === "active") activeRole = current.role;
          return yield* Effect.fail(
            new HostValidationError({
              field: "bootstrapId",
              message: `Task session bootstrap reservation does not match the active ${activeRole} startup for task ${reservation.taskId}.`,
              details: {
                repoPath: reservation.canonicalRepoPath,
                taskId: reservation.taskId,
                bootstrapId: reservation.bootstrapId,
                role: reservation.role,
              },
            }),
          );
        }
        reservations.set(key(reservation.canonicalRepoPath, reservation.taskId), reservation);
      });
    },
    acquireBootstrap(repoPath: string, taskId: string, bootstrapId: string, role: AgentRole) {
      const taskKey = key(repoPath, taskId);
      const lifecycle = lifecycleLocks.get(taskKey);
      const active = bootstrapLocks.get(taskKey);
      if (lifecycle || active) {
        let message = `Task session bootstrap is already in progress for task ${taskId} (${active?.role}).`;
        if (lifecycle) {
          message = `Cannot start task session bootstrap while ${lifecycle} is in progress for task ${taskId}.`;
        }
        return Effect.fail(
          new HostOperationError({
            operation: "task.session_bootstrap.prepare",
            message,
            details: { repoPath, taskId, role, bootstrapId },
          }),
        );
      }
      bootstrapLocks.set(taskKey, { bootstrapId, role });
      return Effect.succeed(undefined);
    },
    inspectBootstrap,
    finishBootstrap(
      repoPath: string,
      taskId: string,
      bootstrapId: string,
      outcome: TaskSessionBootstrapTerminalOutcome["outcome"],
      failureMessage?: string,
    ) {
      return Effect.gen(function* () {
        const current = yield* inspectBootstrap(repoPath, taskId, bootstrapId);
        if (current.state === "terminal") return current.terminal;
        releaseActiveBootstrap(repoPath, taskId);
        return recordTerminal(bootstrapId, outcome, repoPath, taskId, failureMessage);
      });
    },
    releaseBootstrap(repoPath: string, taskId: string, bootstrapId: string) {
      return Effect.gen(function* () {
        const current = yield* inspectBootstrap(repoPath, taskId, bootstrapId);
        if (current.state === "active") releaseActiveBootstrap(repoPath, taskId);
      });
    },
    acquireLifecycle(repoPath: string, taskIds: string[], operation: string) {
      return Effect.acquireRelease(beginLifecycle(repoPath, taskIds, operation), (release) =>
        Effect.sync(release),
      ).pipe(Effect.asVoid);
    },
  };
};

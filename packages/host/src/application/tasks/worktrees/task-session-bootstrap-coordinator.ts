import type { AgentRole, TaskStatus } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../../effect/host-errors";
import type { rollbackFailedBuildWorktree } from "../support/builder-worktree-cleanup";

export type TaskSessionBootstrapReservation = {
  bootstrapId: string;
  canonicalRepoPath: string;
  taskId: string;
  role: AgentRole;
  preparedStatus: TaskStatus;
  preparedUpdatedAt: string;
  cleanup: () => ReturnType<typeof rollbackFailedBuildWorktree>;
};

type TerminalOutcome = {
  outcome: "aborted" | "abort_failed" | "completed";
  repoPath: string;
  taskId: string;
  failureMessage?: string;
};

export type TaskSessionBootstrapCoordinator = ReturnType<
  typeof createTaskSessionBootstrapCoordinator
>;

export const createTaskSessionBootstrapCoordinator = () => {
  const reservations = new Map<string, TaskSessionBootstrapReservation>();
  const bootstrapLocks = new Map<string, { bootstrapId: string; role: AgentRole }>();
  const lifecycleLocks = new Map<string, string>();
  const terminalOutcomes = new Map<string, TerminalOutcome>();
  const key = (repoPath: string, taskId: string): string => `${repoPath}\0${taskId}`;
  const recordTerminal = (
    bootstrapId: string,
    outcome: TerminalOutcome["outcome"],
    repoPath: string,
    taskId: string,
    failureMessage?: string,
  ): void => {
    terminalOutcomes.set(bootstrapId, {
      outcome,
      repoPath,
      taskId,
      ...(failureMessage ? { failureMessage } : {}),
    });
    if (terminalOutcomes.size > 128) {
      const oldest = terminalOutcomes.keys().next().value;
      if (oldest) terminalOutcomes.delete(oldest);
    }
  };

  return {
    get(repoPath: string, taskId: string) {
      return reservations.get(key(repoPath, taskId));
    },
    set(reservation: TaskSessionBootstrapReservation) {
      reservations.set(key(reservation.canonicalRepoPath, reservation.taskId), reservation);
    },
    delete(repoPath: string, taskId: string) {
      const taskKey = key(repoPath, taskId);
      reservations.delete(taskKey);
      bootstrapLocks.delete(taskKey);
    },
    acquireBootstrap(repoPath: string, taskId: string, bootstrapId: string, role: AgentRole) {
      const taskKey = key(repoPath, taskId);
      const lifecycle = lifecycleLocks.get(taskKey);
      const active = bootstrapLocks.get(taskKey);
      if (lifecycle || active) {
        return Effect.fail(
          new HostOperationError({
            operation: "task.session_bootstrap.prepare",
            message: lifecycle
              ? `Cannot start task session bootstrap while ${lifecycle} is in progress for task ${taskId}.`
              : `Task session bootstrap is already in progress for task ${taskId} (${active?.role}).`,
            details: { repoPath, taskId, role, bootstrapId },
          }),
        );
      }
      bootstrapLocks.set(taskKey, { bootstrapId, role });
      return Effect.succeed(undefined);
    },
    terminalOutcome(bootstrapId: string) {
      return terminalOutcomes.get(bootstrapId);
    },
    ownsBootstrap(repoPath: string, taskId: string, bootstrapId: string) {
      return bootstrapLocks.get(key(repoPath, taskId))?.bootstrapId === bootstrapId;
    },
    recordTerminal,
    beginLifecycle(repoPath: string, taskIds: string[], operation: string) {
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
      const active = taskIds
        .map((taskId) => ({ taskId, lock: bootstrapLocks.get(key(repoPath, taskId)) }))
        .filter((entry) => Boolean(entry.lock));
      if (active.length > 0)
        return Effect.fail(
          new HostOperationError({
            operation: `task.${operation}.bootstrap_guard`,
            message: `Cannot ${operation} while task session bootstrap is in progress for ${active
              .map((entry) => `${entry.taskId} (${entry.lock?.role})`)
              .join(", ")}.`,
            details: {
              repoPath,
              taskIds,
              activeBootstrapIds: active.map((entry) => entry.lock?.bootstrapId),
            },
          }),
        );
      for (const taskId of taskIds) lifecycleLocks.set(key(repoPath, taskId), operation);
      return Effect.succeed(() => {
        for (const taskId of taskIds) lifecycleLocks.delete(key(repoPath, taskId));
      });
    },
  };
};

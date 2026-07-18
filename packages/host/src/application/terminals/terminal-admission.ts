import type { TerminalContext } from "@openducktor/contracts";
import { Effect } from "effect";
import { type TerminalTaskScope, terminalContextKey } from "./terminal-context";
import { TERMINAL_LIMITS } from "./terminal-limits";
import { TerminalServiceError } from "./terminal-service-error";

type TerminalAdmissionReservation = {
  release(): void;
};

type TerminalTaskCleanupLease = {
  awaitPending: Effect.Effect<void>;
  release(): void;
};

type TerminalAdmissionInput = {
  countLive(): number;
  countLiveForContext(context: TerminalContext): number;
};

export const createTerminalAdmission = ({
  countLive,
  countLiveForContext,
}: TerminalAdmissionInput) => {
  const blockedContexts = new Map<string, number>();
  const pendingByContext = new Map<string, number>();
  const waiters = new Set<{ isReady(): boolean; resume(): void }>();
  let accepting = true;
  let pendingTotal = 0;

  const notifyWaiters = (): void => {
    for (const waiter of waiters) {
      if (!waiter.isReady()) continue;
      waiters.delete(waiter);
      waiter.resume();
    }
  };

  const waitUntil = (isReady: () => boolean): Effect.Effect<void> =>
    Effect.async<void>((resume) => {
      if (isReady()) {
        resume(Effect.void);
        return;
      }
      const waiter = { isReady, resume: (): void => resume(Effect.void) };
      waiters.add(waiter);
      return Effect.sync(() => waiters.delete(waiter));
    });

  const reserve = (
    context: TerminalContext,
  ): Effect.Effect<TerminalAdmissionReservation, TerminalServiceError> =>
    Effect.suspend(() => {
      if (!accepting) {
        return Effect.fail(
          new TerminalServiceError({
            code: "close_failed",
            operation: "create",
            message: "Terminal service is shutting down.",
          }),
        );
      }
      if (countLive() + pendingTotal >= TERMINAL_LIMITS.livePerHost) {
        return Effect.fail(
          new TerminalServiceError({
            code: "host_terminal_limit",
            operation: "create",
            message: "The host terminal limit has been reached.",
          }),
        );
      }
      const key = terminalContextKey(context);
      const taskId = "taskId" in context ? context.taskId : undefined;
      if ((blockedContexts.get(key) ?? 0) > 0) {
        return Effect.fail(
          new TerminalServiceError({
            code: "close_failed",
            operation: "create",
            message: taskId
              ? `Terminal creation is unavailable while task ${taskId} is being cleaned up.`
              : "Terminal creation is unavailable while this context is being cleaned up.",
          }),
        );
      }
      const pendingForContext = pendingByContext.get(key) ?? 0;
      const contextLimit = taskId ? TERMINAL_LIMITS.livePerTask : TERMINAL_LIMITS.liveUnassociated;
      if (countLiveForContext(context) + pendingForContext >= contextLimit) {
        return Effect.fail(
          new TerminalServiceError({
            code: "context_terminal_limit",
            operation: "create",
            message: "The terminal limit for this context has been reached.",
          }),
        );
      }

      pendingTotal += 1;
      pendingByContext.set(key, pendingForContext + 1);
      let released = false;
      return Effect.succeed({
        release(): void {
          if (released) return;
          released = true;
          pendingTotal -= 1;
          const remainingForContext = (pendingByContext.get(key) ?? 1) - 1;
          if (remainingForContext === 0) pendingByContext.delete(key);
          else pendingByContext.set(key, remainingForContext);
          notifyWaiters();
        },
      });
    });

  const acquireTaskCleanupLease = ({
    repoPath,
    taskIds,
  }: TerminalTaskScope): Effect.Effect<TerminalTaskCleanupLease> =>
    Effect.sync(() => {
      const keys = [...new Set(taskIds.map((taskId) => terminalContextKey({ repoPath, taskId })))];
      for (const key of keys) blockedContexts.set(key, (blockedContexts.get(key) ?? 0) + 1);
      let released = false;
      return {
        awaitPending: waitUntil(() => keys.every((key) => (pendingByContext.get(key) ?? 0) === 0)),
        release(): void {
          if (released) return;
          released = true;
          for (const key of keys) {
            const remaining = (blockedContexts.get(key) ?? 1) - 1;
            if (remaining === 0) blockedContexts.delete(key);
            else blockedContexts.set(key, remaining);
          }
        },
      };
    });

  return {
    acquireTaskCleanupLease,
    reserve,
    stopAccepting: (): Effect.Effect<void> =>
      Effect.sync(() => {
        accepting = false;
      }).pipe(Effect.zipRight(waitUntil(() => pendingTotal === 0))),
  };
};

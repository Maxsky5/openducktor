import type { AgentSessionControlSummary } from "@openducktor/contracts";
import { Cause, Effect, Exit } from "effect";
import {
  causeMessage,
  HostOperationError,
  toHostOperationError,
  type HostError,
} from "../../effect/host-errors";
import { resumeAndSaveSession } from "./session-resume";
import type { TaskService, TaskServiceError } from "../tasks/task-service";
import type { TaskStorePort, TaskRecord } from "../../ports/task-repository-ports";
import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";
import type { TaskSessionStartPreparationService } from "../tasks/worktrees/task-session-start-preparation-service";
import type { AgentSessionLiveStateService } from "./agent-session-live-state-service";
import type { TaskSessionLifecycleCoordinator } from "../tasks/worktrees/task-session-lifecycle-coordinator";
import { createStartTaskWorkflowSession } from "./task-workflow-session-start";
import {
  readStoredWorkflowSession,
  storeWorkflowSession,
  toControlSessionRef,
} from "./task-workflow-session-storage";
import { TaskSessionOwnershipCommittedError } from "./task-session-ownership-error";
import { validateTaskSessionWorkflowAvailable } from "../tasks/support/task-session-workflow-validation";

export type RuntimeControl = Pick<
  AgentSessionLiveStateService,
  | "startSession"
  | "resumeSession"
  | "forkSession"
  | "sendUserMessage"
  | "updateSessionModel"
  | "stopSession"
  | "releaseSession"
>;

export type TaskLifecycle = Pick<TaskSessionLifecycleCoordinator, "acquireLifecycle">;
export type CanonicalizeRepoPath = (repoPath: string) => Effect.Effect<string, HostError>;
export type PreparedTaskSession = {
  session: AgentSessionControlSummary;
  publish: Effect.Effect<void, TaskServiceError>;
};
export type TaskSessionProgress = {
  checkCanceled: () => Effect.Effect<void, HostError>;
  workStartGuard?: import("@openducktor/core").AgentWorkStartGuard | undefined;
  created: (session: AgentSessionControlSummary) => Effect.Effect<void, HostError>;
  saved: () => void;
  stop: RuntimeControl["stopSession"];
};
export type TaskSessionWrites = {
  saveSession: (
    input: Parameters<TaskService["agentSessionUpsert"]>[0],
  ) => Effect.Effect<{ publish: Effect.Effect<void, TaskServiceError> }, TaskServiceError>;
  applyStartEvent: (input: Parameters<TaskService["applyStartEvent"]>[0]) => Effect.Effect<
    {
      task: TaskRecord;
      publish: Effect.Effect<void, TaskServiceError>;
    },
    TaskServiceError
  >;
};
export type TaskSessionOperationDependencies = {
  canonicalizeRepoPath: CanonicalizeRepoPath;
  runtime: Pick<
    RuntimeControl,
    "startSession" | "forkSession" | "resumeSession" | "releaseSession"
  >;
  taskReader: Pick<TaskStorePort, "getTask">;
  taskWorkflows: TaskWorkflowResolver;
  tasks: Pick<TaskService, "agentSessionsList">;
  taskLifecycle: TaskLifecycle;
  taskSessionStart: Pick<TaskSessionStartPreparationService, "prepare" | "complete">;
  writes: TaskSessionWrites;
};

/** Creates native sessions and saves ownership before returning publication work. */
export const createTaskSessionOperations = (deps: TaskSessionOperationDependencies) => {
  const { canonicalizeRepoPath, runtime, taskReader, taskWorkflows, tasks, taskLifecycle, writes } =
    deps;
  return {
    start: createStartTaskWorkflowSession(deps),
    resume: (
      input: Parameters<RuntimeControl["resumeSession"]>[0],
    ): Effect.Effect<PreparedTaskSession, HostError> =>
      Effect.scoped(
        Effect.gen(function* () {
          if (input.sessionScope.kind !== "workflow")
            return yield* runtime
              .resumeSession(input)
              .pipe(Effect.map((session) => ({ session, publish: Effect.void })));
          const scope = input.sessionScope;
          const repoPath = yield* canonicalizeRepoPath(input.repoPath);
          yield* taskLifecycle.acquireLifecycle(repoPath, [scope.taskId], "resume session");
          const stored = yield* readStoredWorkflowSession(
            tasks,
            { ...input, repoPath, sessionScope: scope },
            "read-resume",
          );
          return yield* resumeAndSaveSession({
            ref: { ...input, repoPath },
            resume: runtime.resumeSession({
              ...input,
              repoPath,
              runtimeKind: stored.runtimeKind,
              workingDirectory: stored.workingDirectory,
            }),
            save: (session) =>
              storeWorkflowSession(writes.saveSession, {
                repoPath,
                sessionScope: scope,
                model: input.model,
                selectedModel: stored.selectedModel,
                summary: session,
              }),
            release: runtime.releaseSession,
          }).pipe(Effect.map(({ session, saved }) => ({ session, publish: saved.publish })));
        }),
      ),
    fork: (
      input: Parameters<RuntimeControl["forkSession"]>[0],
      progress: TaskSessionProgress,
    ): Effect.Effect<PreparedTaskSession, HostError> => {
      if (input.sessionScope.kind !== "workflow") {
        return runtime
          .forkSession(input)
          .pipe(Effect.map((session) => ({ session, publish: Effect.void })));
      }
      const scope = input.sessionScope;
      return Effect.scoped(
        Effect.gen(function* () {
          const repoPath = yield* canonicalizeRepoPath(input.repoPath);
          yield* taskLifecycle.acquireLifecycle(repoPath, [scope.taskId], "fork session");
          const task = yield* taskReader.getTask({ repoPath, taskId: scope.taskId }).pipe(
            Effect.mapError((cause) =>
              toHostOperationError(cause, "task-workflow-session.read-fork-task", {
                repoPath,
                taskId: scope.taskId,
              }),
            ),
          );
          if (!input.forkPoint)
            yield* validateTaskSessionWorkflowAvailable(
              taskWorkflows.forRepo(repoPath),
              task,
              scope.role,
              repoPath,
            );
          const parent = yield* readStoredWorkflowSession(
            tasks,
            {
              repoPath,
              runtimeKind: input.runtimeKind,
              workingDirectory: input.sourceWorkingDirectory ?? input.workingDirectory,
              externalSessionId: input.parentExternalSessionId,
              sessionScope: scope,
            },
            "read-fork",
          );
          const runtimeInput = {
            ...input,
            repoPath,
            runtimeKind: parent.runtimeKind,
            workingDirectory: parent.workingDirectory,
            workStartGuard: progress.workStartGuard ?? input.workStartGuard,
          };
          // An interruption must not lose the forked identity, so cleanup can stop the session.
          return yield* Effect.uninterruptible(
            Effect.gen(function* () {
              yield* progress.checkCanceled();
              const summary = yield* runtime.forkSession(runtimeInput);
              const saved = yield* Effect.exit(
                Effect.gen(function* () {
                  if (
                    input.forkPoint &&
                    (summary.externalSessionId === parent.externalSessionId ||
                      summary.status !== "idle" ||
                      summary.runtimeKind !== parent.runtimeKind ||
                      summary.workingDirectory !== parent.workingDirectory)
                  )
                    return yield* new HostOperationError({
                      operation: "task-workflow-session.fork.validate",
                      message:
                        "The runtime did not return a distinct idle fork in the source checkout. Reopen the source chat and retry.",
                    });
                  yield* progress.created(summary);
                  yield* progress.checkCanceled();
                  const stored = yield* storeWorkflowSession(writes.saveSession, {
                    repoPath,
                    sessionScope: scope,
                    model: input.model,
                    selectedModel: undefined,
                    summary,
                  });
                  progress.saved();
                  return { session: summary, publish: stored.publish };
                }),
              );
              if (Exit.isSuccess(saved)) return saved.value;
              const saveFailure = Cause.findErrorOption(saved.cause);
              if (
                saveFailure._tag === "Some" &&
                saveFailure.value instanceof TaskSessionOwnershipCommittedError
              )
                return yield* Effect.failCause(saved.cause);
              if (
                summary.externalSessionId === parent.externalSessionId ||
                (!input.forkPoint && saved.cause.reasons.some(Cause.isDieReason))
              )
                return yield* Effect.failCause(saved.cause);
              const ref = toControlSessionRef(repoPath, summary);
              const stopped = yield* Effect.exit(progress.stop(ref));
              if (
                !input.forkPoint &&
                Exit.isFailure(stopped) &&
                stopped.cause.reasons.some(Cause.isDieReason)
              )
                return yield* Effect.failCause(stopped.cause);
              const cleanupFailures = Exit.isFailure(stopped) ? [stopped.cause] : [];
              if (Exit.isSuccess(stopped) || input.forkPoint) {
                const released = yield* Effect.exit(runtime.releaseSession(ref));
                if (Exit.isFailure(released)) {
                  if (!input.forkPoint && released.cause.reasons.some(Cause.isDieReason))
                    return yield* Effect.failCause(released.cause);
                  cleanupFailures.push(released.cause);
                }
              }
              if (cleanupFailures.length > 0 || input.forkPoint) {
                let message = causeMessage(saved.cause);
                if (cleanupFailures.length > 0)
                  message += " Cleanup failed: " + cleanupFailures.map(causeMessage).join("; ");
                if (input.forkPoint)
                  message += ` Native history for runtime session '${summary.externalSessionId}' can remain. Inspect that conversation before retrying.`;
                return yield* new HostOperationError({
                  operation: "task-workflow-session.store-control-result",
                  message,
                  cause: {
                    storeFailure: saveFailure._tag === "Some" ? saveFailure.value : saved.cause,
                    cleanupFailures,
                  },
                  details: {
                    repoPath,
                    externalSessionId: summary.externalSessionId,
                    storeFailure: saved.cause,
                    cleanupFailures,
                  },
                });
              }
              return yield* Effect.failCause(saved.cause);
            }),
          );
        }),
      );
    },
  };
};
export type TaskSessionOperations = ReturnType<typeof createTaskSessionOperations>;

import type { AgentSessionControlSummary, TaskCard } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError, toHostOperationError, type HostError } from "../../effect/host-errors";
import { resumeAndSaveSession } from "./session-resume";
import type { TaskService, TaskServiceError } from "../tasks/task-service";
import type { TaskStorePort } from "../../ports/task-repository-ports";
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
  created: (session: AgentSessionControlSummary) => Effect.Effect<void, HostError>;
  saved: () => void;
  stop: RuntimeControl["stopSession"];
};
export type TaskSessionWrites = {
  saveSession: (
    input: Parameters<TaskService["agentSessionUpsert"]>[0],
  ) => Effect.Effect<{ publish: Effect.Effect<void, TaskServiceError> }, TaskServiceError>;
  transitionTask: (input: Parameters<TaskService["transitionTask"]>[0]) => Effect.Effect<
    {
      task: TaskCard;
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
  tasks: Pick<TaskService, "agentSessionsList">;
  taskLifecycle: TaskLifecycle;
  taskSessionStart: Pick<TaskSessionStartPreparationService, "prepare" | "complete">;
  writes: TaskSessionWrites;
};

/** Creates native sessions and saves ownership before returning publication work. */
export const createTaskSessionOperations = (deps: TaskSessionOperationDependencies) => {
  const { canonicalizeRepoPath, runtime, taskReader, tasks, taskLifecycle, writes } = deps;
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
          yield* validateTaskSessionWorkflowAvailable(task, scope.role, repoPath);
          const parent = yield* readStoredWorkflowSession(
            tasks,
            {
              repoPath,
              runtimeKind: input.runtimeKind,
              workingDirectory: input.workingDirectory,
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
          };
          // An interruption must not lose the forked identity, so cleanup can stop the session.
          return yield* Effect.uninterruptible(
            Effect.gen(function* () {
              yield* progress.checkCanceled();
              const summary = yield* runtime.forkSession(runtimeInput);
              const stored = yield* Effect.result(
                Effect.gen(function* () {
                  yield* progress.created(summary);
                  yield* progress.checkCanceled();
                  const saved = yield* storeWorkflowSession(writes.saveSession, {
                    repoPath,
                    sessionScope: scope,
                    model: input.model,
                    selectedModel: undefined,
                    summary,
                  });
                  progress.saved();
                  return { session: summary, publish: saved.publish };
                }),
              );
              if (stored._tag === "Success") return stored.success;
              if (stored.failure instanceof TaskSessionOwnershipCommittedError)
                return yield* Effect.fail(stored.failure);
              const cleaned = yield* Effect.result(
                progress.stop(toControlSessionRef(repoPath, summary)),
              );
              if (cleaned._tag === "Failure")
                return yield* new HostOperationError({
                  operation: "task-workflow-session.store-control-result",
                  message: stored.failure.message + " Cleanup failed: " + cleaned.failure.message,
                  cause: { storeFailure: stored.failure, cleanupFailure: cleaned.failure },
                  details: {
                    repoPath,
                    externalSessionId: summary.externalSessionId,
                    storeFailure: stored.failure,
                    cleanupFailure: cleaned.failure,
                  },
                });
              return yield* Effect.fail(stored.failure);
            }),
          );
        }),
      );
    },
  };
};
export type TaskSessionOperations = ReturnType<typeof createTaskSessionOperations>;

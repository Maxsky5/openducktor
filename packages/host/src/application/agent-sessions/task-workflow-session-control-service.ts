import type {
  AgentSessionControlForkInput,
  AgentSessionControlResumeInput,
  AgentSessionControlSendInput,
  AgentSessionControlStartInput,
  AgentSessionControlStopInput,
  AgentSessionControlSummary,
  AgentSessionLiveRef,
  AgentSessionModelSettings,
  AgentSessionRecord,
  AgentSessionWorkflowScope,
  AgentWorkflowSessionStartInput,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { TaskService, TaskServiceError } from "../tasks/task-service";
import { validateTaskSessionWorkflowAvailable } from "../tasks/support/task-session-workflow-validation";
import type { TaskSessionLifecycleCoordinator } from "../tasks/worktrees/task-session-lifecycle-coordinator";
import {
  type HostError,
  HostOperationError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import type { AgentSessionLiveStateService } from "./agent-session-live-state-service";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import type { TaskSessionStartPreparationService } from "../tasks/worktrees/task-session-start-preparation-service";
import { createStartTaskWorkflowSession } from "./task-workflow-session-start";

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

export type TaskSessions = Pick<
  TaskService,
  "agentSessionsList" | "agentSessionUpsert" | "agentSessionUpdateModel" | "transitionTask"
>;
type TaskReader = Pick<TaskStorePort, "getTask">;

export type TaskLifecycle = Pick<TaskSessionLifecycleCoordinator, "acquireLifecycle">;
export type CanonicalizeRepoPath = (repoPath: string) => Effect.Effect<string, HostError>;
type StoredWorkflowSessionRef = AgentSessionLiveRef & {
  sessionScope: AgentSessionWorkflowScope;
};

type ControlledLaunchInput =
  | AgentWorkflowSessionStartInput
  | AgentSessionControlStartInput
  | AgentSessionControlResumeInput
  | AgentSessionControlForkInput;

const storeWorkflowSession = (
  tasks: TaskSessions,
  input: ControlledLaunchInput,
  summary: AgentSessionControlSummary,
  selectedModel: AgentSessionRecord["selectedModel"] = null,
) => {
  if (input.sessionScope.kind !== "workflow") {
    return Effect.void;
  }
  const scope = input.sessionScope;
  return tasks
    .agentSessionUpsert({
      repoPath: input.repoPath,
      taskId: scope.taskId,
      session: {
        externalSessionId: summary.externalSessionId,
        role: scope.role,
        startedAt: summary.startedAt,
        runtimeKind: summary.runtimeKind,
        workingDirectory: summary.workingDirectory,
        selectedModel: input.model
          ? { ...input.model, runtimeKind: summary.runtimeKind }
          : selectedModel,
      },
    })
    .pipe(
      Effect.asVoid,
      Effect.mapError((cause) =>
        toHostOperationError(cause, "task-workflow-session.create", {
          repoPath: input.repoPath,
          taskId: scope.taskId,
        }),
      ),
    );
};

const readStoredWorkflowSession = (
  tasks: TaskSessions,
  input: StoredWorkflowSessionRef,
  operation: "read-fork" | "read-resume" | "send" | "update-model",
): Effect.Effect<AgentSessionRecord, HostError> => {
  const scope = input.sessionScope;
  return tasks.agentSessionsList({ repoPath: input.repoPath, taskId: scope.taskId }).pipe(
    Effect.mapError((cause) =>
      toHostOperationError(cause, `task-workflow-session.${operation}`, {
        repoPath: input.repoPath,
        taskId: scope.taskId,
        externalSessionId: input.externalSessionId,
      }),
    ),
    Effect.flatMap((sessions) => {
      const stored = sessions.find(
        (session) =>
          session.externalSessionId === input.externalSessionId &&
          session.role === scope.role &&
          session.runtimeKind === input.runtimeKind &&
          session.workingDirectory === input.workingDirectory,
      );
      return stored
        ? Effect.succeed(stored)
        : Effect.fail(
            new HostValidationError({
              field: "externalSessionId",
              message: `Task '${scope.taskId}' does not own session '${input.externalSessionId}' for role '${scope.role}'.`,
              details: {
                repoPath: input.repoPath,
                taskId: scope.taskId,
                externalSessionId: input.externalSessionId,
              },
            }),
          );
    }),
  );
};

const controlSessionRef = (
  repoPath: string,
  summary: AgentSessionControlSummary,
): AgentSessionControlStopInput => ({
  repoPath,
  runtimeKind: summary.runtimeKind,
  workingDirectory: summary.workingDirectory,
  externalSessionId: summary.externalSessionId,
});

const storeControlResult = (
  tasks: TaskSessions,
  runtime: RuntimeControl,
  input: ControlledLaunchInput,
  summary: AgentSessionControlSummary,
  cleanup: "release" | "stop",
  selectedModel?: AgentSessionRecord["selectedModel"],
) =>
  Effect.gen(function* () {
    const stored = yield* Effect.either(storeWorkflowSession(tasks, input, summary, selectedModel));
    if (stored._tag === "Right") {
      return summary;
    }
    const ref = controlSessionRef(input.repoPath, summary);
    const cleaned = yield* Effect.either(
      cleanup === "release" ? runtime.releaseSession(ref) : runtime.stopSession(ref),
    );
    if (cleaned._tag === "Left") {
      return yield* Effect.fail(
        new HostOperationError({
          operation: "task-workflow-session.store-control-result",
          message: `${stored.left.message} Cleanup failed: ${cleaned.left.message}`,
          cause: { storeFailure: stored.left, cleanupFailure: cleaned.left },
          details: {
            repoPath: input.repoPath,
            externalSessionId: summary.externalSessionId,
            storeFailure: stored.left,
            cleanupFailure: cleaned.left,
          },
        }),
      );
    }
    return yield* Effect.fail(stored.left);
  });

const toRuntimeModel = (
  selectedModel: AgentSessionRecord["selectedModel"],
): AgentSessionModelSettings | null => {
  if (!selectedModel) {
    return null;
  }
  const { providerId, modelId, variant } = selectedModel;
  return variant === undefined ? { providerId, modelId } : { providerId, modelId, variant };
};

export const createTaskWorkflowSessionControlService = ({
  canonicalizeRepoPath,
  runtime,
  taskReader,
  tasks,
  taskLifecycle,
  taskSessionStart,
}: {
  canonicalizeRepoPath: CanonicalizeRepoPath;
  runtime: RuntimeControl;
  taskReader: TaskReader;
  tasks: TaskSessions;
  taskLifecycle: TaskLifecycle;
  taskSessionStart: TaskSessionStartPreparationService;
}): RuntimeControl & {
  startWorkflowSession: (
    input: AgentWorkflowSessionStartInput,
  ) => Effect.Effect<AgentSessionControlSummary, HostError | TaskServiceError>;
} => ({
  ...runtime,
  startSession: (input) =>
    Effect.gen(function* () {
      const summary = yield* runtime.startSession(input);
      return yield* storeControlResult(tasks, runtime, input, summary, "stop");
    }),
  startWorkflowSession: createStartTaskWorkflowSession({
    canonicalizeRepoPath,
    runtime,
    tasks,
    taskLifecycle,
    taskSessionStart,
  }),
  resumeSession: (input) => {
    if (input.sessionScope.kind !== "workflow") {
      return runtime.resumeSession(input);
    }
    const scope = input.sessionScope;
    return Effect.scoped(
      Effect.gen(function* () {
        const repoPath = yield* canonicalizeRepoPath(input.repoPath);
        yield* taskLifecycle.acquireLifecycle(repoPath, [scope.taskId], "resume session");
        const stored = yield* readStoredWorkflowSession(
          tasks,
          {
            repoPath,
            runtimeKind: input.runtimeKind,
            workingDirectory: input.workingDirectory,
            externalSessionId: input.externalSessionId,
            sessionScope: scope,
          },
          "read-resume",
        );
        const runtimeInput = {
          ...input,
          repoPath,
          runtimeKind: stored.runtimeKind,
          workingDirectory: stored.workingDirectory,
        };
        const summary = yield* runtime.resumeSession(runtimeInput);
        return yield* storeControlResult(
          tasks,
          runtime,
          runtimeInput,
          summary,
          "release",
          stored.selectedModel,
        );
      }),
    );
  },
  forkSession: (input) => {
    if (input.sessionScope.kind !== "workflow") {
      return runtime.forkSession(input);
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
        const summary = yield* runtime.forkSession(runtimeInput);
        return yield* storeControlResult(tasks, runtime, runtimeInput, summary, "stop");
      }),
    );
  },
  sendUserMessage: (input) => {
    if (input.sessionScope.kind !== "workflow") {
      return runtime.sendUserMessage(input);
    }
    const scope = input.sessionScope;
    return Effect.scoped(
      Effect.gen(function* () {
        const repoPath = yield* canonicalizeRepoPath(input.repoPath);
        yield* taskLifecycle.acquireLifecycle(repoPath, [scope.taskId], "send session message");
        const stored = yield* readStoredWorkflowSession(
          tasks,
          {
            repoPath,
            runtimeKind: input.runtimeKind,
            workingDirectory: input.workingDirectory,
            externalSessionId: input.externalSessionId,
            sessionScope: scope,
          },
          "send",
        );
        const runtimeInput: AgentSessionControlSendInput = {
          ...input,
          repoPath,
          runtimeKind: stored.runtimeKind,
          workingDirectory: stored.workingDirectory,
        };
        if (stored.selectedModel) {
          runtimeInput.model = stored.selectedModel;
        } else {
          delete runtimeInput.model;
        }
        return yield* runtime.sendUserMessage(runtimeInput);
      }),
    );
  },
  updateSessionModel: (input) => {
    if (input.sessionScope.kind !== "workflow") {
      return runtime.updateSessionModel(input);
    }
    const scope = input.sessionScope;
    return Effect.scoped(
      Effect.gen(function* () {
        const repoPath = yield* canonicalizeRepoPath(input.repoPath);
        yield* taskLifecycle.acquireLifecycle(repoPath, [scope.taskId], "change session model");
        const stored = yield* readStoredWorkflowSession(
          tasks,
          {
            repoPath,
            runtimeKind: input.runtimeKind,
            workingDirectory: input.workingDirectory,
            externalSessionId: input.externalSessionId,
            sessionScope: scope,
          },
          "update-model",
        );
        const runtimeInput = {
          ...input,
          repoPath,
          runtimeKind: stored.runtimeKind,
          workingDirectory: stored.workingDirectory,
        };
        yield* runtime.updateSessionModel(runtimeInput);
        const profileId = stored.selectedModel?.profileId;
        const selectedModel = input.model
          ? {
              ...input.model,
              runtimeKind: stored.runtimeKind,
              profileId,
            }
          : null;
        const storedUpdate = yield* Effect.either(
          tasks
            .agentSessionUpdateModel({
              repoPath,
              taskId: scope.taskId,
              identity: {
                externalSessionId: stored.externalSessionId,
                runtimeKind: stored.runtimeKind,
                workingDirectory: stored.workingDirectory,
              },
              selectedModel,
            })
            .pipe(
              Effect.flatMap((updated) =>
                updated
                  ? Effect.void
                  : Effect.fail(
                      new HostOperationError({
                        operation: "task-workflow-session.update-model",
                        message: `Task '${scope.taskId}' did not update session '${stored.externalSessionId}'.`,
                        details: {
                          repoPath,
                          taskId: scope.taskId,
                          externalSessionId: stored.externalSessionId,
                        },
                      }),
                    ),
              ),
              Effect.mapError((cause) =>
                toHostOperationError(cause, "task-workflow-session.update-model", {
                  repoPath,
                  taskId: scope.taskId,
                  externalSessionId: stored.externalSessionId,
                }),
              ),
            ),
        );
        if (storedUpdate._tag === "Right") {
          return;
        }
        const restored = yield* Effect.either(
          runtime.updateSessionModel({
            ...runtimeInput,
            model: toRuntimeModel(stored.selectedModel),
          }),
        );
        if (restored._tag === "Left") {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "task-workflow-session.update-model",
              message: `${storedUpdate.left.message} Runtime model restore failed: ${restored.left.message}`,
              cause: {
                storeFailure: storedUpdate.left,
                restoreFailure: restored.left,
              },
              details: {
                repoPath,
                taskId: scope.taskId,
                externalSessionId: stored.externalSessionId,
                storeFailure: storedUpdate.left,
                restoreFailure: restored.left,
              },
            }),
          );
        }
        return yield* Effect.fail(storedUpdate.left);
      }),
    );
  },
});

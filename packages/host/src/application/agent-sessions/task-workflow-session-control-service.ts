import type {
  AgentSessionControlForkInput,
  AgentSessionControlResumeInput,
  AgentSessionControlStartInput,
  AgentSessionControlStopInput,
  AgentSessionControlSummary,
  AgentSessionLiveRef,
  AgentSessionModelSettings,
  AgentSessionRecord,
  AgentSessionWorkflowScope,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { TaskService } from "../tasks/task-service";
import type { TaskSessionBootstrapCoordinator } from "../tasks/worktrees/task-session-bootstrap-coordinator";
import {
  type HostError,
  HostOperationError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import type { AgentSessionLiveStateService } from "./agent-session-live-state-service";

type RuntimeControl = Pick<
  AgentSessionLiveStateService,
  | "startSession"
  | "resumeSession"
  | "forkSession"
  | "updateSessionModel"
  | "stopSession"
  | "releaseSession"
>;

type TaskSessions = Pick<
  TaskService,
  "agentSessionsList" | "agentSessionUpsert" | "agentSessionUpdateModel"
>;

type TaskLifecycle = Pick<TaskSessionBootstrapCoordinator, "acquireLifecycle">;
type CanonicalizeRepoPath = (repoPath: string) => Effect.Effect<string, HostError>;
type StoredWorkflowSessionRef = AgentSessionLiveRef & {
  sessionScope: AgentSessionWorkflowScope;
};

type ControlledLaunchInput =
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
  operation: "read-fork" | "read-resume" | "update-model",
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
  tasks,
  taskLifecycle,
}: {
  canonicalizeRepoPath: CanonicalizeRepoPath;
  runtime: RuntimeControl;
  tasks: TaskSessions;
  taskLifecycle: TaskLifecycle;
}): RuntimeControl => ({
  ...runtime,
  startSession: (input) =>
    Effect.gen(function* () {
      const summary = yield* runtime.startSession(input);
      return yield* storeControlResult(tasks, runtime, input, summary, "stop");
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

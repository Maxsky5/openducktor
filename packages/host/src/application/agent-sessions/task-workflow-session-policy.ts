import type {
  AgentSessionControlSendInput,
  AgentSessionControlSummary,
  AgentSessionLiveRef,
  AgentSessionModelSettings,
  AgentSessionRecord,
  AgentSessionWorkflowScope,
  AgentWorkflowSessionStartInput,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { TaskService } from "../tasks/task-service";
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
import { storeWorkflowSession, toControlSessionRef } from "./task-workflow-session-storage";
import type { AgentSessionOperationPolicy } from "./agent-session-operation-policy";

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

type ControlledWorkflowLaunchInput = {
  repoPath: string;
  sessionScope: AgentSessionWorkflowScope;
  model: AgentWorkflowSessionStartInput["model"] | undefined;
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

const storeControlResult = (
  tasks: TaskSessions,
  runtime: RuntimeControl,
  input: ControlledWorkflowLaunchInput,
  summary: AgentSessionControlSummary,
  cleanup: "release" | "stop",
  selectedModel?: AgentSessionRecord["selectedModel"],
) =>
  Effect.gen(function* () {
    const stored = yield* Effect.either(
      storeWorkflowSession(tasks, {
        repoPath: input.repoPath,
        sessionScope: input.sessionScope,
        model: input.model,
        selectedModel,
        summary,
      }),
    );
    if (stored._tag === "Right") {
      return summary;
    }
    const ref = toControlSessionRef(input.repoPath, summary);
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

export type TaskSessionModelPersistence = (
  input: Parameters<TaskSessions["agentSessionUpdateModel"]>[0],
) => Effect.Effect<{ updated: boolean; publish: Effect.Effect<void, HostError> }, HostError>;

export const createTaskWorkflowSessionPolicy = ({
  canonicalizeRepoPath,
  runtime,
  taskReader,
  tasks,
  taskLifecycle,
  taskSessionStart,
  persistTaskModel,
}: {
  canonicalizeRepoPath: CanonicalizeRepoPath;
  runtime: RuntimeControl;
  taskReader: TaskReader;
  tasks: TaskSessions;
  taskLifecycle: TaskLifecycle;
  taskSessionStart: TaskSessionStartPreparationService;
  persistTaskModel: TaskSessionModelPersistence;
}) => ({
  startWorkflowSession: createStartTaskWorkflowSession({
    canonicalizeRepoPath,
    runtime,
    tasks,
    taskLifecycle,
    taskSessionStart,
  }),
  forkSession: (input: Parameters<RuntimeControl["forkSession"]>[0]) => {
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
        return yield* storeControlResult(
          tasks,
          runtime,
          {
            repoPath,
            sessionScope: scope,
            model: input.model,
          },
          summary,
          "stop",
        );
      }),
    );
  },

  forScope: (scope: AgentSessionWorkflowScope): AgentSessionOperationPolicy => ({
    run: (ref, operation, effect) =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* taskLifecycle.acquireLifecycle(ref.repoPath, [scope.taskId], operation);
          return yield* effect;
        }),
      ),
    validateRef: (ref) =>
      readStoredWorkflowSession(tasks, { ...ref, sessionScope: scope }, "send").pipe(Effect.asVoid),
    prepareResume: (input) =>
      Effect.gen(function* () {
        const stored = yield* readStoredWorkflowSession(
          tasks,
          { ...input, sessionScope: scope },
          "read-resume",
        );
        return {
          input: {
            ...input,
            runtimeKind: stored.runtimeKind,
            workingDirectory: stored.workingDirectory,
          },
          save: (summary: AgentSessionControlSummary) =>
            storeWorkflowSession(tasks, {
              repoPath: input.repoPath,
              sessionScope: scope,
              model: input.model,
              selectedModel: stored.selectedModel,
              summary,
            }),
        };
      }),
    prepareSend: (input) =>
      Effect.gen(function* () {
        const stored = yield* readStoredWorkflowSession(
          tasks,
          { ...input, sessionScope: scope },
          "send",
        );
        const prepared: AgentSessionControlSendInput = {
          ...input,
          runtimeKind: stored.runtimeKind,
          workingDirectory: stored.workingDirectory,
        };
        if (stored.selectedModel) prepared.model = stored.selectedModel;
        else delete prepared.model;
        return prepared;
      }),
    recordAcceptedMessage: () => Effect.void,
    prepareModelUpdate: (input) =>
      Effect.gen(function* () {
        const stored = yield* readStoredWorkflowSession(
          tasks,
          { ...input, sessionScope: scope },
          "update-model",
        );
        const runtimeInput = {
          ...input,
          runtimeKind: stored.runtimeKind,
          workingDirectory: stored.workingDirectory,
        };
        const selectedModel = input.model
          ? {
              ...input.model,
              runtimeKind: stored.runtimeKind,
              profileId: stored.selectedModel?.profileId,
            }
          : null;
        return {
          input: runtimeInput,
          previousModel: toRuntimeModel(stored.selectedModel),
          save: Effect.suspend(() =>
            persistTaskModel({
              repoPath: input.repoPath,
              taskId: scope.taskId,
              identity: {
                externalSessionId: stored.externalSessionId,
                runtimeKind: stored.runtimeKind,
                workingDirectory: stored.workingDirectory,
              },
              selectedModel,
            }),
          ).pipe(
            Effect.flatMap(({ updated, publish }) =>
              updated
                ? Effect.succeed(publish)
                : Effect.fail(
                    new HostOperationError({
                      operation: "task-workflow-session.update-model",
                      message: `Task '${scope.taskId}' did not update session '${stored.externalSessionId}'.`,
                      details: {
                        repoPath: input.repoPath,
                        taskId: scope.taskId,
                        externalSessionId: stored.externalSessionId,
                      },
                    }),
                  ),
            ),
          ),
        };
      }),
  }),
});

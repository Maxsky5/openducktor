import type {
  AgentSessionControlSendInput,
  AgentSessionControlSummary,
  AgentSessionLiveRef,
  AgentSessionModelSelection,
  AgentSessionModelSettings,
  AgentSessionRecord,
  AgentSessionWorkflowScope,
  AgentWorkflowSessionStartInput,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { TaskService } from "../tasks/task-service";
import { type HostError, HostOperationError, toHostOperationError } from "../../effect/host-errors";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import type { TaskSessionStartPreparationService } from "../tasks/worktrees/task-session-start-preparation-service";
import {
  createTaskSessionOperations,
  type TaskSessionProgress,
  type CanonicalizeRepoPath,
  type RuntimeControl,
  type TaskLifecycle,
} from "./task-session-operations";
import { readStoredWorkflowSession, storeWorkflowSession } from "./task-workflow-session-storage";
import type { AgentSessionOperationPolicy } from "./agent-session-operation-policy";

export type TaskSessions = Pick<
  TaskService,
  "agentSessionsList" | "agentSessionUpsert" | "transitionTask"
>;
type TaskReader = Pick<TaskStorePort, "getTask">;

export type TaskSessionModelPersistence = (
  input: Parameters<TaskService["agentSessionUpdateModel"]>[0],
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
  taskSessionStart: Pick<TaskSessionStartPreparationService, "prepare" | "complete">;
  persistTaskModel: TaskSessionModelPersistence;
}) => {
  const progress: TaskSessionProgress = {
    checkCanceled: () => Effect.void,
    created: () => Effect.void,
    saved: () => {},
    stop: runtime.stopSession,
  };
  const operations = createTaskSessionOperations({
    canonicalizeRepoPath,
    runtime,
    tasks,
    taskReader,
    taskLifecycle,
    taskSessionStart,
    writes: {
      saveSession: (input) =>
        tasks.agentSessionUpsert(input).pipe(Effect.as({ publish: Effect.void })),
      transitionTask: (input) =>
        tasks.transitionTask(input).pipe(Effect.map((task) => ({ task, publish: Effect.void }))),
    },
  });
  return {
    startWorkflowSession: (input: AgentWorkflowSessionStartInput) =>
      operations.start(input, progress).pipe(
        Effect.flatMap(({ session, publish }) =>
          publish.pipe(
            Effect.as(session),
            Effect.mapError((cause) => toHostOperationError(cause, "task-workflow-session.create")),
          ),
        ),
      ),
    forkSession: (input: Parameters<RuntimeControl["forkSession"]>[0]) =>
      operations.fork(input, progress).pipe(
        Effect.flatMap(({ session, publish }) =>
          publish.pipe(
            Effect.as(session),
            Effect.mapError((cause) => toHostOperationError(cause, "task-workflow-session.create")),
          ),
        ),
      ),

    forScope: (scope: AgentSessionWorkflowScope): AgentSessionOperationPolicy => {
      const runOperation = <A, E, R>(
        ref: AgentSessionLiveRef,
        operation: string,
        effect: Effect.Effect<A, E, R>,
      ): Effect.Effect<A, E | HostError, R> =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* taskLifecycle.acquireLifecycle(ref.repoPath, [scope.taskId], operation);
            return yield* effect;
          }),
        );
      return {
        run: runOperation,
        runSend: (ref, effect) => runOperation(ref, "send session message", effect),
        validateRef: (ref) =>
          readStoredWorkflowSession(tasks, { ...ref, sessionScope: scope }, "send").pipe(
            Effect.asVoid,
          ),
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
                model: stored.selectedModel ?? input.model,
                runtimeKind: stored.runtimeKind,
                workingDirectory: stored.workingDirectory,
                speed: stored.speed === undefined ? "standard" : stored.speed,
              },
              save: (summary: AgentSessionControlSummary) =>
                storeWorkflowSession(tasks.agentSessionUpsert, {
                  repoPath: input.repoPath,
                  sessionScope: scope,
                  model: input.model,
                  selectedModel: stored.selectedModel,
                  summary,
                }).pipe(Effect.asVoid),
            };
          }),
        prepareSend: (input) =>
          Effect.gen(function* () {
            const stored = yield* readStoredWorkflowSession(
              tasks,
              { ...input, sessionScope: scope },
              "send",
            );
            const prepared: AgentSessionControlSendInput & { speed?: string | null } = {
              ...input,
              speed: stored.speed === undefined ? "standard" : stored.speed,
              runtimeKind: stored.runtimeKind,
              workingDirectory: stored.workingDirectory,
            };
            if (stored.selectedModel) prepared.model = stored.selectedModel;
            else delete prepared.model;
            return prepared;
          }),
        recordAcceptedMessage: () => Effect.void,
        prepareSpeedUpdate: (input) =>
          Effect.gen(function* () {
            const stored = yield* readStoredWorkflowSession(
              tasks,
              { ...input, sessionScope: scope },
              "update-model",
            );
            return {
              model: toRuntimeModel(stored.selectedModel),
              choice: stored.speed === undefined ? "standard" : stored.speed,
              save: (speed, model) =>
                Effect.gen(function* () {
                  const current = yield* readStoredWorkflowSession(
                    tasks,
                    { ...input, sessionScope: scope },
                    "update-model",
                  );
                  return yield* persistTaskModel({
                    repoPath: input.repoPath,
                    taskId: scope.taskId,
                    identity: {
                      externalSessionId: current.externalSessionId,
                      runtimeKind: current.runtimeKind,
                      workingDirectory: current.workingDirectory,
                    },
                    selectedModel: model
                      ? toRecordModelSelection(model, current)
                      : (current.selectedModel ?? null),
                    speed,
                  });
                }).pipe(
                  Effect.flatMap(({ updated, publish }) =>
                    updated
                      ? Effect.succeed(publish)
                      : Effect.fail(
                          new HostOperationError({
                            operation: "task-workflow-session.update-speed",
                            message: `Task '${scope.taskId}' no longer owns session '${stored.externalSessionId}'.`,
                          }),
                        ),
                  ),
                ),
            };
          }),
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
            const selectedModel = input.model ? toRecordModelSelection(input.model, stored) : null;
            return {
              input: runtimeInput,
              previousModel: toRuntimeModel(stored.selectedModel),
              previousSpeed: stored.speed === undefined ? "standard" : stored.speed,
              save: (speed) =>
                Effect.suspend(() =>
                  persistTaskModel({
                    repoPath: input.repoPath,
                    taskId: scope.taskId,
                    identity: {
                      externalSessionId: stored.externalSessionId,
                      runtimeKind: stored.runtimeKind,
                      workingDirectory: stored.workingDirectory,
                    },
                    selectedModel,
                    speed:
                      speed === undefined
                        ? stored.speed === undefined
                          ? "standard"
                          : stored.speed
                        : speed,
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
      };
    },
  };
};

const toRuntimeModel = (
  selectedModel: AgentSessionRecord["selectedModel"],
): AgentSessionModelSettings | null => {
  if (!selectedModel) {
    return null;
  }
  const { providerId, modelId, variant, profileId } = selectedModel;
  const model: AgentSessionModelSettings = { providerId, modelId };
  if (variant !== undefined) model.variant = variant;
  if (selectedModel.runtimeKind === "opencode" && profileId !== undefined)
    model.profileId = profileId;
  return model;
};

const toRecordModelSelection = (
  model: AgentSessionModelSettings,
  stored: AgentSessionRecord,
): AgentSessionModelSelection => {
  const selection: AgentSessionModelSelection = {
    runtimeKind: stored.runtimeKind,
    providerId: model.providerId,
    modelId: model.modelId,
  };
  if (model.variant !== undefined) {
    selection.variant = model.variant;
  }
  const profileId = model.profileId ?? stored.selectedModel?.profileId;
  if (profileId !== undefined) {
    selection.profileId = profileId;
  }
  return selection;
};

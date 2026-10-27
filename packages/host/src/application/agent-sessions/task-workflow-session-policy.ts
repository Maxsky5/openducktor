import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";
import type {
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
import type {
  AgentSessionOperationPolicy,
  AgentSessionSendContent,
} from "./agent-session-operation-policy";

export type TaskSessions = Pick<
  TaskService,
  "agentSessionsList" | "agentSessionUpsert" | "agentSessionUpdateModel" | "applyStartEvent"
>;
type TaskReader = Pick<TaskStorePort, "getTask">;

export type TaskSessionModelPersistence = (
  input: Parameters<TaskSessions["agentSessionUpdateModel"]>[0],
) => Effect.Effect<{ updated: boolean; publish: Effect.Effect<void, HostError> }, HostError>;

export const createTaskWorkflowSessionPolicy = ({
  canonicalizeRepoPath,
  runtime,
  taskReader,
  taskWorkflows,
  tasks,
  taskLifecycle,
  taskSessionStart,
  persistTaskModel,
  resolveRoot,
}: {
  canonicalizeRepoPath: CanonicalizeRepoPath;
  runtime: RuntimeControl;
  taskReader: TaskReader;
  taskWorkflows: TaskWorkflowResolver;
  tasks: TaskSessions;
  taskLifecycle: TaskLifecycle;
  taskSessionStart: Pick<TaskSessionStartPreparationService, "prepare" | "complete">;
  persistTaskModel: TaskSessionModelPersistence;
  resolveRoot: (
    ref: AgentSessionLiveRef,
  ) => Effect.Effect<import("@openducktor/contracts").AgentSessionAuthorizedRoot, HostError>;
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
    taskWorkflows,
    taskLifecycle,
    taskSessionStart,
    writes: {
      saveSession: (input) =>
        tasks.agentSessionUpsert(input).pipe(Effect.as({ publish: Effect.void })),
      applyStartEvent: (input) =>
        tasks.applyStartEvent(input).pipe(Effect.map((task) => ({ task, publish: Effect.void }))),
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
      operations
        .fork(input, {
          ...progress,
          workStartGuard: input.workStartGuard,
          checkCanceled: () =>
            Effect.try({
              try: () => input.workStartGuard?.assertCurrent(),
              catch: (cause) => toHostOperationError(cause, "task.fork.canceled"),
            }),
        })
        .pipe(
          Effect.flatMap(({ session, publish }) =>
            publish.pipe(
              Effect.as(session),
              Effect.mapError((cause) =>
                toHostOperationError(cause, "task-workflow-session.create"),
              ),
            ),
          ),
        ),

    forScope: (scope: AgentSessionWorkflowScope): AgentSessionOperationPolicy => {
      const readStored = (
        input: AgentSessionLiveRef,
        operation: "read-resume" | "send" | "update-model",
      ) =>
        Effect.gen(function* () {
          const root = yield* resolveRoot(input);
          return yield* readStoredWorkflowSession(
            tasks,
            { ...root, sessionScope: scope },
            operation,
          );
        });
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
        validateRef: (ref) => readStored(ref, "send").pipe(Effect.asVoid),
        prepareResume: (input) =>
          Effect.gen(function* () {
            const stored = yield* readStored(input, "read-resume");
            return {
              input: {
                ...input,
                runtimeKind: stored.runtimeKind,
                workingDirectory:
                  input.externalSessionId === stored.externalSessionId
                    ? stored.workingDirectory
                    : input.workingDirectory,
                model:
                  input.externalSessionId === stored.externalSessionId
                    ? (stored.selectedModel ?? undefined)
                    : undefined,
              },
              save: (summary: AgentSessionControlSummary) => {
                if (summary.externalSessionId !== stored.externalSessionId) return Effect.void;
                const selectedModel = summary.model
                  ? { ...summary.model, runtimeKind: summary.runtimeKind }
                  : stored.selectedModel;
                return storeWorkflowSession(tasks.agentSessionUpsert, {
                  repoPath: input.repoPath,
                  sessionScope: scope,
                  model: selectedModel ?? undefined,
                  selectedModel,
                  summary,
                }).pipe(Effect.asVoid);
              },
            };
          }),
        prepareForkSource: (input) =>
          readStored(input, "send").pipe(Effect.map((stored) => ({ model: stored.selectedModel }))),
        prepareSend: (input) =>
          Effect.gen(function* () {
            const stored = yield* readStored(input, "send");
            const prepared: AgentSessionSendContent = {
              ...input,
              runtimeKind: stored.runtimeKind,
              workingDirectory: stored.workingDirectory,
            };
            return prepared;
          }),
        recordAcceptedMessage: () => Effect.void,
        prepareModelUpdate: (input) =>
          Effect.gen(function* () {
            const stored = yield* readStored(input, "update-model");
            if (input.externalSessionId !== stored.externalSessionId)
              return yield* new HostOperationError({
                operation: "session.update-model",
                message:
                  "A child session has no saved model record. Change the model of its owned root or start a new workflow session.",
              });
            const runtimeInput = {
              ...input,
              runtimeKind: stored.runtimeKind,
              workingDirectory: stored.workingDirectory,
            };
            const selectedModel = input.model ? toRecordModelSelection(input.model, stored) : null;
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
  const { providerId, modelId, variant, profileId, speed } = selectedModel;
  const model: AgentSessionModelSettings = { providerId, modelId };
  if (variant !== undefined) model.variant = variant;
  if (speed !== undefined) model.speed = speed;
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
  if (model.speed !== undefined) {
    selection.speed = model.speed;
  }
  return selection;
};

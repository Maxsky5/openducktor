import {
  type ExternalTaskSyncEvent,
  type TaskAutoCloseFailure,
  type WorkspaceRef,
  type TaskArtifactChange,
  type TaskEventCursor,
  externalTaskSyncEventSchema,
  type TaskCard,
  type TaskChangeSet,
  type TaskEventTaskSnapshot,
  type TaskEventStatusChange,
} from "@openducktor/contracts";
import { Effect, type Result } from "effect";
import { createSerialGate } from "../../../effect/serial-gate";
import { HostOperationError, type HostOperationErrorAggregate } from "../../../effect/host-errors";
import type { TaskEventStreamPort } from "../../../events/task-event-stream";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import {
  collectTaskStatusChanges,
  collectTaskMutationChanges,
} from "../../../ports/task-status-changes";
import { TaskMutationProgressFailure } from "../task-mutation-progress-failure";
import type {
  CommittedTaskStatusChange,
  CommittedTaskStatusChangeObserver,
  TaskMutationOperation,
} from "../task-mutation-operation";
import type { RepoPullRequestSyncResult, TaskService, TaskServiceError } from "../task-service";
import { workspaceSyncSkip } from "./pull-request-sync-target";
import type { TaskMergeDetectionService } from "../merge-detection/task-merge-detection-service";
import { syncedMergedTaskFailure } from "../support/close-synced-merged-task";
import {
  type CreateTaskSyncLoopInput,
  createTaskSyncLoop,
  type TaskSyncLoop,
} from "./task-sync-loop";

export type { TaskSyncError, TaskSyncLifecycleLogger, TaskSyncLoopHandle } from "./task-sync-loop";
export type TaskSyncService = TaskSyncLoop & {
  runMutation<A, E, R>(repoPath: string, mutation: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>;
  /**
   * Runs a task mutation in the repository mutation gate. It reports each status change when it
   * commits, so a later failure or interruption keeps the report. `afterCommit` runs next in the
   * same gate turn.
   */
  runStatusMutation<A, E, R, B, E2, R2>(
    workspace: WorkspaceRef,
    operation: TaskMutationOperation,
    mutation: Effect.Effect<A, E, R>,
    afterCommit: (committed: {
      result: Result.Result<A, E>;
      statusChanges: TaskEventStatusChange[];
    }) => Effect.Effect<B, E2, R2>,
  ): Effect.Effect<B, E2, R | R2>;
  publishExternalTaskCreated(
    workspace: WorkspaceRef,
    taskSnapshot: TaskEventTaskSnapshot,
  ): Effect.Effect<void, HostOperationErrorAggregate>;
  publishTasksUpdated(
    workspace: WorkspaceRef,
    changes: TaskChangeSet,
    operation: TaskMutationOperation,
    statusChanges: readonly TaskEventStatusChange[],
    mutationFailure?: TaskServiceError,
    artifactChanges?: TaskArtifactChange[],
  ): Effect.Effect<TaskEventCursor, HostOperationErrorAggregate>;
  syncRepoPullRequests(
    repoPath: string,
    expectedWorkspaceId: string,
  ): Effect.Effect<RepoPullRequestSyncResult, TaskServiceError>;
};
type TaskEventPublicationFailureBase = {
  operation: string;
  repoPath: string;
  changes: TaskChangeSet;
  cause: unknown;
};
export type TaskEventPublicationFailure =
  | (TaskEventPublicationFailureBase & {
      stage: "acceptance";
      event: ExternalTaskSyncEvent;
    })
  | (TaskEventPublicationFailureBase & { stage: "snapshot" });
export type TaskEventPublicationReporter = {
  report(failure: TaskEventPublicationFailure): Effect.Effect<void, never>;
};
export type CreateTaskSyncServiceInput = Omit<
  CreateTaskSyncLoopInput,
  "syncRepoPullRequests" | "workspaceSettingsService" | "mergeDetection"
> & {
  eventIdFactory?: () => string;
  acceptNotificationInput?: ((event: ExternalTaskSyncEvent) => void) | undefined;
  /** Notifies the first failure of a merged task that the pull request sync could not close. */
  notifyAutoCloseBlocked?:
    | ((workspace: WorkspaceRef, failure: TaskAutoCloseFailure) => void)
    | undefined;
  mergeDetection: Pick<TaskMergeDetectionService, "runPass" | "recordAutoCloseFailures">;
  observeStatusChanges?: CommittedTaskStatusChangeObserver | undefined;
  publicationReporter: TaskEventPublicationReporter;
  taskEventStream: TaskEventStreamPort;
  taskService: Pick<TaskService, "listTasks" | "repoPullRequestSyncDetailed">;
  settingsConfig: Pick<SettingsConfigPort, "readGlobalConfig">;
  workspaceSettingsService: Pick<
    WorkspaceSettingsService,
    "listWorkspaces" | "getWorkspaceCatalog"
  >;
};
export const createTaskSyncService = ({
  eventIdFactory = () => crypto.randomUUID(),
  acceptNotificationInput,
  notifyAutoCloseBlocked,
  observeStatusChanges,
  intervalMs,
  logger,
  mergeDetection,
  onBackgroundFailure,
  publicationReporter,
  taskEventStream,
  taskService,
  settingsConfig,
  workspaceSettingsService,
}: CreateTaskSyncServiceInput): TaskSyncService => {
  // Mutations of one repository run in arrival order.
  const mutationGate = createSerialGate();
  const runMutation: TaskSyncService["runMutation"] = (repoPath, mutation) =>
    mutationGate.run(repoPath, mutation);
  const runStatusMutation: TaskSyncService["runStatusMutation"] = (
    workspace,
    operation,
    mutation,
    afterCommit,
  ) => {
    const commitAndPublish = collectTaskStatusChanges(
      collectTaskMutationChanges(mutation, (commits, statusChanges) => {
        const taskIds = [...new Set(commits.flatMap((commit) => commit.taskIds))];
        const publication =
          operation === "create-task"
            ? Effect.gen(function* () {
                const tasks = yield* taskService.listTasks({ ...workspace, taskIds });
                for (const task of tasks) yield* publishExternalTaskCreated(workspace, task);
              })
            : publishTasksUpdated(
                workspace,
                {
                  taskIds,
                  removedTaskIds: [...new Set(commits.flatMap((commit) => commit.removedTaskIds))],
                },
                operation,
                statusChanges,
                undefined,
                commits.flatMap((commit) => commit.artifactChanges),
              );
        return publication.pipe(
          Effect.asVoid,
          Effect.catch((failure) =>
            onBackgroundFailure(
              new HostOperationError({
                operation: "task.publish-interrupted-mutation",
                message: failure.message,
                cause: failure,
              }),
            ),
          ),
        );
      }),
      (statusChange, signal, metadata) => {
        const change: CommittedTaskStatusChange = {
          ...workspace,
          operation,
          statusChange,
          ...metadata,
        };
        if (signal !== undefined) change.signal = signal;
        observeStatusChanges?.(change);
      },
    ).pipe(Effect.flatMap(afterCommit));
    return runMutation(workspace.repoPath, commitAndPublish);
  };
  const publish = (
    event: ExternalTaskSyncEvent,
    operation: string,
    repoPath: string,
    changes: TaskChangeSet,
    mutationFailure?: TaskServiceError,
  ): Effect.Effect<TaskEventCursor, HostOperationErrorAggregate> =>
    Effect.gen(function* () {
      const eventValidation = externalTaskSyncEventSchema.safeParse(event);
      const result = yield* Effect.result(
        eventValidation.success
          ? Effect.try({ try: () => taskEventStream.publish(event), catch: (cause) => cause })
          : Effect.fail(eventValidation.error),
      );
      if (result._tag === "Failure") {
        const failure: TaskEventPublicationFailure = {
          operation,
          repoPath,
          changes,
          event,
          stage: "acceptance",
          cause: result.failure,
        };
        yield* publicationReporter.report(failure);
        return yield* publicationError(failure, mutationFailure);
      }
      return result.success;
    });
  const readBoardChanges = (workspaceId: string, repoPath: string, taskIds: string[]) =>
    Effect.gen(function* () {
      const settings = yield* settingsConfig.readGlobalConfig();
      const doneVisibleDays = settings.kanban.doneVisibleDays;
      const cards =
        taskIds.length > 0 ? yield* taskService.listTasks({ workspaceId, repoPath, taskIds }) : [];
      return { cards, doneVisibleDays };
    });
  const publishExternalTaskCreated: TaskSyncService["publishExternalTaskCreated"] = (
    { workspaceId, repoPath },
    taskSnapshot,
  ) =>
    Effect.gen(function* () {
      const event = buildExternalTaskCreatedEvent(
        eventIdFactory,
        workspaceId,
        repoPath,
        taskSnapshot,
      );
      acceptNotificationInput?.(event);
      const changes = { taskIds: [taskSnapshot.id], removedTaskIds: [] };
      const board = yield* Effect.result(readBoardChanges(workspaceId, repoPath, changes.taskIds));
      if (board._tag === "Failure") {
        const failure: TaskEventPublicationFailure = {
          operation: "create-task",
          repoPath,
          changes,
          stage: "snapshot",
          cause: board.failure,
        };
        yield* publicationReporter.report(failure);
        return yield* publicationError(failure);
      }
      yield* publish(
        { ...event, boardChanges: { ...board.success, artifactChanges: [] } },
        "create-task",
        repoPath,
        changes,
      );
    });
  const publishTasksUpdated: TaskSyncService["publishTasksUpdated"] = (
    { workspaceId, repoPath },
    changes: TaskChangeSet,
    operation: TaskMutationOperation,
    statusChanges: readonly TaskEventStatusChange[],
    mutationFailure?: TaskServiceError,
    artifactChanges: TaskArtifactChange[] = [],
  ): Effect.Effect<TaskEventCursor, HostOperationErrorAggregate> =>
    Effect.gen(function* () {
      const event = buildTasksUpdatedEvent(
        eventIdFactory,
        workspaceId,
        repoPath,
        changes,
        statusChanges,
      );
      acceptNotificationInput?.(event);
      if (operation.startsWith("agent-session-") && statusChanges.length === 0) {
        return yield* publish(event, operation, repoPath, changes, mutationFailure);
      }
      const tasks = yield* Effect.result(
        readBoardChanges(
          workspaceId,
          repoPath,
          changes.taskIds.filter((id) => !changes.removedTaskIds.includes(id)),
        ),
      );
      if (tasks._tag === "Failure") {
        const failure: TaskEventPublicationFailure = {
          operation,
          repoPath,
          changes,
          stage: "snapshot",
          cause: tasks.failure,
        };
        yield* publicationReporter.report(failure);
        return yield* publicationError(failure, mutationFailure);
      }
      const taskSnapshots = taskSnapshotsForChanges(tasks.success.cards, changes);
      acceptNotificationInput?.({ ...event, taskSnapshots });
      return yield* publish(
        { ...event, taskSnapshots, boardChanges: { ...tasks.success, artifactChanges } },
        operation,
        repoPath,
        changes,
        mutationFailure,
      );
    });
  const syncRepoPullRequests = (
    repoPath: string,
    expectedWorkspaceId: string,
  ): Effect.Effect<RepoPullRequestSyncResult, TaskServiceError> =>
    runStatusMutation(
      { workspaceId: expectedWorkspaceId, repoPath },
      "repo-pull-request-sync",
      Effect.gen(function* () {
        const catalog = yield* workspaceSettingsService.getWorkspaceCatalog();
        const skip = workspaceSyncSkip(catalog, repoPath, expectedWorkspaceId);
        if (skip) return skip;
        return yield* taskService.repoPullRequestSyncDetailed({
          workspaceId: expectedWorkspaceId,
          repoPath,
        });
      }),
      ({ result: syncResult, statusChanges }) =>
        Effect.gen(function* () {
          if (syncResult._tag === "Success") {
            const changes = { taskIds: syncResult.success.changedTaskIds, removedTaskIds: [] };
            if (changes.taskIds.length > 0) {
              yield* publishTasksUpdated(
                { workspaceId: expectedWorkspaceId, repoPath },
                changes,
                "repo-pull-request-sync",
                statusChanges,
              );
            }
            if (!syncResult.success.ran) return syncResult.success;
            const { autoCloseFailures } = syncResult.success;
            const workspace = { workspaceId: expectedWorkspaceId, repoPath };
            const blocked = yield* mergeDetection.recordAutoCloseFailures(
              workspace,
              autoCloseFailures.map(({ taskId, failure }) => ({
                taskId,
                message: failure.message,
              })),
            );
            for (const failure of blocked) notifyAutoCloseBlocked?.(workspace, failure);
            const failure = syncedMergedTaskFailure(autoCloseFailures);
            if (failure) return yield* Effect.fail(failure);
            return syncResult.success;
          }
          if (syncResult.failure instanceof TaskMutationProgressFailure) {
            yield* publishTasksUpdated(
              { workspaceId: expectedWorkspaceId, repoPath },
              syncResult.failure.changes,
              syncResult.failure.operation,
              statusChanges,
              syncResult.failure.failure,
              syncResult.failure.artifactChanges,
            );
            return yield* Effect.fail(syncResult.failure.failure);
          }
          return yield* Effect.fail(syncResult.failure);
        }),
    );
  return {
    runMutation,
    runStatusMutation,
    publishExternalTaskCreated,
    publishTasksUpdated,
    syncRepoPullRequests,
    ...createTaskSyncLoop({
      intervalMs,
      logger,
      mergeDetection,
      onBackgroundFailure,
      syncRepoPullRequests,
      workspaceSettingsService,
    }),
  };
};

const nowIso = (): string => new Date().toISOString();
const buildExternalTaskCreatedEvent = (
  eventIdFactory: () => string,
  workspaceId: string,
  repoPath: string,
  taskSnapshot: TaskEventTaskSnapshot,
): ExternalTaskSyncEvent => ({
  eventId: eventIdFactory(),
  kind: "external_task_created",
  workspaceId,
  repoPath,
  taskId: taskSnapshot.id,
  taskSnapshot: {
    id: taskSnapshot.id,
    title: taskSnapshot.title,
    status: taskSnapshot.status,
    workflow: taskSnapshot.workflow,
  },
  boardChanges: null,
  emittedAt: nowIso(),
});
const buildTasksUpdatedEvent = (
  eventIdFactory: () => string,
  workspaceId: string,
  repoPath: string,
  changes: TaskChangeSet,
  statusChanges: readonly TaskEventStatusChange[],
): Extract<ExternalTaskSyncEvent, { kind: "tasks_updated" }> => ({
  eventId: eventIdFactory(),
  kind: "tasks_updated",
  workspaceId,
  repoPath,
  ...changes,
  taskSnapshots: [],
  statusChanges: [...statusChanges],
  boardChanges: null,
  emittedAt: nowIso(),
});
const taskSnapshotsForChanges = (
  tasks: readonly TaskCard[],
  changes: TaskChangeSet,
): TaskEventTaskSnapshot[] => {
  const changedTaskIds = new Set(changes.taskIds);
  const removedTaskIds = new Set(changes.removedTaskIds);
  return tasks
    .filter((task) => changedTaskIds.has(task.id) && !removedTaskIds.has(task.id))
    .map(({ id, title, status, workflow }) => ({ id, title, status, workflow }));
};

const publicationError = (
  failure: TaskEventPublicationFailure,
  mutationFailure?: TaskServiceError,
): HostOperationErrorAggregate => {
  const { operation, repoPath, changes, stage } = failure;
  let cause = failure.cause;
  if (mutationFailure) {
    cause =
      stage === "acceptance"
        ? { mutationFailure, publicationFailure: cause }
        : { mutationFailure, snapshotFailure: cause };
  }
  const message =
    "Task changes were saved, but their update event could not be sent. Reload the workspace before continuing. Do not repeat the change.";
  return new HostOperationError({
    operation: `${operation}.publish-task-update`,
    message: mutationFailure ? `${mutationFailure.message} ${message}` : message,
    cause,
    details: { durableState: "committed", stage, repoPath, changes },
  });
};

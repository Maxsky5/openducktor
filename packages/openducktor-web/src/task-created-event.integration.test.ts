import { expect, mock, test } from "bun:test";
import type { TaskCard, TaskEventStreamFrame } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { Deferred, Effect, Fiber } from "effect";
import { createSqliteTaskStoreHarness } from "../../host/src/adapters/sqlite/sqlite-task-store-test-support";
import { createEventPublishingTaskService } from "../../host/src/application/tasks/event-publishing-task-service";
import { createTaskSyncService } from "../../host/src/application/tasks/sync/task-sync-service";
import {
  noMergeDetection,
  syncWorkspace,
} from "../../host/src/application/tasks/sync/task-sync-service.test-support";
import { createTaskServiceWithMutationProgress } from "../../host/src/application/tasks/task-service";
import { createDefaultGlobalConfig } from "../../host/src/config/global-config";
import { createTaskEventStream } from "../../host/src/events/task-event-stream";
import { builtinTaskWorkflows } from "../../host/src/test-support/task-workflows";
import { createTaskViewSync } from "../../frontend-core/src/queries/task-view-sync";
import { taskQueryKeys } from "../../frontend-core/src/queries/tasks";

test.each(["returned", "interrupted"] as const)(
  "%s committed creates update cached board cards and IDs from one task event",
  async (outcome) => {
    const harness = await createSqliteTaskStoreHarness();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const epoch = "11111111-1111-4111-8111-111111111111";
    const frames: TaskEventStreamFrame[] = [];
    const failures: unknown[] = [];
    const stream = createTaskEventStream({
      epochFactory: () => epoch,
      reporter: { report: (failure) => failures.push(failure) },
    });
    const subscription = stream.subscribe({ cursor: { epoch, sequence: 0 } }, (frame) => {
      frames.push(frame);
    });
    try {
      const { scope, store } = harness;
      const base = createTaskServiceWithMutationProgress({
        taskWorkflows: builtinTaskWorkflows,
        taskStore: store,
      });
      const readCards = mock(base.listTasks);
      const config = createDefaultGlobalConfig();
      config.kanban.doneVisibleDays = 7;
      const taskSync = createTaskSyncService({
        taskService: { ...base, listTasks: readCards },
        mergeDetection: noMergeDetection,
        taskEventStream: stream,
        settingsConfig: { readGlobalConfig: () => Effect.succeed(config) },
        workspaceSettingsService: {
          getWorkspaceCatalog: () =>
            Effect.succeed({
              catalogRevision: 0,
              openWorkspaces: [syncWorkspace(scope.repoPath, scope.workspaceId)],
              closedWorkspaces: [],
              incompleteRemovals: [],
            }),
          listWorkspaces: () => Effect.succeed([]),
        },
        publicationReporter: {
          report: (failure) =>
            Effect.sync(() => {
              failures.push(failure);
            }),
        },
        onBackgroundFailure: (failure) =>
          Effect.sync(() => {
            failures.push(failure);
          }),
      });
      const committed = Deferred.makeUnsafe<TaskCard>();
      const service = createEventPublishingTaskService({
        taskWorkflows: builtinTaskWorkflows,
        taskService:
          outcome === "interrupted"
            ? {
                ...base,
                createTask: (input) =>
                  base.createTask(input).pipe(
                    Effect.tap((card) => Deferred.succeed(committed, card)),
                    Effect.andThen(Effect.never),
                  ),
              }
            : base,
        taskSyncService: taskSync,
      });
      const listTasks = mock(async () => {
        throw new Error("A created task event must update the cache without another task read.");
      });
      const sync = createTaskViewSync({
        queryClient,
        ports: {
          listTasks,
          loadFreshDocument: async () => ({ markdown: "", updatedAt: null }),
        },
      });
      queryClient.setQueryData(taskQueryKeys.repoData(scope), { tasks: [] });
      queryClient.setQueryData(taskQueryKeys.ids(scope), []);

      const create = service.createTask({
        ...scope,
        task: { title: "Created task", issueType: "task", priority: 2 },
      });
      const created = await Effect.runPromise(
        outcome === "interrupted"
          ? Effect.scoped(
              Effect.gen(function* () {
                const pending = yield* Effect.forkScoped(create);
                const card = yield* Deferred.await(committed);
                yield* Fiber.interrupt(pending);
                return card;
              }),
            )
          : create,
      );
      await Promise.resolve();
      expect(frames).toHaveLength(1);
      const frame = frames[0]!;
      expect(frame.type).toBe("change");
      if (frame.type !== "change") throw new Error("Expected the committed create event.");
      await sync.reconcileExternalEvent(frame.event, frame.cursor);

      expect(
        queryClient.getQueryData<{ tasks: TaskCard[] }>(taskQueryKeys.repoData(scope))?.tasks,
      ).toEqual([created]);
      expect(queryClient.getQueryData<string[]>(taskQueryKeys.ids(scope))).toEqual([created.id]);
      expect(frame.event).toMatchObject({
        kind: "external_task_created",
        boardChanges: { cards: [created], doneVisibleDays: 7, artifactChanges: [] },
      });
      expect(readCards.mock.calls.every(([input]) => input.taskIds?.length === 1)).toBe(true);
      expect(readCards).toHaveBeenCalledWith({ ...scope, taskIds: [created.id] });
      expect(frame.cursor).toEqual({ epoch, sequence: 1 });
      expect(listTasks).not.toHaveBeenCalled();
      expect(failures).toEqual([]);
    } finally {
      subscription.unsubscribe();
      queryClient.clear();
      await harness.cleanup();
    }
  },
);

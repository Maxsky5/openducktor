import { describe, expect, mock, test } from "bun:test";
import type {
  ExternalTaskSyncEvent,
  TaskCard,
  TaskCreateInput,
  TaskEventStreamFrame,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { createDefaultGlobalConfig } from "../../../config/global-config";
import { createSqliteTaskStoreHarness } from "../../../adapters/sqlite/sqlite-task-store-test-support";
import { createTaskServiceWithMutationProgress } from "../task-service";
import { createEventPublishingTaskService } from "../event-publishing-task-service";
import { createTaskSyncServiceForTest } from "./task-sync-service.test-support";
import { createTaskSyncService } from "./task-sync-service";
import { createTaskEventStream } from "../../../events/task-event-stream";

describe("committed task cards", () => {
  test("save receipts match published cursors across a same-timestamp reset", async () => {
    const timestamp = "2026-04-10T13:10:00.000Z";
    const harness = await createSqliteTaskStoreHarness({ now: () => new Date(timestamp) });
    const epoch = "11111111-1111-4111-8111-111111111111";
    const frames: TaskEventStreamFrame[] = [];
    const failures: unknown[] = [];
    const stream = createTaskEventStream({
      epochFactory: () => epoch,
      reporter: { report: (error) => failures.push(error) },
    });
    const subscription = stream.subscribe({ cursor: { epoch, sequence: 0 } }, (frame) => {
      frames.push(frame);
    });
    try {
      const { repoPath, store } = harness;
      const task = await Effect.runPromise(
        store.createTask({
          repoPath,
          task: { title: "Task", issueType: "task", priority: 2, aiReviewEnabled: true },
        }),
      );
      const base = {
        ...createTaskServiceWithMutationProgress({ taskStore: store }),
        resetTask: (input: { repoPath: string; taskId: string }) =>
          Effect.gen(function* () {
            yield* store.clearWorkflowDocuments(input);
            return yield* store.getTask(input);
          }),
      };
      const sync = createTaskSyncService({
        taskService: base,
        taskEventStream: stream,
        workspaceSettingsService: {
          listWorkspaces: () => Effect.succeed([]),
          getSettingsSnapshot: () => Effect.succeed(createDefaultGlobalConfig()),
        },
        publicationReporter: { report: () => Effect.void },
        onBackgroundFailure: () => Effect.void,
      });
      const service = createEventPublishingTaskService({
        taskService: base,
        taskSyncService: sync,
      });
      const before = await Effect.runPromise(
        service.saveSpecDocument({ repoPath, taskId: task.id, markdown: "# Before" }),
      );
      await Effect.runPromise(service.resetTask({ repoPath, taskId: task.id }));
      const after = await Effect.runPromise(
        service.saveSpecDocument({ repoPath, taskId: task.id, markdown: "# After" }),
      );
      await Effect.runPromise(
        service.updateTask({ repoPath, taskId: task.id, patch: { title: "Renamed" } }),
      );
      await Promise.resolve();
      expect(before.updatedAt).toBe(timestamp);
      expect(after.updatedAt).toBe(timestamp);
      expect(frames).toHaveLength(4);
      expect(before.cursor).toEqual(frames[0]!.cursor);
      expect(after.cursor).toEqual(frames[2]!.cursor);
      expect(frames.map((frame) => frame.cursor.sequence)).toEqual([1, 2, 3, 4]);
      expect(
        frames.map((frame) =>
          frame.type === "change" ? frame.event.boardChanges?.documentChanges : null,
        ),
      ).toEqual([
        [{ taskId: task.id, sections: ["spec"] }],
        [{ taskId: task.id, sections: ["spec", "plan", "qa"] }],
        [{ taskId: task.id, sections: ["spec"] }],
        [],
      ]);
      expect(
        (await Effect.runPromise(store.getTaskMetadata({ repoPath, taskId: task.id }))).spec
          .markdown,
      ).toBe("# After");
      expect(failures).toEqual([]);
    } finally {
      subscription.unsubscribe();
      await harness.cleanup();
    }
  });

  test("projects changed cards and both parents when a child moves between epics", async () => {
    const harness = await createSqliteTaskStoreHarness();
    try {
      const { repoPath, store } = harness;
      const create = (title: string, issueType: "epic" | "task", parentId?: string) => {
        const task: TaskCreateInput = { title, issueType, priority: 2, aiReviewEnabled: true };
        if (parentId) task.parentId = parentId;
        return Effect.runPromise(store.createTask({ repoPath, task }));
      };
      const oldParent = await create("Old epic", "epic");
      const newParent = await create("New epic", "epic");
      const child = await create("Child", "task", oldParent.id);
      await create("Unrelated", "task");
      const base = createTaskServiceWithMutationProgress({ taskStore: store });
      const events: ExternalTaskSyncEvent[] = [];
      const readCards = mock(base.listTasks);
      const sync = createTaskSyncServiceForTest({
        taskService: { ...base, listTasks: readCards },
        workspaceSettingsService: {
          listWorkspaces: () => Effect.succeed([]),
          getSettingsSnapshot: () => Effect.succeed(createDefaultGlobalConfig()),
        },
        eventBus: { publish: (event) => events.push(event) },
      });
      const service = createEventPublishingTaskService({
        taskService: { ...base, listTasks: readCards },
        taskSyncService: sync,
      });
      await Effect.runPromise(
        service.updateTask({
          repoPath,
          taskId: child.id,
          patch: { parentId: newParent.id, description: "Changed description" },
        }),
      );
      expect(readCards.mock.calls.every(([input]) => input.taskIds !== undefined)).toBe(true);
      const cards = events[0]?.boardChanges?.cards;
      expect(cards).toHaveLength(3);
      const byId = new Map(cards?.map((card) => [card.id, card]));
      expect(byId.get(child.id)).toMatchObject({
        parentId: newParent.id,
        description: "Changed description",
      });
      expect(byId.get(oldParent.id)).toMatchObject({
        subtaskIds: [],
        availableActions: expect.arrayContaining(["close_task"]),
      });
      expect(byId.get(newParent.id)?.subtaskIds).toEqual([child.id]);
      expect(byId.get(newParent.id)?.availableActions).not.toContain("close_task");
      const fullBoard = await Effect.runPromise(base.listTasks({ repoPath, doneVisibleDays: 1 }));
      expect(cards).toEqual(fullBoard.filter((card) => byId.has(card.id)));
    } finally {
      await harness.cleanup();
    }
  });

  test("publishes session-only changes without a task card read", async () => {
    const events: ExternalTaskSyncEvent[] = [];
    const listTasks = mock((): Effect.Effect<TaskCard[]> =>
      Effect.die("Session changes must not read the board"),
    );
    const sync = createTaskSyncServiceForTest({
      taskService: {
        listTasks,
        repoPullRequestSyncDetailed: () => Effect.succeed({ ran: false, changedTaskIds: [] }),
      },
      workspaceSettingsService: { listWorkspaces: () => Effect.succeed([]) },
      eventBus: { publish: (event) => events.push(event) },
    });
    for (const operation of [
      "agent-session-create",
      "agent-session-update-model",
      "agent-session-delete",
    ] as const) {
      await Effect.runPromise(
        sync.publishTasksUpdated(
          "/repo",
          { taskIds: ["task-1"], removedTaskIds: [] },
          operation,
          [],
        ),
      );
    }
    expect(listTasks).not.toHaveBeenCalled();
    expect(events).toHaveLength(3);
    expect(events.every((event) => event.boardChanges === null)).toBe(true);
  });
});

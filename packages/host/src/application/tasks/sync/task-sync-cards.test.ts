import { builtinTaskWorkflow } from "@openducktor/workflows";
import { builtinTaskWorkflows } from "../../../test-support/task-workflows";
import { describe, expect, mock, test } from "bun:test";
import {
  workflowArtifactId,
  type ExternalTaskSyncEvent,
  type TaskCard,
  type TaskEventStreamFrame,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { createDefaultGlobalConfig } from "../../../config/global-config";
import { createSqliteTaskStoreHarness } from "../../../adapters/sqlite/sqlite-task-store-test-support";
import { createTaskServiceWithMutationProgress } from "../task-service";
import { createEventPublishingTaskService } from "../event-publishing-task-service";
import { enrichTask } from "../support/task-workflow-helpers";
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
          status: "open",
          task: { title: "Task", issueType: "task", priority: 2 },
        }),
      );
      const base = {
        ...createTaskServiceWithMutationProgress({
          taskWorkflows: builtinTaskWorkflows,
          taskStore: store,
        }),
        resetTask: (input: { repoPath: string; taskId: string }) =>
          Effect.gen(function* () {
            const artifacts = yield* store.listArtifacts(input);
            yield* store.clearTaskArtifacts(input);
            return {
              task: enrichTask(builtinTaskWorkflow, yield* store.getTask(input)),
              removedArtifactIds: artifacts.map((artifact) => artifact.artifactId),
            };
          }),
      };
      const sync = createTaskSyncService({
        taskService: base,
        taskEventStream: stream,
        workspaceSettingsService: {
          getWorkspaceCatalog: () =>
            Effect.succeed({ openWorkspaces: [], closedWorkspaces: [], incompleteRemovals: [] }),
          listWorkspaces: () => Effect.succeed([]),
          getSettingsSnapshot: () => Effect.succeed(createDefaultGlobalConfig()),
        },
        publicationReporter: { report: () => Effect.void },
        onBackgroundFailure: () => Effect.void,
      });
      const service = createEventPublishingTaskService({
        taskWorkflows: builtinTaskWorkflows,
        taskService: base,
        taskSyncService: sync,
      });
      const before = await Effect.runPromise(
        service.workflowArtifactSave({
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          repoPath,
          taskId: task.id,
          markdown: "# Before",
          code: "spec",
          submit: false,
        }),
      );
      await Effect.runPromise(service.resetTask({ repoPath, taskId: task.id }));
      await Effect.runPromise(service.resetTask({ repoPath, taskId: task.id }));
      const after = await Effect.runPromise(
        service.workflowArtifactSave({
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          repoPath,
          taskId: task.id,
          markdown: "# After",
          code: "spec",
          submit: false,
        }),
      );
      await Effect.runPromise(
        service.updateTask({ repoPath, taskId: task.id, patch: { title: "Renamed" } }),
      );
      await Promise.resolve();
      expect(before.artifact.updatedAt).toBe(timestamp);
      expect(after.artifact.updatedAt).toBe(timestamp);
      expect(frames).toHaveLength(5);
      expect(before.artifact.cursor).toEqual(frames[0]!.cursor);
      expect(after.artifact.cursor).toEqual(frames[3]!.cursor);
      expect(frames.map((frame) => frame.cursor.sequence)).toEqual([1, 2, 3, 4, 5]);
      expect(
        frames.map((frame) =>
          frame.type === "change" ? frame.event.boardChanges?.artifactChanges : null,
        ),
      ).toEqual([
        [
          {
            taskId: task.id,
            artifactIds: [workflowArtifactId(task.id, "spec")],
            removedArtifactIds: [],
          },
        ],
        [
          {
            taskId: task.id,
            artifactIds: [workflowArtifactId(task.id, "spec")],
            removedArtifactIds: [workflowArtifactId(task.id, "spec")],
          },
        ],
        [],
        [
          {
            taskId: task.id,
            artifactIds: [workflowArtifactId(task.id, "spec")],
            removedArtifactIds: [],
          },
        ],
        [],
      ]);
      expect(
        (await Effect.runPromise(store.getTaskMetadata({ repoPath, taskId: task.id }))).artifacts
          .spec?.markdown,
      ).toBe("# After");
      expect(failures).toEqual([]);
    } finally {
      subscription.unsubscribe();
      await harness.cleanup();
    }
  });

  test("projects only the changed card with a targeted card read", async () => {
    const harness = await createSqliteTaskStoreHarness();
    try {
      const { repoPath, store } = harness;
      const create = (title: string) =>
        Effect.runPromise(
          store.createTask({
            repoPath,
            status: "open",
            task: { title, issueType: "task", priority: 2 },
          }),
        );
      const changed = await create("Changed");
      await create("Unrelated");
      const base = createTaskServiceWithMutationProgress({
        taskWorkflows: builtinTaskWorkflows,
        taskStore: store,
      });
      const events: ExternalTaskSyncEvent[] = [];
      const readCards = mock(base.listTasks);
      const sync = createTaskSyncServiceForTest({
        taskService: { ...base, listTasks: readCards },
        workspaceSettingsService: {
          getWorkspaceCatalog: () =>
            Effect.succeed({ openWorkspaces: [], closedWorkspaces: [], incompleteRemovals: [] }),
          listWorkspaces: () => Effect.succeed([]),
          getSettingsSnapshot: () => Effect.succeed(createDefaultGlobalConfig()),
        },
        eventBus: { publish: (event) => events.push(event) },
      });
      const service = createEventPublishingTaskService({
        taskWorkflows: builtinTaskWorkflows,
        taskService: { ...base, listTasks: readCards },
        taskSyncService: sync,
      });
      await Effect.runPromise(
        service.updateTask({
          repoPath,
          taskId: changed.id,
          patch: { description: "Changed description" },
        }),
      );
      expect(readCards.mock.calls.every(([input]) => input.taskIds !== undefined)).toBe(true);
      const cards = events[0]?.boardChanges?.cards;
      expect(cards).toHaveLength(1);
      expect(cards?.[0]).toMatchObject({ id: changed.id, description: "Changed description" });
      const fullBoard = await Effect.runPromise(base.listTasks({ repoPath, doneVisibleDays: 1 }));
      expect(cards).toEqual(fullBoard.filter((card) => card.id === changed.id));
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
        repoPullRequestSyncDetailed: () =>
          Effect.succeed({
            ran: false,
            changedTaskIds: [],
            reason: "not_configured",
            message: "Configure a Git provider.",
          }),
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

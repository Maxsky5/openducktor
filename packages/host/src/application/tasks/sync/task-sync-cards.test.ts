import { createTaskSyncService } from "./task-sync-service";
import { builtinTaskWorkflow } from "@openducktor/workflows";
import { builtinTaskWorkflows } from "../../../test-support/task-workflows";
import { describe, expect, mock, test } from "bun:test";
import { noMergeDetection, syncWorkspace } from "./task-sync-service.test-support";
import {
  workflowArtifactId,
  type ExternalTaskSyncEvent,
  type TaskEventStreamFrame,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { createDefaultGlobalConfig } from "../../../config/global-config";
import { createSqliteTaskStoreHarness } from "../../../adapters/sqlite/sqlite-task-store-test-support";
import { createTaskServiceWithMutationProgress } from "../task-service";
import { createEventPublishingTaskService } from "../event-publishing-task-service";
import { enrichTask } from "../support/task-workflow-helpers";
import { createTaskSyncServiceForTest } from "./task-sync-service.test-support";
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
          workspaceId: "fairnest",
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
        resetTask: (input: { workspaceId: string; repoPath: string; taskId: string }) =>
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
        mergeDetection: noMergeDetection,
        taskEventStream: stream,
        settingsConfig: { readGlobalConfig: () => Effect.succeed(createDefaultGlobalConfig()) },
        workspaceSettingsService: {
          getWorkspaceCatalog: () =>
            Effect.succeed({
              catalogRevision: 0,
              openWorkspaces: [syncWorkspace(repoPath, "fairnest")],
              closedWorkspaces: [],
              incompleteRemovals: [],
            }),
          listWorkspaces: () => Effect.succeed([]),
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
          workspaceId: "fairnest",
          repoPath,
          taskId: task.id,
          markdown: "# Before",
          code: "spec",
          submit: false,
        }),
      );
      await Effect.runPromise(
        service.resetTask({ workspaceId: "fairnest", repoPath, taskId: task.id }),
      );
      await Effect.runPromise(
        service.resetTask({ workspaceId: "fairnest", repoPath, taskId: task.id }),
      );
      const after = await Effect.runPromise(
        service.workflowArtifactSave({
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          workspaceId: "fairnest",
          repoPath,
          taskId: task.id,
          markdown: "# After",
          code: "spec",
          submit: false,
        }),
      );
      await Effect.runPromise(
        service.updateTask({
          workspaceId: "fairnest",
          repoPath,
          taskId: task.id,
          patch: { title: "Renamed" },
        }),
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
        (
          await Effect.runPromise(
            store.getTaskMetadata({ workspaceId: "fairnest", repoPath, taskId: task.id }),
          )
        ).artifacts.spec?.markdown,
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
            workspaceId: "fairnest",
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
      const sync = createTaskSyncService({
        taskService: { ...base, listTasks: readCards },
        settingsConfig: { readGlobalConfig: () => Effect.succeed(createDefaultGlobalConfig()) },
        workspaceSettingsService: {
          getWorkspaceCatalog: () =>
            Effect.succeed({
              catalogRevision: 0,
              openWorkspaces: [syncWorkspace(repoPath, "fairnest")],
              closedWorkspaces: [],
              incompleteRemovals: [],
            }),
          listWorkspaces: () => Effect.succeed([]),
        },
        mergeDetection: noMergeDetection,
        taskEventStream: {
          ...createTaskEventStream({ reporter: { report: () => {} } }),
          publish: (event) => {
            events.push(event);
            return { epoch: "11111111-1111-4111-8111-111111111111", sequence: events.length };
          },
        },
        publicationReporter: { report: () => Effect.void },
        onBackgroundFailure: () => Effect.void,
      });
      const service = createEventPublishingTaskService({
        taskWorkflows: builtinTaskWorkflows,
        taskService: { ...base, listTasks: readCards },
        taskSyncService: sync,
      });
      await Effect.runPromise(
        service.updateTask({
          workspaceId: "fairnest",
          repoPath,
          taskId: changed.id,
          patch: { description: "Changed description" },
        }),
      );
      expect(readCards.mock.calls.every(([input]) => input.taskIds !== undefined)).toBe(true);
      const cards = events[0]?.boardChanges?.cards;
      expect(cards).toHaveLength(1);
      expect(cards?.[0]).toMatchObject({ id: changed.id, description: "Changed description" });
      const fullBoard = await Effect.runPromise(
        base.listTasks({ workspaceId: "fairnest", repoPath, doneVisibleDays: 1 }),
      );
      expect(cards).toEqual(fullBoard.filter((card) => card.id === changed.id));
    } finally {
      await harness.cleanup();
    }
  });

  test("publishes changed task identities for saved session association refresh", async () => {
    const events: ExternalTaskSyncEvent[] = [];
    const sync = createTaskSyncServiceForTest({
      taskService: {
        repoPullRequestSyncDetailed: () => Effect.succeed({ ran: true, changedTaskIds: [] }),
      },
      workspaceSettingsService: { listWorkspaces: () => Effect.succeed([syncWorkspace()]) },
      eventBus: { publish: (event) => events.push(event) },
    });
    await Effect.runPromise(
      sync.publishTasksUpdated(
        { workspaceId: "repo", repoPath: "/repo" },
        { taskIds: ["task-1"], removedTaskIds: [] },
        "agent-session-create",
        [],
      ),
    );
    expect(events).toMatchObject([
      { kind: "tasks_updated", repoPath: "/repo", taskIds: ["task-1"] },
    ]);
  });
});

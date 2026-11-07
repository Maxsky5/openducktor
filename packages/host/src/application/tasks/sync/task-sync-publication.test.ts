import { describe, expect, test } from "bun:test";
import type { ExternalTaskSyncEvent } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../../effect/host-errors";
import {
  createTaskSyncServiceForTest,
  createEventBus,
  syncWorkspace,
  task,
} from "./task-sync-service.test-support";

const workspaceSettingsService = { listWorkspaces: () => Effect.succeed([syncWorkspace()]) };
const noSync = () =>
  Effect.succeed({ ran: true as const, changedTaskIds: [], autoCloseFailures: [] });

describe("committed task event publication", () => {
  test.each([
    ["create-task", "acceptance"],
    ["create-task", "snapshot"],
    ["update-task", "acceptance"],
    ["update-task", "snapshot"],
  ] as const)(
    "returns an actionable committed-state error when %s %s fails",
    async (operation, stage) => {
      const { eventBus, events } = createEventBus();
      const notificationInputs: ExternalTaskSyncEvent[] = [];
      const reports: unknown[] = [];
      const failure = new HostOperationError({
        operation: "test",
        message: "Task data unavailable",
      });
      const service = createTaskSyncServiceForTest({
        eventBus:
          stage === "acceptance"
            ? {
                publish: () => {
                  throw failure;
                },
              }
            : eventBus,
        publicationReporter: {
          report: (report) =>
            Effect.sync(() => {
              reports.push(report);
            }),
        },
        acceptNotificationInput: (event) => notificationInputs.push(event),
        taskService: {
          repoPullRequestSyncDetailed: noSync,
          ...(stage === "snapshot" && { listTasks: () => Effect.fail(failure) }),
        },
        workspaceSettingsService,
      });
      const publication =
        operation === "create-task"
          ? service.publishExternalTaskCreated({ workspaceId: "repo", repoPath: "/repo" }, task())
          : service.publishTasksUpdated(
              { workspaceId: "repo", repoPath: "/repo" },
              { taskIds: ["task-1"], removedTaskIds: [] },
              "update-task",
              [],
            );
      const result = await Effect.runPromise(publication.pipe(Effect.result));
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure")
        expect(result.failure).toMatchObject({
          message: expect.stringContaining("Do not repeat the change"),
          details: { durableState: "committed", stage, repoPath: "/repo" },
        });
      expect(reports).toEqual([expect.objectContaining({ operation, stage, repoPath: "/repo" })]);
      expect(notificationInputs[0]).toMatchObject({
        kind: operation === "create-task" ? "external_task_created" : "tasks_updated",
      });
      expect(events).toEqual([]);
    },
  );

  test("publishes removals among affected IDs and preserves exact status facts when rows are newer", async () => {
    const { eventBus, events } = createEventBus();
    const service = createTaskSyncServiceForTest({
      eventBus,
      workspaceSettingsService,
      taskService: {
        repoPullRequestSyncDetailed: noSync,
        listTasks: () =>
          Effect.succeed([task({ title: "Current title", status: "ready_for_dev" })]),
      },
    });
    const committed = {
      previousStatus: "open",
      task: {
        id: "task-1",
        title: "Title at commit",
        status: "spec_ready",
        workflow: { id: "openducktor-spec-plan-build", revision: 1 },
      },
    };
    await Effect.runPromise(
      service.publishTasksUpdated(
        { workspaceId: "repo", repoPath: "/repo" },
        { taskIds: ["task-1", "task-2"], removedTaskIds: ["task-2"] },
        "update-task",
        [committed],
      ),
    );
    expect(events).toEqual([
      expect.objectContaining({
        kind: "tasks_updated",
        taskIds: ["task-1", "task-2"],
        removedTaskIds: ["task-2"],
        taskSnapshots: [
          {
            id: "task-1",
            title: "Current title",
            status: "ready_for_dev",
            workflow: task().workflow,
          },
        ],
        statusChanges: [committed],
      }),
    ]);
  });

  test("gives notifications committed transitions before a later card read fails", async () => {
    const captured: ExternalTaskSyncEvent[] = [];
    const { eventBus, events } = createEventBus();
    const service = createTaskSyncServiceForTest({
      eventBus,
      workspaceSettingsService,
      acceptNotificationInput: (event) => captured.push(event),
      taskService: {
        repoPullRequestSyncDetailed: noSync,
        listTasks: () =>
          Effect.fail(new HostOperationError({ operation: "test", message: "Snapshot failed" })),
      },
    });
    const committed = {
      previousStatus: "in_progress",
      sourceRole: "build",
      task: {
        id: "task-1",
        title: "Task",
        status: "human_review",
        workflow: { id: "openducktor-spec-plan-build", revision: 1 },
      },
    };
    await expect(
      Effect.runPromise(
        service.publishTasksUpdated(
          { workspaceId: "repo", repoPath: "/repo" },
          { taskIds: ["task-1"], removedTaskIds: [] },
          "update-task",
          [committed],
        ),
      ),
    ).rejects.toThrow("Task changes were saved");
    expect(captured).toMatchObject([{ statusChanges: [committed] }]);
    expect(events).toEqual([]);
  });
});

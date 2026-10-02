import { describe, expect, test } from "bun:test";
import type { ExternalTaskSyncEvent } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../../effect/host-errors";
import {
  createTaskSyncServiceForTest,
  createEventBus,
  task,
} from "./task-sync-service.test-support";

describe("task event publication", () => {
  test("reports task publication acceptance failures without rejecting committed work", async () => {
    const reports: unknown[] = [];
    const service = createTaskSyncServiceForTest({
      eventBus: {
        publish() {
          throw new Error("event transport unavailable");
        },
      },
      publicationReporter: {
        report: (failure) =>
          Effect.sync(() => {
            reports.push(failure);
          }),
      },
      taskService: {
        repoPullRequestSyncDetailed: () => Effect.succeed({ ran: true, changedTaskIds: [] }),
      },
      workspaceSettingsService: {
        listWorkspaces: () => Effect.succeed([]),
      },
    });

    await expect(
      Effect.runPromise(
        service.publishTasksUpdated(
          "/repo",
          { taskIds: ["task-1"], removedTaskIds: [] },
          "task-update",
          [],
        ),
      ),
    ).resolves.toBeUndefined();
    expect(reports).toEqual([
      expect.objectContaining({ operation: "task-update", repoPath: "/repo", stage: "acceptance" }),
    ]);
  });

  test("returns an actionable committed-state error when task snapshot capture fails", async () => {
    const { eventBus, events } = createEventBus();
    const reports: unknown[] = [];
    const failure = new HostOperationError({
      operation: "task.list",
      message: "Task snapshots are unavailable.",
    });
    const service = createTaskSyncServiceForTest({
      eventBus,
      publicationReporter: {
        report: (report) => Effect.sync(() => reports.push(report)),
      },
      taskService: {
        listTasks: () => Effect.fail(failure),
        repoPullRequestSyncDetailed: () => Effect.succeed({ ran: true, changedTaskIds: [] }),
      },
      workspaceSettingsService: { listWorkspaces: () => Effect.succeed([]) },
    });

    await expect(
      Effect.runPromise(
        service
          .publishTasksUpdated(
            "/repo",
            { taskIds: ["task-1"], removedTaskIds: [] },
            "task-update",
            [],
          )
          .pipe(Effect.flip),
      ),
    ).resolves.toMatchObject({
      _tag: "HostOperationError",
      message: expect.stringContaining("Task changes were saved"),
      cause: failure,
      details: {
        durableState: "committed",
        stage: "snapshot",
        repoPath: "/repo",
        changes: { taskIds: ["task-1"], removedTaskIds: [] },
      },
    });
    expect(events).toEqual([]);
    expect(reports).toEqual([
      expect.objectContaining({
        operation: "task-update",
        repoPath: "/repo",
        stage: "snapshot",
        cause: failure,
      }),
    ]);
  });

  test.each([
    { case: "duplicate task IDs", taskIds: ["task-1", "task-1"], removedTaskIds: [] },
    {
      case: "removed IDs outside the affected IDs",
      taskIds: ["task-1"],
      removedTaskIds: ["task-2"],
    },
    { case: "an empty proposed event", taskIds: [], removedTaskIds: [] },
  ])(
    "reports $case without changing or publishing the proposed event",
    async ({ taskIds, removedTaskIds }) => {
      const { eventBus, events } = createEventBus();
      const reports: unknown[] = [];
      const service = createTaskSyncServiceForTest({
        eventBus,
        publicationReporter: {
          report: (failure) =>
            Effect.sync(() => {
              reports.push(failure);
            }),
        },
        taskService: {
          repoPullRequestSyncDetailed: () => Effect.succeed({ ran: true, changedTaskIds: [] }),
        },
        workspaceSettingsService: {
          listWorkspaces: () => Effect.succeed([]),
        },
      });
      const changes = { taskIds: [...taskIds], removedTaskIds: [...removedTaskIds] };

      await expect(
        Effect.runPromise(service.publishTasksUpdated("/repo", changes, "task-update", [])),
      ).resolves.toBeUndefined();

      expect(events).toEqual([]);
      expect(reports).toEqual([
        expect.objectContaining({
          operation: "task-update",
          repoPath: "/repo",
          changes,
          stage: "acceptance",
          cause: expect.objectContaining({ issues: expect.any(Array) }),
        }),
      ]);
    },
  );

  test("publishes valid affected and removed task IDs unchanged", async () => {
    const { eventBus, events } = createEventBus();
    const service = createTaskSyncServiceForTest({
      eventBus,
      taskService: {
        listTasks: () => Effect.succeed([task({ status: "ready_for_dev" })]),
        repoPullRequestSyncDetailed: () => Effect.succeed({ ran: true, changedTaskIds: [] }),
      },
      workspaceSettingsService: {
        listWorkspaces: () => Effect.succeed([]),
      },
    });
    const changes = { taskIds: ["task-1", "task-2"], removedTaskIds: ["task-2"] };

    await Effect.runPromise(service.publishTasksUpdated("/repo", changes, "delete-task", []));

    expect(events).toEqual([
      expect.objectContaining({
        kind: "tasks_updated",
        taskIds: ["task-1", "task-2"],
        removedTaskIds: ["task-2"],
        statusChanges: [],
        taskSnapshots: [{ id: "task-1", title: "Task 1", status: "ready_for_dev" }],
      }),
    ]);
  });

  test("binds each published event to the task status captured for that update", async () => {
    const { eventBus, events } = createEventBus();
    let readIndex = 0;
    const service = createTaskSyncServiceForTest({
      eventBus,
      taskService: {
        listTasks: () => {
          const status = readIndex === 0 ? "spec_ready" : "ready_for_dev";
          readIndex += 1;
          return Effect.succeed([task({ status })]);
        },
        repoPullRequestSyncDetailed: () => Effect.succeed({ ran: true, changedTaskIds: [] }),
      },
      workspaceSettingsService: { listWorkspaces: () => Effect.succeed([]) },
    });
    const changes = { taskIds: ["task-1"], removedTaskIds: [] };

    await Effect.runPromise(service.publishTasksUpdated("/repo", changes, "set-spec", []));
    await Effect.runPromise(service.publishTasksUpdated("/repo", changes, "set-plan", []));

    expect(
      events.map((event) =>
        event.kind === "tasks_updated" ? event.taskSnapshots[0]?.status : null,
      ),
    ).toEqual(["spec_ready", "ready_for_dev"]);
  });

  test("publishes host-compatible external task creation events", async () => {
    const { eventBus, events } = createEventBus();
    const service = createTaskSyncServiceForTest({
      eventBus,
      taskService: {
        repoPullRequestSyncDetailed() {
          return Effect.tryPromise({
            try: async () => {
              throw new Error("unexpected pull request sync");
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          });
        },
      },
      workspaceSettingsService: {
        listWorkspaces() {
          return Effect.tryPromise({
            try: async () => {
              return [];
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          });
        },
      },
    });
    await Effect.runPromise(
      service.publishExternalTaskCreated("/repo", {
        id: "task-1",
        title: "Created",
        status: "open",
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "external_task_created",
      repoPath: "/repo",
      taskId: "task-1",
      taskSnapshot: { id: "task-1", title: "Created", status: "open" },
    });
    expect(events[0]).toMatchObject({
      eventId: expect.any(String),
      emittedAt: expect.any(String),
    });
  });

  test("hands committed transitions to notifications before a later task read fails", async () => {
    const captured: ExternalTaskSyncEvent[] = [];
    const events = createEventBus();
    const service = createTaskSyncServiceForTest({
      eventIdFactory: () => "committed-event",
      acceptNotificationInput: (event) => captured.push(event),
      eventBus: events.eventBus,
      taskService: {
        listTasks: () =>
          Effect.fail(
            new HostOperationError({ operation: "test.snapshot", message: "Snapshot read failed" }),
          ),
        repoPullRequestSyncDetailed: () => Effect.succeed({ ran: false, changedTaskIds: [] }),
      },
      workspaceSettingsService: { listWorkspaces: () => Effect.succeed([]) },
    });
    await expect(
      Effect.runPromise(
        service.publishTasksUpdated(
          "/repo",
          { taskIds: ["task-1"], removedTaskIds: [] },
          "build-completed",
          [
            {
              previousStatus: "in_progress",
              task: { id: "task-1", title: "Task 1", status: "human_review" },
            },
          ],
        ),
      ),
    ).rejects.toThrow("Task changes were saved");
    expect(captured).toMatchObject([
      {
        eventId: "committed-event",
        statusChanges: [
          { previousStatus: "in_progress", sourceRole: "build", task: { status: "human_review" } },
        ],
      },
    ]);
    expect(events.events).toHaveLength(0);
  });
});

import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { HostOperationError } from "../../../effect/host-errors";
import type { HostEventBusPort } from "../../../events/host-event-bus";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";
import type { TaskService } from "../task-service";
import { createTaskSyncService } from "./task-sync-service";

const createTaskSyncServiceForTest = (input: Parameters<typeof createTaskSyncService>[0]) =>
  createTaskSyncService(input);
const createEventBus = () => {
  const events: Array<{
    channel: string;
    payload: unknown;
  }> = [];
  const eventBus: HostEventBusPort = {
    publish(channel, payload) {
      events.push({ channel, payload });
    },
    subscribe() {
      return () => {};
    },
  };
  return { eventBus, events };
};
const createTaskServiceFake = (
  service: Pick<TaskService, "repoPullRequestSyncDetailed">,
): TaskService => service as unknown as TaskService;
const createWorkspaceSettingsServiceFake = (
  service: Pick<WorkspaceSettingsService, "listWorkspaces">,
): WorkspaceSettingsService => service as unknown as WorkspaceSettingsService;
describe("createTaskSyncService", () => {
  test("publishes host-compatible external task creation events", async () => {
    const { eventBus, events } = createEventBus();
    const service = createTaskSyncServiceForTest({
      eventBus,
      taskService: createTaskServiceFake({
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
      }),
      workspaceSettingsService: createWorkspaceSettingsServiceFake({
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
      }),
    });
    await Effect.runPromise(service.publishExternalTaskCreated("/repo", "task-1"));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      channel: "openducktor://task-event",
      payload: {
        kind: "external_task_created",
        repoPath: "/repo",
        taskId: "task-1",
      },
    });
    expect(events[0]?.payload).toMatchObject({
      eventId: expect.any(String),
      emittedAt: expect.any(String),
    });
  });
  test("runs linked pull request sync for the active workspace and emits changed task ids", async () => {
    const { eventBus, events } = createEventBus();
    const calls: unknown[] = [];
    const service = createTaskSyncServiceForTest({
      eventBus,
      intervalMs: 60000,
      taskService: createTaskServiceFake({
        repoPullRequestSyncDetailed(input) {
          return Effect.tryPromise({
            try: async () => {
              calls.push(input);
              return { ran: true, changedTaskIds: ["task-1", "task-2"] };
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          });
        },
      }),
      workspaceSettingsService: createWorkspaceSettingsServiceFake({
        listWorkspaces() {
          return Effect.tryPromise({
            try: async () => {
              return [
                {
                  workspaceId: "repo",
                  workspaceName: "Repo",
                  repoPath: "/repo",
                  isActive: true,
                  hasConfig: true,
                  configuredWorktreeBasePath: null,
                  defaultWorktreeBasePath: null,
                  effectiveWorktreeBasePath: null,
                },
              ];
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          });
        },
      }),
    });
    await Effect.runPromise(service.syncActiveWorkspacePullRequests());
    expect(calls).toEqual([{ repoPath: "/repo" }]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      channel: "openducktor://task-event",
      payload: {
        kind: "tasks_updated",
        repoPath: "/repo",
        taskIds: ["task-1", "task-2"],
      },
    });
  });
  test("does not run pull request sync during loop startup", async () => {
    const { eventBus } = createEventBus();
    const calls: unknown[] = [];
    const service = createTaskSyncServiceForTest({
      eventBus,
      intervalMs: 60000,
      taskService: createTaskServiceFake({
        repoPullRequestSyncDetailed(input) {
          return Effect.tryPromise({
            try: async () => {
              calls.push(input);
              return { ran: true, changedTaskIds: [] };
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          });
        },
      }),
      workspaceSettingsService: createWorkspaceSettingsServiceFake({
        listWorkspaces() {
          return Effect.tryPromise({
            try: async () => {
              throw new Error("unexpected workspace lookup before first interval");
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          });
        },
      }),
    });
    const loop = await Effect.runPromise(service.startPullRequestSyncLoop());
    await Effect.runPromise(loop.stop());
    expect(calls).toEqual([]);
  });
});

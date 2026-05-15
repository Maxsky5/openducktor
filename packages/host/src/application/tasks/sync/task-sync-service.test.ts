import { describe, expect, test } from "bun:test";
import type { HostEventBusPort } from "../../../events/host-event-bus";
import { createTaskSyncService } from "./task-sync-service";

const createEventBus = () => {
  const events: Array<{ channel: string; payload: unknown }> = [];
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

describe("createTaskSyncService", () => {
  test("publishes Tauri-compatible external task creation events", () => {
    const { eventBus, events } = createEventBus();
    const service = createTaskSyncService({
      eventBus,
      taskService: {
        async repoPullRequestSyncDetailed() {
          throw new Error("unexpected pull request sync");
        },
      },
      workspaceSettingsService: {
        async listWorkspaces() {
          return [];
        },
      },
    });

    service.publishExternalTaskCreated("/repo", "task-1");

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
    const service = createTaskSyncService({
      eventBus,
      intervalMs: 60_000,
      taskService: {
        async repoPullRequestSyncDetailed(input) {
          calls.push(input);
          return { ran: true, changedTaskIds: ["task-1", "task-2"] };
        },
      },
      workspaceSettingsService: {
        async listWorkspaces() {
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
      },
    });

    await service.syncActiveWorkspacePullRequests();

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
    const service = createTaskSyncService({
      eventBus,
      intervalMs: 60_000,
      taskService: {
        async repoPullRequestSyncDetailed(input) {
          calls.push(input);
          return { ran: true, changedTaskIds: [] };
        },
      },
      workspaceSettingsService: {
        async listWorkspaces() {
          throw new Error("unexpected workspace lookup before first interval");
        },
      },
    });

    const loop = service.startPullRequestSyncLoop();
    await loop.stop();

    expect(calls).toEqual([]);
  });
});

import { type BuiltinTaskCard as TaskCard } from "@openducktor/workflows";
import { describe, expect, mock, test } from "bun:test";
import type { TaskStreamFrame } from "../connection/host-connection";
import { type RepoTaskData, taskQueryKeys } from "../queries/tasks";
import {
  createTestClientConnection,
  createTestHostConnection,
} from "../test-support/test-client-connection";
import { createTaskCardFixture } from "../test-support/shared-test-fixtures";
import { createHostTaskStreamController } from "./host-task-stream-controller";

const flush = async (): Promise<void> => {
  for (let index = 0; index < 5; index += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
};

describe("createHostTaskStreamController", () => {
  test("puts a task saved on the host into the cached task list", async () => {
    const saved: TaskCard = createTaskCardFixture({ id: "task-1", description: "Old" });
    let emit: (frame: TaskStreamFrame) => void = () => {
      throw new Error("The task stream is not open.");
    };
    const host = createTestHostConnection({
      client: { tasksList: async () => [saved] },
      subscribeTaskStream: async (_input, onFrame) => {
        emit = onFrame;
        return { subscriptionId: "stream-1", acknowledge: async () => {}, unsubscribe: () => {} };
      },
    });
    const { queryClient } = createTestClientConnection({ host });
    queryClient.setQueryData<RepoTaskData>(taskQueryKeys.repoData("/repo"), { tasks: [saved] });
    const onDegraded = mock(() => {});
    const controller = createHostTaskStreamController(
      host,
      { listSessionTaskIds: () => [], removeTaskSessions: () => {} },
      {
        queryClient,
        getOpenRepoPaths: () => ["/repo"],
        getActiveRepoPath: () => "/repo",
        onDegraded,
        onWorkspaceFailures: () => {},
      },
    );
    await controller.start();

    const edited = { ...saved, description: "New", updatedAt: "2026-10-21T10:00:00.000Z" };
    emit({
      type: "change",
      cursor: { epoch: "11111111-1111-4111-8111-111111111111", sequence: 0 },
      event: {
        kind: "tasks_updated",
        boardChanges: { artifactChanges: [], cards: [edited], doneVisibleDays: 1 },
        eventId: "event-1",
        repoPath: "/repo",
        taskIds: ["task-1"],
        removedTaskIds: [],
        statusChanges: [],
        taskSnapshots: [{ id: "task-1", title: saved.title, status: saved.status }],
        emittedAt: "2026-10-21T10:00:00.000Z",
      },
    });
    await flush();

    const cached = queryClient.getQueryData<RepoTaskData>(taskQueryKeys.repoData("/repo"));
    expect(cached?.tasks.map((task) => task.description)).toEqual(["New"]);
    expect(onDegraded).not.toHaveBeenCalled();
    await controller.stop();
  });
});

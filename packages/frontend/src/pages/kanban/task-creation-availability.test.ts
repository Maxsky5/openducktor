import { describe, expect, test } from "bun:test";
import { createTaskStoreCheckFixture } from "@/test-utils/shared-test-fixtures";
import {
  isKanbanTaskCreationDisabled,
  taskCreationBlockedReason,
} from "./task-creation-availability";

const workspace = { workspaceId: "workspace-repo", workspaceName: "Repo", repoPath: "/repo" };

const unavailableTaskStore = createTaskStoreCheckFixture(
  {},
  {
    taskStoreOk: false,
    taskStorePath: null,
    taskStoreError: "task store unavailable",
    repoStoreHealth: {
      category: "database_unavailable",
      status: "blocking",
      isReady: false,
      detail: "task store unavailable",
    },
  },
);

const readyTaskStore = createTaskStoreCheckFixture(
  {},
  {
    taskStorePath: "/tmp/task-store/database.sqlite",
    repoStoreHealth: { databasePath: "/tmp/task-store/database.sqlite" },
  },
);

describe("isKanbanTaskCreationDisabled", () => {
  test("disables task creation when no repository is active", () => {
    expect(isKanbanTaskCreationDisabled(null, { data: null, error: null })).toBe(true);
  });

  test("keeps the task composer available while the workspace check loads", () => {
    expect(isKanbanTaskCreationDisabled(workspace, { data: null, error: null })).toBe(false);
  });

  test("disables task creation when the task store is unavailable or the check read fails", () => {
    expect(
      isKanbanTaskCreationDisabled(workspace, { data: unavailableTaskStore, error: null }),
    ).toBe(true);
    expect(isKanbanTaskCreationDisabled(workspace, { data: null, error: "Host offline" })).toBe(
      true,
    );
  });

  test("enables task creation when the task store is ready", () => {
    expect(isKanbanTaskCreationDisabled(workspace, { data: readyTaskStore, error: null })).toBe(
      false,
    );
  });
});

describe("taskCreationBlockedReason", () => {
  test("names a failed check read and a task store that is not ready, and ignores a pending check", () => {
    expect(taskCreationBlockedReason({ data: null, error: null })).toBeNull();
    expect(
      taskCreationBlockedReason({ data: createTaskStoreCheckFixture(), error: null }),
    ).toBeNull();
    expect(taskCreationBlockedReason({ data: unavailableTaskStore, error: null })).toBe(
      "Task store unavailable. task store unavailable",
    );
    expect(
      taskCreationBlockedReason({
        data: readyTaskStore,
        error: "task-store transport unavailable",
      }),
    ).toBe("Could not check the task store. task-store transport unavailable");
  });
});

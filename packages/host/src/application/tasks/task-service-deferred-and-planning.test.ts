import { createTaskService, type TaskStorePort, task } from "./test-support/task-workflow-harness";

describe("createTaskService deferred and planning", () => {
  test("defers parent tasks from open states", async () => {
    const calls: unknown[] = [];
    const deferredTask = task({ id: "task-1", status: "deferred" });
    const taskStore: TaskStorePort = {
      async listTasks(input) {
        calls.push({ type: "list", input });
        return [task({ id: "task-1", status: "human_review" })];
      },
      async createTask() {
        throw new Error("unexpected create");
      },
      async updateTask() {
        throw new Error("unexpected update");
      },
      async getTask() {
        throw new Error("unexpected get");
      },
      async transitionTask(input) {
        calls.push({ type: "transition", input });
        return deferredTask;
      },
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };

    const deferred = await createTaskService({ taskStore }).deferTask({
      repoPath: "/repo",
      taskId: "task-1",
    });

    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      { type: "transition", input: { repoPath: "/repo", taskId: "task-1", status: "deferred" } },
    ]);
    expect(deferred).toMatchObject({
      id: "task-1",
      status: "deferred",
      availableActions: expect.arrayContaining(["resume_deferred"]),
    });
  });

  test("rejects deferring subtasks before calling the store", async () => {
    const taskStore: TaskStorePort = {
      async listTasks() {
        return [task({ id: "task-1", parentId: "epic-1" })];
      },
      async createTask() {
        throw new Error("unexpected create");
      },
      async updateTask() {
        throw new Error("unexpected update");
      },
      async getTask() {
        throw new Error("unexpected get");
      },
      async transitionTask() {
        throw new Error("should not transition");
      },
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };

    await expect(
      createTaskService({ taskStore }).deferTask({ repoPath: "/repo", taskId: "task-1" }),
    ).rejects.toThrow("Subtasks cannot be deferred.");
  });

  test("rejects deferring closed or already deferred tasks before calling the store", async () => {
    const taskStore: TaskStorePort = {
      async listTasks() {
        return [task({ id: "task-1", status: "closed" })];
      },
      async createTask() {
        throw new Error("unexpected create");
      },
      async updateTask() {
        throw new Error("unexpected update");
      },
      async getTask() {
        throw new Error("unexpected get");
      },
      async transitionTask() {
        throw new Error("should not transition");
      },
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };

    await expect(
      createTaskService({ taskStore }).deferTask({ repoPath: "/repo", taskId: "task-1" }),
    ).rejects.toThrow("Only non-closed open-state tasks can be deferred.");
  });

  test("resumes deferred tasks", async () => {
    const calls: unknown[] = [];
    const resumedTask = task({ id: "task-1", status: "open" });
    const taskStore: TaskStorePort = {
      async listTasks(input) {
        calls.push({ type: "list", input });
        return [task({ id: "task-1", status: "deferred" })];
      },
      async createTask() {
        throw new Error("unexpected create");
      },
      async updateTask() {
        throw new Error("unexpected update");
      },
      async getTask() {
        throw new Error("unexpected get");
      },
      async transitionTask(input) {
        calls.push({ type: "transition", input });
        return resumedTask;
      },
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };

    const resumed = await createTaskService({ taskStore }).resumeDeferredTask({
      repoPath: "/repo",
      taskId: "task-1",
    });

    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      { type: "transition", input: { repoPath: "/repo", taskId: "task-1", status: "open" } },
    ]);
    expect(resumed).toMatchObject({
      id: "task-1",
      status: "open",
      availableActions: expect.arrayContaining(["defer_issue"]),
    });
  });

  test("rejects resuming non-deferred tasks before calling the store", async () => {
    const taskStore: TaskStorePort = {
      async listTasks() {
        return [task({ id: "task-1", status: "open" })];
      },
      async createTask() {
        throw new Error("unexpected create");
      },
      async updateTask() {
        throw new Error("unexpected update");
      },
      async getTask() {
        throw new Error("unexpected get");
      },
      async transitionTask() {
        throw new Error("should not transition");
      },
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };

    await expect(
      createTaskService({ taskStore }).resumeDeferredTask({
        repoPath: "/repo",
        taskId: "task-1",
      }),
    ).rejects.toThrow("Task is not deferred: task-1");
  });

  test("sets spec markdown and promotes open tasks to spec_ready", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      async listTasks(input) {
        calls.push({ type: "list", input });
        return [task({ id: "task-1", status: "open", issueType: "feature" })];
      },
      async setSpecDocument(input) {
        calls.push({ type: "setSpec", input });
        return { markdown: input.markdown, updatedAt: "2026-05-10T10:00:00.000Z", revision: 1 };
      },
      async transitionTask(input) {
        calls.push({ type: "transition", input });
        return task({ id: "task-1", status: "spec_ready", issueType: "feature" });
      },
      async createTask() {
        throw new Error("unexpected create");
      },
      async updateTask() {
        throw new Error("unexpected update");
      },
      async getTask() {
        throw new Error("unexpected get");
      },
      async setPlanDocument() {
        throw new Error("unexpected set plan");
      },
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };

    await expect(
      createTaskService({ taskStore }).setSpec({
        repoPath: "/repo",
        taskId: "task-1",
        markdown: "# Spec",
      }),
    ).resolves.toEqual({
      markdown: "# Spec",
      updatedAt: "2026-05-10T10:00:00.000Z",
      revision: 1,
    });
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      { type: "setSpec", input: { repoPath: "/repo", taskId: "task-1", markdown: "# Spec" } },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "spec_ready" },
      },
    ]);
  });

  test("rejects set_spec for deferred tasks before persisting", async () => {
    const taskStore: TaskStorePort = {
      async listTasks() {
        return [task({ id: "task-1", status: "deferred" })];
      },
      async setSpecDocument() {
        throw new Error("should not persist");
      },
      async createTask() {
        throw new Error("unexpected create");
      },
      async updateTask() {
        throw new Error("unexpected update");
      },
      async getTask() {
        throw new Error("unexpected get");
      },
      async setPlanDocument() {
        throw new Error("unexpected set plan");
      },
      async transitionTask() {
        throw new Error("unexpected transition");
      },
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };

    await expect(
      createTaskService({ taskStore }).setSpec({
        repoPath: "/repo",
        taskId: "task-1",
        markdown: "# Spec",
      }),
    ).rejects.toThrow(
      "set_spec is only allowed from open/spec_ready/ready_for_dev/in_progress/blocked/ai_review/human_review (current: deferred)",
    );
  });

  test("sets an epic plan, replaces direct subtasks, and promotes to ready_for_dev", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      async listTasks(input) {
        calls.push({ type: "list", input });
        return [
          task({ id: "epic-1", status: "spec_ready", issueType: "epic" }),
          task({ id: "old-child", status: "ready_for_dev", parentId: "epic-1" }),
        ];
      },
      async setPlanDocument(input) {
        calls.push({ type: "setPlan", input });
        return { markdown: input.markdown, updatedAt: "2026-05-10T10:00:00.000Z", revision: 2 };
      },
      async deleteTask(input) {
        calls.push({ type: "delete", input });
        return true;
      },
      async createTask(input) {
        calls.push({ type: "create", input });
        return task({ id: `created-${input.task.title}`, parentId: "epic-1" });
      },
      async transitionTask(input) {
        calls.push({ type: "transition", input });
        return task({ id: "epic-1", status: "ready_for_dev", issueType: "epic" });
      },
      async updateTask() {
        throw new Error("unexpected update");
      },
      async getTask() {
        throw new Error("unexpected get");
      },
      async setSpecDocument() {
        throw new Error("unexpected set spec");
      },
    };

    await expect(
      createTaskService({ taskStore }).setPlan({
        repoPath: "/repo",
        taskId: "epic-1",
        markdown: "# Plan",
        hasExplicitSubtasks: true,
        subtasks: [
          { title: " Build UI ", issueType: "task", priority: 1, description: " Ship it " },
          { title: "build ui", issueType: "task", priority: 1 },
          { title: "Wire API", issueType: "feature" },
        ],
      }),
    ).resolves.toEqual({
      markdown: "# Plan",
      updatedAt: "2026-05-10T10:00:00.000Z",
      revision: 2,
    });
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      { type: "setPlan", input: { repoPath: "/repo", taskId: "epic-1", markdown: "# Plan" } },
      {
        type: "delete",
        input: { repoPath: "/repo", taskId: "old-child", deleteSubtasks: false },
      },
      {
        type: "create",
        input: {
          repoPath: "/repo",
          task: {
            title: "Build UI",
            issueType: "task",
            priority: 1,
            description: "Ship it",
            aiReviewEnabled: true,
            parentId: "epic-1",
          },
        },
      },
      {
        type: "create",
        input: {
          repoPath: "/repo",
          task: {
            title: "Wire API",
            issueType: "feature",
            priority: 2,
            description: undefined,
            aiReviewEnabled: true,
            parentId: "epic-1",
          },
        },
      },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "epic-1", status: "ready_for_dev" },
      },
    ]);
  });

  test("saves plan documents without applying workflow transitions", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      async getTask(input) {
        calls.push({ type: "get", input });
        return task({ id: "task-1", status: "in_progress" });
      },
      async setPlanDocument(input) {
        calls.push({ type: "setPlan", input });
        return { markdown: input.markdown, updatedAt: "2026-05-10T10:00:00.000Z", revision: 3 };
      },
      async listTasks() {
        throw new Error("unexpected list");
      },
      async createTask() {
        throw new Error("unexpected create");
      },
      async updateTask() {
        throw new Error("unexpected update");
      },
      async setSpecDocument() {
        throw new Error("unexpected set spec");
      },
      async transitionTask() {
        throw new Error("unexpected transition");
      },
      async deleteTask() {
        throw new Error("unexpected delete");
      },
    };

    await expect(
      createTaskService({ taskStore }).savePlanDocument({
        repoPath: "/repo",
        taskId: "task-1",
        markdown: "# Plan",
      }),
    ).resolves.toEqual({
      markdown: "# Plan",
      updatedAt: "2026-05-10T10:00:00.000Z",
      revision: 3,
    });
    expect(calls).toEqual([
      { type: "get", input: { repoPath: "/repo", taskId: "task-1" } },
      { type: "setPlan", input: { repoPath: "/repo", taskId: "task-1", markdown: "# Plan" } },
    ]);
  });
});

import { describe, expect, test } from "bun:test";
import type { RawIssue, TaskCard } from "./contracts";
import {
  BuildCompletedUseCase,
  QaApprovedUseCase,
  ReadTaskUseCase,
  SetPlanUseCase,
  SetSpecUseCase,
} from "./odt-task-store-use-cases";

const makeTask = (overrides: Partial<TaskCard> = {}): TaskCard => ({
  id: "task-1",
  title: "Task 1",
  status: "open",
  issueType: "feature",
  aiReviewEnabled: true,
  ...overrides,
});

const makeIssue = (overrides: Partial<RawIssue> = {}): RawIssue => ({
  id: "task-1",
  title: "Task 1",
  status: "open",
  issue_type: "feature",
  metadata: {},
  ...overrides,
});

describe("odt task workflow use cases", () => {
  test("ReadTaskUseCase returns the latest task snapshot and parsed documents", async () => {
    const issue = makeIssue();
    const task = makeTask({ status: "spec_ready" });
    const calls: string[] = [];

    const useCase = new ReadTaskUseCase({
      workflow: {
        ensureInitialized: async () => {
          calls.push("init");
        },
        readTaskSnapshot: async (taskId) => {
          calls.push(`read:${taskId}`);
          return { issue, task };
        },
      },
      documentStore: {
        parseDocs: (rawIssue) => {
          calls.push(`docs:${rawIssue.id}`);
          return {
            spec: { markdown: "# Spec", updatedAt: null },
            implementationPlan: { markdown: "# Plan", updatedAt: null },
            latestQaReport: { markdown: "", updatedAt: null, verdict: null },
          };
        },
      },
    });

    await expect(useCase.execute({ taskId: "task-1" })).resolves.toEqual({
      task,
      documents: {
        spec: { markdown: "# Spec", updatedAt: null },
        implementationPlan: { markdown: "# Plan", updatedAt: null },
        latestQaReport: { markdown: "", updatedAt: null, verdict: null },
      },
    });
    expect(calls).toEqual(["init", "read:task-1", "docs:task-1"]);
  });

  test("SetSpecUseCase persists the document before transitioning open tasks", async () => {
    const initialTask = makeTask({ status: "open" });
    const transitionedTask = makeTask({ status: "spec_ready" });
    const calls: string[] = [];

    const useCase = new SetSpecUseCase({
      workflow: {
        ensureInitialized: async () => {
          calls.push("init");
        },
        resolveTaskContext: async (taskId) => {
          calls.push(`resolve:${taskId}`);
          return { task: initialTask, tasks: [initialTask] };
        },
        refreshTaskContext: async (taskId, context) => {
          calls.push(`refresh:${taskId}:${context?.task.status ?? "none"}`);
          return { task: initialTask, tasks: [initialTask] };
        },
        transitionTask: async (taskId, nextStatus) => {
          calls.push(`transition:${taskId}:${nextStatus}`);
          return transitionedTask;
        },
      },
      documentStore: {
        persistSpec: async (taskId, markdown) => {
          calls.push(`persist:${taskId}:${markdown}`);
          return { updatedAt: "2026-03-01T00:00:00.000Z", revision: 2 };
        },
      },
    });

    await expect(
      useCase.execute({ taskId: "task-1", markdown: "  # Refined spec  " }),
    ).resolves.toEqual({
      task: transitionedTask,
      document: {
        markdown: "# Refined spec",
        updatedAt: "2026-03-01T00:00:00.000Z",
        revision: 2,
      },
    });
    expect(calls).toEqual([
      "init",
      "resolve:task-1",
      "persist:task-1:# Refined spec",
      "refresh:task-1:open",
      "transition:task-1:spec_ready",
    ]);
  });

  test("SetPlanUseCase coordinates epic replacement through injected ports", async () => {
    const epicTask = makeTask({
      id: "epic-1",
      title: "Epic",
      status: "spec_ready",
      issueType: "epic",
    });
    const readyTask = makeTask({
      id: "epic-1",
      title: "Epic",
      status: "ready_for_dev",
      issueType: "epic",
    });
    const calls: string[] = [];

    const useCase = new SetPlanUseCase({
      workflow: {
        ensureInitialized: async () => {
          calls.push("init");
        },
        resolveTaskContext: async (taskId) => {
          calls.push(`resolve:${taskId}`);
          return { task: epicTask, tasks: [epicTask] };
        },
        refreshTaskContext: async (taskId, context) => {
          calls.push(`refresh:${taskId}:${context?.task.status ?? "none"}`);
          return { task: epicTask, tasks: [epicTask] };
        },
        transitionTask: async (taskId, nextStatus) => {
          calls.push(`transition:${taskId}:${nextStatus}`);
          return readyTask;
        },
      },
      documentStore: {
        persistImplementationPlan: async (taskId, markdown) => {
          calls.push(`persist:${taskId}:${markdown}`);
          return { updatedAt: "2026-03-02T00:00:00.000Z", revision: 4 };
        },
      },
      epicSubtaskReplacementService: {
        prepareReplacement: async (task, subtasks) => {
          calls.push(`prepare:${task.id}:${subtasks.length}`);
          return {
            latestTask: task,
            existingDirectSubtasks: [makeTask({ id: "sub-legacy", parentId: task.id })],
          };
        },
        applyReplacement: async (task, currentSubtasks, subtasks) => {
          calls.push(`apply:${task.id}:${currentSubtasks.length}:${subtasks.length}`);
          return ["epic-1-sub-1"];
        },
      },
    });

    await expect(
      useCase.execute({
        taskId: "epic-1",
        markdown: "  # Execution plan  ",
        subtasks: [{ title: "Build API" }],
      }),
    ).resolves.toEqual({
      task: readyTask,
      document: {
        markdown: "# Execution plan",
        updatedAt: "2026-03-02T00:00:00.000Z",
        revision: 4,
      },
      createdSubtaskIds: ["epic-1-sub-1"],
    });
    expect(calls).toEqual([
      "init",
      "resolve:epic-1",
      "prepare:epic-1:1",
      "persist:epic-1:# Execution plan",
      "apply:epic-1:1:1",
      "refresh:epic-1:spec_ready",
      "transition:epic-1:ready_for_dev",
    ]);
  });

  test("BuildCompletedUseCase routes to ai_review when AI review is enabled", async () => {
    const inProgressTask = makeTask({ status: "in_progress", aiReviewEnabled: true });
    const aiReviewTask = makeTask({ status: "ai_review", aiReviewEnabled: true });
    const calls: string[] = [];

    const useCase = new BuildCompletedUseCase({
      workflow: {
        ensureInitialized: async () => {
          calls.push("init");
        },
        resolveTaskContext: async (taskId) => {
          calls.push(`resolve:${taskId}`);
          return { task: inProgressTask, tasks: [inProgressTask] };
        },
        refreshTaskContext: async (taskId, context) => {
          calls.push(`refresh:${taskId}:${context?.task.status ?? "none"}`);
          return { task: inProgressTask, tasks: [inProgressTask] };
        },
        transitionTask: async (taskId, nextStatus) => {
          calls.push(`transition:${taskId}:${nextStatus}`);
          return aiReviewTask;
        },
      },
    });

    await expect(
      useCase.execute({ taskId: "task-1", summary: "Implementation complete" }),
    ).resolves.toEqual({
      task: aiReviewTask,
      summary: "Implementation complete",
    });
    expect(calls).toEqual([
      "init",
      "resolve:task-1",
      "refresh:task-1:in_progress",
      "transition:task-1:ai_review",
    ]);
  });

  test("QaApprovedUseCase rejects invalid transitions before writing qa metadata", async () => {
    let appendCalled = false;
    let refreshCalled = false;
    let transitionCalled = false;
    const currentTask = makeTask({ status: "open" });

    const useCase = new QaApprovedUseCase({
      workflow: {
        ensureInitialized: async () => {},
        resolveTaskContext: async () => ({ task: currentTask, tasks: [currentTask] }),
        assertTransitionAllowed: () => {
          throw new Error("Transition not allowed");
        },
        refreshTaskContext: async () => {
          refreshCalled = true;
          return { task: currentTask, tasks: [currentTask] };
        },
        transitionTask: async () => {
          transitionCalled = true;
          return currentTask;
        },
      },
      documentStore: {
        appendQaReport: async () => {
          appendCalled = true;
        },
      },
    });

    await expect(
      useCase.execute({ taskId: "task-1", reportMarkdown: "## QA review" }),
    ).rejects.toThrow("Transition not allowed");
    expect(appendCalled).toBe(false);
    expect(refreshCalled).toBe(false);
    expect(transitionCalled).toBe(false);
  });
});

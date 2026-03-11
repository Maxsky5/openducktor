import { describe, expect, test } from "bun:test";
import type { RawIssue, TaskCard } from "./contracts";
import {
  BuildBlockedUseCase,
  BuildCompletedUseCase,
  BuildResumedUseCase,
  QaApprovedUseCase,
  QaRejectedUseCase,
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
    const issue = makeIssue();
    const calls: string[] = [];

    const useCase = new BuildCompletedUseCase({
      workflow: {
        ensureInitialized: async () => {
          calls.push("init");
        },
        readTaskSnapshot: async (taskId) => {
          calls.push(`read:${taskId}`);
          return { issue, task: inProgressTask };
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
      documentStore: {
        parseDocs: (rawIssue) => {
          calls.push(`docs:${rawIssue.id}:not_reviewed`);
          return {
            spec: { markdown: "", updatedAt: null },
            implementationPlan: { markdown: "", updatedAt: null },
            latestQaReport: { markdown: "", updatedAt: null, verdict: "not_reviewed" },
          };
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
      "read:task-1",
      "docs:task-1:not_reviewed",
      "transition:task-1:ai_review",
    ]);
  });

  test("BuildCompletedUseCase routes to human_review after approved QA", async () => {
    const inProgressTask = makeTask({ status: "in_progress", aiReviewEnabled: true });
    const humanReviewTask = makeTask({ status: "human_review", aiReviewEnabled: true });
    const issue = makeIssue({
      metadata: { openducktor: { documents: { qaReports: [{ verdict: "approved" }] } } },
    });
    const calls: string[] = [];

    const useCase = new BuildCompletedUseCase({
      workflow: {
        ensureInitialized: async () => {
          calls.push("init");
        },
        readTaskSnapshot: async (taskId) => {
          calls.push(`read:${taskId}`);
          return { issue, task: inProgressTask };
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
          return humanReviewTask;
        },
      },
      documentStore: {
        parseDocs: (rawIssue) => {
          calls.push(`docs:${rawIssue.id}:approved`);
          return {
            spec: { markdown: "", updatedAt: null },
            implementationPlan: { markdown: "", updatedAt: null },
            latestQaReport: { markdown: "", updatedAt: null, verdict: "approved" },
          };
        },
      },
    });

    await expect(useCase.execute({ taskId: "task-1" })).resolves.toEqual({
      task: humanReviewTask,
    });
    expect(calls).toEqual([
      "init",
      "resolve:task-1",
      "refresh:task-1:in_progress",
      "read:task-1",
      "docs:task-1:approved",
      "transition:task-1:human_review",
    ]);
  });

  test("BuildBlockedUseCase returns the blocker reason and transitions to blocked", async () => {
    const blockedTask = makeTask({ status: "blocked" });
    const calls: string[] = [];

    const useCase = new BuildBlockedUseCase({
      workflow: {
        ensureInitialized: async () => {
          calls.push("init");
        },
        transitionTask: async (taskId, nextStatus) => {
          calls.push(`transition:${taskId}:${nextStatus}`);
          return blockedTask;
        },
      },
    });

    await expect(
      useCase.execute({ taskId: "task-1", reason: "Waiting on upstream change" }),
    ).resolves.toEqual({
      task: blockedTask,
      reason: "Waiting on upstream change",
    });
    expect(calls).toEqual(["init", "transition:task-1:blocked"]);
  });

  test("BuildResumedUseCase transitions back to in_progress", async () => {
    const resumedTask = makeTask({ status: "in_progress" });
    const calls: string[] = [];

    const useCase = new BuildResumedUseCase({
      workflow: {
        ensureInitialized: async () => {
          calls.push("init");
        },
        transitionTask: async (taskId, nextStatus) => {
          calls.push(`transition:${taskId}:${nextStatus}`);
          return resumedTask;
        },
      },
    });

    await expect(useCase.execute({ taskId: "task-1" })).resolves.toEqual({
      task: resumedTask,
    });
    expect(calls).toEqual(["init", "transition:task-1:in_progress"]);
  });

  test("QaApprovedUseCase writes the qa report and status in a single task update", async () => {
    const qaTask = makeTask({ status: "ai_review" });
    const issue = makeIssue({ status: "ai_review" });
    const approvedTask = makeTask({ status: "human_review" });
    const calls: string[] = [];
    let appliedUpdate: { metadataRoot?: unknown; status?: string } | null = null;

    const useCase = new QaApprovedUseCase({
      workflow: {
        ensureInitialized: async () => {
          calls.push("init");
        },
        readTaskSnapshot: async (taskId) => {
          calls.push(`read:${taskId}`);
          return { issue, task: qaTask };
        },
        assertTransitionAllowed: () => {
          calls.push("assert");
        },
        applyTaskUpdate: async (taskId, input) => {
          calls.push(`apply:${taskId}:${input.status ?? "none"}`);
          appliedUpdate = input;
          return approvedTask;
        },
      },
      documentStore: {
        prepareQaReportWrite: (rawIssue, markdown, verdict) => {
          calls.push(`prepare:${rawIssue.id}:${verdict}:${markdown}`);
          return {
            metadataRoot: { openducktor: { documents: { qaReports: [{ verdict, markdown }] } } },
            namespace: {},
            root: {},
          };
        },
      },
    });

    await expect(
      useCase.execute({ taskId: "task-1", reportMarkdown: "## QA review" }),
    ).resolves.toEqual({ task: approvedTask });
    expect(calls).toEqual([
      "init",
      "read:task-1",
      "assert",
      "prepare:task-1:approved:## QA review",
      "apply:task-1:human_review",
    ]);
    expect(appliedUpdate).toEqual({
      metadataRoot: {
        openducktor: {
          documents: { qaReports: [{ verdict: "approved", markdown: "## QA review" }] },
        },
      },
      status: "human_review",
    });
  });

  test("QaApprovedUseCase accepts human_review tasks", async () => {
    const qaTask = makeTask({ status: "human_review" });
    const issue = makeIssue({ status: "human_review" });
    const approvedTask = makeTask({ status: "human_review" });
    const calls: string[] = [];

    const useCase = new QaApprovedUseCase({
      workflow: {
        ensureInitialized: async () => {
          calls.push("init");
        },
        readTaskSnapshot: async (taskId) => {
          calls.push(`read:${taskId}`);
          return { issue, task: qaTask };
        },
        assertTransitionAllowed: () => {
          calls.push("assert");
        },
        applyTaskUpdate: async (taskId, input) => {
          calls.push(`apply:${taskId}:${input.status ?? "none"}`);
          return approvedTask;
        },
      },
      documentStore: {
        prepareQaReportWrite: (rawIssue, markdown, verdict) => {
          calls.push(`prepare:${rawIssue.id}:${verdict}:${markdown}`);
          return {
            metadataRoot: { openducktor: { documents: { qaReports: [{ verdict, markdown }] } } },
            namespace: {},
            root: {},
          };
        },
      },
    });

    await expect(
      useCase.execute({ taskId: "task-1", reportMarkdown: "## QA follow-up" }),
    ).resolves.toEqual({ task: approvedTask });
    expect(calls).toEqual([
      "init",
      "read:task-1",
      "assert",
      "prepare:task-1:approved:## QA follow-up",
      "apply:task-1:human_review",
    ]);
  });

  test("QaApprovedUseCase rejects invalid transitions before preparing qa metadata", async () => {
    let prepareCalled = false;
    let updateCalled = false;
    const currentTask = makeTask({ status: "open" });

    const useCase = new QaApprovedUseCase({
      workflow: {
        ensureInitialized: async () => {},
        readTaskSnapshot: async () => ({ issue: makeIssue(), task: currentTask }),
        assertTransitionAllowed: () => {
          throw new Error("Transition not allowed");
        },
        applyTaskUpdate: async () => {
          updateCalled = true;
          return currentTask;
        },
      },
      documentStore: {
        prepareQaReportWrite: () => {
          prepareCalled = true;
          return {
            metadataRoot: {},
            namespace: {},
            root: {},
          };
        },
      },
    });

    await expect(
      useCase.execute({ taskId: "task-1", reportMarkdown: "## QA review" }),
    ).rejects.toThrow("QA outcomes are only allowed from ai_review or human_review");
    expect(prepareCalled).toBe(false);
    expect(updateCalled).toBe(false);
  });

  test("QaApprovedUseCase rejects non-ai-review tasks before transition validation", async () => {
    let assertCalled = false;
    const currentTask = makeTask({ status: "in_progress" });

    const useCase = new QaApprovedUseCase({
      workflow: {
        ensureInitialized: async () => {},
        readTaskSnapshot: async () => ({ issue: makeIssue(), task: currentTask }),
        assertTransitionAllowed: () => {
          assertCalled = true;
        },
        applyTaskUpdate: async () => currentTask,
      },
      documentStore: {
        prepareQaReportWrite: () => {
          throw new Error("should not prepare metadata");
        },
      },
    });

    await expect(
      useCase.execute({ taskId: "task-1", reportMarkdown: "## QA review" }),
    ).rejects.toThrow("QA outcomes are only allowed from ai_review or human_review");
    expect(assertCalled).toBe(false);
  });

  test("QaRejectedUseCase rejects invalid transitions before preparing qa metadata", async () => {
    let prepareCalled = false;
    let updateCalled = false;
    const currentTask = makeTask({ status: "open" });

    const useCase = new QaRejectedUseCase({
      workflow: {
        ensureInitialized: async () => {},
        readTaskSnapshot: async () => ({ issue: makeIssue(), task: currentTask }),
        assertTransitionAllowed: () => {
          throw new Error("Transition not allowed");
        },
        applyTaskUpdate: async () => {
          updateCalled = true;
          return currentTask;
        },
      },
      documentStore: {
        prepareQaReportWrite: () => {
          prepareCalled = true;
          return {
            metadataRoot: {},
            namespace: {},
            root: {},
          };
        },
      },
    });

    await expect(
      useCase.execute({ taskId: "task-1", reportMarkdown: "## QA review" }),
    ).rejects.toThrow("QA outcomes are only allowed from ai_review or human_review");
    expect(prepareCalled).toBe(false);
    expect(updateCalled).toBe(false);
  });

  test("QaRejectedUseCase rejects non-ai-review tasks before transition validation", async () => {
    let assertCalled = false;
    const currentTask = makeTask({ status: "in_progress" });

    const useCase = new QaRejectedUseCase({
      workflow: {
        ensureInitialized: async () => {},
        readTaskSnapshot: async () => ({ issue: makeIssue(), task: currentTask }),
        assertTransitionAllowed: () => {
          assertCalled = true;
        },
        applyTaskUpdate: async () => currentTask,
      },
      documentStore: {
        prepareQaReportWrite: () => {
          throw new Error("should not prepare metadata");
        },
      },
    });

    await expect(
      useCase.execute({ taskId: "task-1", reportMarkdown: "## QA review" }),
    ).rejects.toThrow("QA outcomes are only allowed from ai_review or human_review");
    expect(assertCalled).toBe(false);
  });

  test("QaRejectedUseCase accepts human_review tasks", async () => {
    const qaTask = makeTask({ status: "human_review" });
    const issue = makeIssue({ status: "human_review" });
    const rejectedTask = makeTask({ status: "in_progress" });
    const calls: string[] = [];

    const useCase = new QaRejectedUseCase({
      workflow: {
        ensureInitialized: async () => {
          calls.push("init");
        },
        readTaskSnapshot: async (taskId) => {
          calls.push(`read:${taskId}`);
          return { issue, task: qaTask };
        },
        assertTransitionAllowed: () => {
          calls.push("assert");
        },
        applyTaskUpdate: async (taskId, input) => {
          calls.push(`apply:${taskId}:${input.status ?? "none"}`);
          return rejectedTask;
        },
      },
      documentStore: {
        prepareQaReportWrite: (rawIssue, markdown, verdict) => {
          calls.push(`prepare:${rawIssue.id}:${verdict}:${markdown}`);
          return {
            metadataRoot: { openducktor: { documents: { qaReports: [{ verdict, markdown }] } } },
            namespace: {},
            root: {},
          };
        },
      },
    });

    await expect(
      useCase.execute({ taskId: "task-1", reportMarkdown: "## QA reject" }),
    ).resolves.toEqual({ task: rejectedTask });
    expect(calls).toEqual([
      "init",
      "read:task-1",
      "assert",
      "prepare:task-1:rejected:## QA reject",
      "apply:task-1:in_progress",
    ]);
  });
});

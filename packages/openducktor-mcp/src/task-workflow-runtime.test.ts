import { describe, expect, test } from "bun:test";
import { createOdtTaskWorkflowRuntime } from "./task-workflow-runtime";

type TaskCardFixtureInput = {
  id: string;
  title: string;
  status: "open" | "spec_ready" | "ready_for_dev";
  issueType: "feature" | "task";
  aiReviewEnabled: boolean;
};

const makeTask = (overrides: Partial<TaskCardFixtureInput> = {}) =>
  createTaskCard({
    id: "task-1",
    title: "Task 1",
    status: "open",
    issueType: "feature",
    aiReviewEnabled: true,
    ...overrides,
  });

const createTaskCard = (input: TaskCardFixtureInput) => ({
  id: input.id,
  title: input.title,
  status: input.status,
  issueType: input.issueType,
  aiReviewEnabled: input.aiReviewEnabled,
});

const makeIssue = (input: { id?: string; status?: string; metadata?: unknown }) => ({
  id: input.id ?? "task-1",
  title: "Task 1",
  status: input.status ?? "open",
  issue_type: "feature",
  metadata: input.metadata ?? {},
});

describe("task workflow runtime", () => {
  test("readTaskSnapshot resolves the canonical task id through the lookup port", async () => {
    const taskLookupCalls: string[] = [];
    const runtime = createOdtTaskWorkflowRuntime({
      persistence: {
        metadataNamespace: "openducktor",
        ensureInitialized: async () => {},
        runBdJson: async () => {
          throw new Error("runBdJson should not be called");
        },
        listTasks: async () => [],
        showRawIssue: async (taskId) =>
          makeIssue({
            id: taskId,
            status: "spec_ready",
            metadata: { openducktor: { qaRequired: false } },
          }),
        getNamespaceData: () => {
          throw new Error("getNamespaceData should not be called");
        },
        writeNamespace: async () => {
          throw new Error("writeNamespace should not be called");
        },
      },
      taskLookup: {
        resolveTask: async (taskId) => {
          taskLookupCalls.push(taskId);
          return makeTask({ id: "canonical-task-1", status: "open" });
        },
        invalidate: () => {},
      },
    });

    await expect(runtime.readTaskSnapshot("task-1")).resolves.toEqual({
      issue: makeIssue({
        id: "canonical-task-1",
        status: "spec_ready",
        metadata: { openducktor: { qaRequired: false } },
      }),
      task: makeTask({
        id: "canonical-task-1",
        status: "spec_ready",
        aiReviewEnabled: false,
      }),
    });
    expect(taskLookupCalls).toEqual(["task-1"]);
  });

  test("refreshTaskContext replaces the task entry inside an existing context", async () => {
    const currentTask = makeTask({ status: "open" });
    const runtime = createOdtTaskWorkflowRuntime({
      persistence: {
        metadataNamespace: "openducktor",
        ensureInitialized: async () => {},
        runBdJson: async () => {
          throw new Error("runBdJson should not be called");
        },
        listTasks: async () => [],
        showRawIssue: async () => makeIssue({ status: "spec_ready" }),
        getNamespaceData: () => {
          throw new Error("getNamespaceData should not be called");
        },
        writeNamespace: async () => {
          throw new Error("writeNamespace should not be called");
        },
      },
      taskLookup: {
        resolveTask: async () => currentTask,
        invalidate: () => {},
      },
    });

    await expect(
      runtime.refreshTaskContext("task-1", {
        task: currentTask,
        tasks: [currentTask],
      }),
    ).resolves.toEqual({
      task: makeTask({ status: "spec_ready" }),
      tasks: [makeTask({ status: "spec_ready" })],
    });
  });

  test("transitionTask invalidates lookup state after a successful status update", async () => {
    const runCalls: string[][] = [];
    let invalidateCalls = 0;
    const currentTask = makeTask({ status: "spec_ready" });
    const runtime = createOdtTaskWorkflowRuntime({
      persistence: {
        metadataNamespace: "openducktor",
        ensureInitialized: async () => {},
        runBdJson: async (args) => {
          runCalls.push(args);
          return {};
        },
        listTasks: async () => [currentTask],
        showRawIssue: async () => makeIssue({ status: "ready_for_dev" }),
        getNamespaceData: () => {
          throw new Error("getNamespaceData should not be called");
        },
        writeNamespace: async () => {
          throw new Error("writeNamespace should not be called");
        },
      },
      taskLookup: {
        resolveTask: async () => currentTask,
        invalidate: () => {
          invalidateCalls += 1;
        },
      },
    });

    await expect(runtime.transitionTask("task-1", "ready_for_dev")).resolves.toEqual(
      makeTask({ status: "ready_for_dev" }),
    );
    expect(runCalls).toEqual([["update", "task-1", "--status", "ready_for_dev"]]);
    expect(invalidateCalls).toBe(1);
  });
});

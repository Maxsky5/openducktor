import type { TaskCard } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../../effect/host-errors";
import type { TaskStorePort } from "../../../ports/task-repository-ports";
import { completeTaskClosure } from "./task-closure";

const closedTask = (): TaskCard => ({
  id: "task-1",
  title: "Task 1",
  description: "",
  status: "closed",
  priority: 2,
  issueType: "task",
  aiReviewEnabled: true,
  availableActions: [],
  labels: [],
  subtaskIds: [],
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false, verdict: "not_reviewed" },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: false, completed: false },
    planner: { required: false, canSkip: true, available: false, completed: false },
    builder: { required: true, canSkip: false, available: false, completed: false },
    qa: { required: true, canSkip: false, available: false, completed: false },
  },
  updatedAt: "2026-01-02T03:04:05Z",
  createdAt: "2026-01-01T03:04:05Z",
});

test("keeps cleanup resources acquired until the task is closed", async () => {
  const calls: string[] = [];
  const taskStore: Pick<TaskStorePort, "transitionTask"> = {
    transitionTask(input) {
      return Effect.sync(() => {
        calls.push(`transition:${input.status}`);
        expect(calls).not.toContain("cleanup:release");
        return closedTask();
      });
    },
  };
  const cleanup = Effect.acquireRelease(
    Effect.sync(() => {
      calls.push("cleanup:acquire");
    }),
    () =>
      Effect.sync(() => {
        calls.push("cleanup:release");
      }),
  );

  await expect(
    Effect.runPromise(
      completeTaskClosure({
        cleanup,
        repoPath: "/repo",
        taskId: "task-1",
        taskStore,
      }),
    ),
  ).resolves.toMatchObject({ id: "task-1", status: "closed" });
  expect(calls).toEqual(["cleanup:acquire", "transition:closed", "cleanup:release"]);
});

test("does not close the task when cleanup fails", async () => {
  let transitioned = false;
  const taskStore: Pick<TaskStorePort, "transitionTask"> = {
    transitionTask() {
      transitioned = true;
      return Effect.succeed(closedTask());
    },
  };
  const cleanup = Effect.fail(
    new HostOperationError({
      operation: "test.cleanup",
      message: "cleanup failed",
    }),
  );

  await expect(
    Effect.runPromise(
      completeTaskClosure({
        cleanup,
        repoPath: "/repo",
        taskId: "task-1",
        taskStore,
      }),
    ),
  ).rejects.toThrow("cleanup failed");
  expect(transitioned).toBe(false);
});

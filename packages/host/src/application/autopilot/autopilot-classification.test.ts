import { expect, test } from "bun:test";
import type { TaskStatus } from "@openducktor/contracts";
import type { TaskMutationOperation } from "../tasks/task-mutation-operation";
import { classifyCommittedStatusChange } from "./autopilot-classification";

const classify = (
  operation: TaskMutationOperation,
  previousStatus: TaskStatus,
  status: TaskStatus,
) =>
  classifyCommittedStatusChange(operation, {
    previousStatus,
    task: { id: "task", title: "Task", status },
  });

test.each<[TaskMutationOperation, TaskStatus, TaskStatus]>([
  ["reset-implementation", "in_progress", "spec_ready"],
  ["reset-implementation", "in_progress", "ready_for_dev"],
  ["set-spec", "ready_for_dev", "spec_ready"],
  ["set-plan", "in_progress", "ready_for_dev"],
  ["direct-merge", "ai_review", "human_review"],
  ["human-request-changes", "human_review", "in_progress"],
  ["build-resumed", "blocked", "in_progress"],
  ["transition-task", "in_progress", "ai_review"],
  ["qa-rejected", "in_progress", "blocked"],
  ["build-completed", "in_progress", "blocked"],
])("%s from %s to %s qualifies for no rule", (operation, previousStatus, status) => {
  expect(classify(operation, previousStatus, status)).toBeNull();
});

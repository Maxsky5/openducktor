import { describe, expect, test } from "bun:test";
import {
  createSharedBoardWorkflows,
  createWorkflowTaskCardFixture,
} from "@openducktor/workflows/test-support";
import { createTaskCardFixture } from "../../test-support/shared-test-fixtures";
import { getTaskFooter } from "../board/kanban-task-footer";
import { buildAgentStudioQuickActions } from "../../sessions/start/agent-studio-quick-actions";
import { CLOSE_TASK_ACTION, coreTaskActions, RESET_TASK_ACTION } from "./core-task-actions";

const footer = (task: ReturnType<typeof createTaskCardFixture>, mergedTarget?: string) =>
  getTaskFooter({
    task,
    taskSessions: [],
    historicalSessions: [],
    hasActiveSession: false,
    taskActivityState: "idle",
    mergedTarget,
  });

describe("core task actions", () => {
  test("give Reset Task and Close Task to every task that is not closed", () => {
    for (const status of ["open", "in_progress", "human_review"])
      expect(coreTaskActions(createTaskCardFixture({ status }))).toEqual([
        RESET_TASK_ACTION,
        CLOSE_TASK_ACTION,
      ]);
    expect(coreTaskActions(createTaskCardFixture({ status: "closed" }))).toEqual([]);
  });

  test("apply to a workflow that declares no close or reset action", () => {
    const { alpha, board } = createSharedBoardWorkflows();
    const task = createWorkflowTaskCardFixture(alpha, board, { status: "alpha_work" });
    expect(task.taskWorkflow.definition.actions.map(({ id }) => id).join(" ")).not.toMatch(
      /close|reset/,
    );
    expect(coreTaskActions(task).map(({ id }) => id)).toEqual(["reset_task", "close_task"]);
  });

  test("lead with Close Task on a merged task and keep every workflow action after it", () => {
    const task = createTaskCardFixture({
      status: "human_review",
      availableActions: ["human_approve", "human_request_changes"],
    });
    expect(footer(task).leadingCoreAction).toBeNull();
    const merged = footer(task, "origin/main");
    expect(merged.leadingCoreAction).toBe(CLOSE_TASK_ACTION);
    expect(merged.actions.primaryAction).toBeNull();
    expect(merged.actions.secondaryActions).toEqual(["human_approve", "human_request_changes"]);
    expect(
      footer(createTaskCardFixture({ status: "closed" }), "origin/main").leadingCoreAction,
    ).toBeNull();
  });

  test("lead the Agent Studio quick actions with the core Close Task of a merged branch", () => {
    const task = createTaskCardFixture({
      status: "human_review",
      availableActions: ["human_approve", "human_request_changes"],
    });
    const [first] = buildAgentStudioQuickActions({
      selectedTask: task,
      sessionsForTask: [],
      roleEnabledByTask: {},
      createSessionDisabled: false,
      mergedTarget: "origin/main",
    });
    expect(first).toMatchObject({
      kind: "task_action",
      id: "task:close_task",
      taskAction: { kind: "core", action: CLOSE_TASK_ACTION },
      label: "Close Task",
      mergedTarget: "origin/main",
    });
  });
});

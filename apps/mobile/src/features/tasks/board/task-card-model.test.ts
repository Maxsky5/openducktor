import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord, TaskCard } from "@openducktor/contracts";
import { createTaskCardFixture } from "@openducktor/frontend-core/test-support/shared-test-fixtures";
import type { KanbanTaskSession } from "@openducktor/frontend-core/tasks/board/kanban-task-activity";
import { buildTaskCardModel } from "./task-card-model";

const task = (overrides: Partial<TaskCard>): TaskCard =>
  createTaskCardFixture({ id: "TASK-1", title: "Add export", ...overrides });

const session = (
  role: KanbanTaskSession["role"],
  activityState: KanbanTaskSession["activityState"],
): KanbanTaskSession => ({
  externalSessionId: `${role}-session`,
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktrees/task-1",
  role,
  startedAt: "2026-10-01T10:00:00.000Z",
  activityState,
});

describe("buildTaskCardModel", () => {
  test("picks the desktop primary action and puts the other valid actions in the menu", () => {
    const model = buildTaskCardModel({
      task: task({
        status: "human_review",
        availableActions: [
          "human_approve",
          "human_request_changes",
          "reset_implementation",
          "reset_task",
        ],
      }),
      taskSessions: [],
      historicalSessions: [],
      activeSessionRole: undefined,
      taskActivityState: "idle",
    });
    expect(model.primary?.action).toBe("human_approve");
    expect(model.primary?.label).toBe("Approve Task");
    expect(model.primary?.appearance).toBe("filled");
    expect(model.primary?.icon).toBe("circle-check-big");
    expect(model.menu.map((item) => item.title)).toEqual([
      "Request Changes",
      "Reset Implementation",
    ]);
    expect(model.menu.find((item) => item.id === "reset_implementation")?.destructive).toBe(true);
    expect(model.menu.find((item) => item.id === "reset_implementation")?.icon).toBe("rotate-ccw");
    expect(model.liveSession).toBeNull();
  });

  test("shows only actions that the host lists", () => {
    const model = buildTaskCardModel({
      task: task({ status: "ready_for_dev", availableActions: [] }),
      taskSessions: [],
      historicalSessions: [],
      activeSessionRole: undefined,
      taskActivityState: "idle",
    });
    expect(model.primary).toBeNull();
    expect(model.menu).toEqual([]);
  });

  test("names the running session on the primary control", () => {
    const model = buildTaskCardModel({
      task: task({ status: "in_progress", availableActions: ["build_start", "open_builder"] }),
      taskSessions: [session("build", "waiting_input")],
      historicalSessions: [],
      activeSessionRole: "build",
      taskActivityState: "waiting_input",
    });
    expect(model.primary?.action).toBe("open_builder");
    expect(model.primary?.activeSession).toEqual({
      roleLabel: "Builder",
      statusLabel: "Waiting input",
      waitingInput: true,
    });
    expect(model.primary?.appearance).toBe("waiting");
    expect(model.liveSession).toEqual({
      role: "build",
      label: "Builder needs input",
      waitingInput: true,
    });
    expect(model.accessibilityLabel).toContain("Builder needs input");
    expect(model.sessionOptionsByRole.build?.session.externalSessionId).toBe("build-session");
  });

  test("shows a running session in sky and names it in the status strip", () => {
    const model = buildTaskCardModel({
      task: task({ status: "in_progress", availableActions: ["build_start", "open_builder"] }),
      taskSessions: [session("build", "running")],
      historicalSessions: [],
      activeSessionRole: "build",
      taskActivityState: "active",
    });
    expect(model.primary?.label).toBe("Open Builder");
    expect(model.primary?.appearance).toBe("running");
    expect(model.liveSession).toEqual({
      role: "build",
      label: "Builder running",
      waitingInput: false,
    });
  });

  test("outlines a start that is not the next workflow step", () => {
    const model = buildTaskCardModel({
      task: task({ status: "open", availableActions: ["set_spec"] }),
      taskSessions: [],
      historicalSessions: [],
      activeSessionRole: undefined,
      taskActivityState: "idle",
    });
    expect(model.primary?.label).toBe("Start Spec");
    expect(model.primary?.appearance).toBe("outline");
    expect(model.primary?.icon).toBe("file-pen");
  });

  test("adds shortcuts to earlier sessions of other roles", () => {
    const spec: AgentSessionRecord = {
      externalSessionId: "spec-1",
      role: "spec",
      startedAt: "2026-10-01T09:00:00.000Z",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktrees/task-1",
      selectedModel: null,
    };
    const model = buildTaskCardModel({
      task: task({ status: "ready_for_dev", availableActions: ["build_start"] }),
      taskSessions: [],
      historicalSessions: [spec],
      activeSessionRole: undefined,
      taskActivityState: "idle",
    });
    expect(model.primary?.label).toBe("Start Builder");
    expect(model.shortcuts.map((shortcut) => shortcut.label)).toEqual(["Spec"]);
  });

  test("shows no actions on a closed task and counts hidden labels", () => {
    const model = buildTaskCardModel({
      task: task({
        status: "closed",
        availableActions: ["reset_task"],
        labels: ["api", "ui", "docs", "mobile", "perf"],
        subtaskIds: ["TASK-2"],
      }),
      taskSessions: [],
      historicalSessions: [],
      activeSessionRole: undefined,
      taskActivityState: "idle",
    });
    expect(model.primary).toBeNull();
    expect(model.menu).toEqual([]);
    expect(model.visibleLabels).toEqual(["api", "ui"]);
    expect(model.hiddenLabels).toEqual(["docs", "mobile", "perf"]);
  });
});

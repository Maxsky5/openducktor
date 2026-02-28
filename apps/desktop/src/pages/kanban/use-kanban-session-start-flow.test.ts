import { describe, expect, test } from "bun:test";
import {
  createAgentSessionFixture,
  createTaskCardFixture,
} from "../agents/agent-studio-test-utils";
import {
  findLatestSessionByRoleForTask,
  resolveKanbanPlanningStartPreference,
} from "./use-kanban-session-start-flow";

describe("use-kanban-session-start-flow helpers", () => {
  test("findLatestSessionByRoleForTask returns the most recent matching session", () => {
    const sessions = [
      createAgentSessionFixture({
        sessionId: "spec-older",
        taskId: "TASK-1",
        role: "spec",
        startedAt: "2026-02-10T10:00:00.000Z",
      }),
      createAgentSessionFixture({
        sessionId: "build-latest",
        taskId: "TASK-1",
        role: "build",
        startedAt: "2026-02-12T10:00:00.000Z",
      }),
      createAgentSessionFixture({
        sessionId: "spec-latest",
        taskId: "TASK-1",
        role: "spec",
        startedAt: "2026-02-11T10:00:00.000Z",
      }),
    ];

    expect(findLatestSessionByRoleForTask(sessions, "TASK-1", "spec")?.sessionId).toBe(
      "spec-latest",
    );
    expect(findLatestSessionByRoleForTask(sessions, "TASK-1", "qa")).toBeNull();
  });

  test("resolveKanbanPlanningStartPreference matches task workflow rules", () => {
    const tasks = [createTaskCardFixture({ id: "TASK-1", status: "spec_ready" })];

    expect(resolveKanbanPlanningStartPreference(tasks, "TASK-1", "set_plan")).toBe("fresh");
    expect(resolveKanbanPlanningStartPreference(tasks, "TASK-1", "set_spec")).toBe("continue");
    expect(resolveKanbanPlanningStartPreference(tasks, "TASK-404", "set_spec")).toBe("fresh");
  });
});

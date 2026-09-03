import { describe, expect, test } from "bun:test";
import {
  addTaskToAgentStudioState,
  createAgentStudioStateSnapshot,
  reconcileAgentStudioOpenTaskIds,
  reconcileAgentStudioStateForReadModel,
} from "./agent-studio-workspace-state";
import { createAgentSessionSummaryFixture, createTaskCardFixture } from "./agent-studio-test-utils";

const createTask = (id: string, status: "open" | "closed" = "open") =>
  createTaskCardFixture({ id, status });

describe("agent-studio-workspace-state", () => {
  test("reconciles known open task ids in first-seen order", () => {
    expect(
      reconcileAgentStudioOpenTaskIds(
        ["missing", "task-2", "task-1", "task-2", "closed"],
        [createTask("task-1"), createTask("task-2"), createTask("closed", "closed")],
      ),
    ).toEqual(["task-2", "task-1"]);
  });

  test("adds only a known open task", () => {
    const state = { openTaskIds: ["task-1"] };
    const tasks = [createTask("task-1"), createTask("task-2"), createTask("closed", "closed")];

    expect(addTaskToAgentStudioState({ state, taskId: "task-2", tasks })).toEqual({
      openTaskIds: ["task-1", "task-2"],
    });
    expect(addTaskToAgentStudioState({ state, taskId: "missing", tasks })).toBe(state);
    expect(addTaskToAgentStudioState({ state, taskId: "closed", tasks })).toBe(state);
  });

  test("drops stale active tasks and sessions during read-model reconciliation", () => {
    const task = createTask("task-1");
    expect(
      reconcileAgentStudioStateForReadModel({
        state: { openTaskIds: ["task-1"], activeTask: { taskId: "missing", role: "qa" } },
        tasks: [task],
        sessions: [],
      }),
    ).toEqual({ openTaskIds: ["task-1"] });
    expect(
      reconcileAgentStudioStateForReadModel({
        state: {
          openTaskIds: ["task-1"],
          activeTask: {
            taskId: "task-1",
            role: "planner",
            externalSessionId: "stale-session",
          },
        },
        tasks: [task],
        sessions: [],
      }),
    ).toEqual({ openTaskIds: ["task-1"], activeTask: { taskId: "task-1", role: "planner" } });
  });

  test("uses the matched session role and canonical external session id", () => {
    const session = createAgentSessionSummaryFixture({
      externalSessionId: "session-1",
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
    });
    expect(
      reconcileAgentStudioStateForReadModel({
        state: {
          openTaskIds: ["task-1"],
          activeTask: {
            taskId: "task-1",
            role: "spec",
            externalSessionId: "session-1",
          },
        },
        tasks: [createTask("task-1")],
        sessions: [session],
      }),
    ).toEqual({
      openTaskIds: ["task-1"],
      activeTask: { taskId: "task-1", role: "build", externalSessionId: "session-1" },
    });
  });

  test("builds snapshots with optional active and session fields", () => {
    expect(
      createAgentStudioStateSnapshot({
        openTaskIds: ["task-1"],
        taskId: "",
        role: "spec",
        externalSessionId: null,
      }),
    ).toEqual({ openTaskIds: ["task-1"] });
    expect(
      createAgentStudioStateSnapshot({
        openTaskIds: ["task-1"],
        taskId: "task-1",
        role: "qa",
        externalSessionId: "session-1",
      }),
    ).toEqual({
      openTaskIds: ["task-1"],
      activeTask: { taskId: "task-1", role: "qa", externalSessionId: "session-1" },
    });
  });
});

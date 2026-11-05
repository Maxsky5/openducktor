import { describe, expect, test } from "bun:test";
import { type WorkflowRoleId as AgentRole } from "@openducktor/workflows";
import {
  createSharedBoardWorkflows,
  createWorkflowTaskCardFixture,
} from "@openducktor/workflows/test-support";
import { createTaskCardFixture } from "../../test-support/shared-test-fixtures";
import { editBuiltinTaskWorkflow } from "../../test-support/workflow-fixtures";
import type { SessionTargetOptions } from "../board/session-target-resolution";
import { resolveTaskActionDestination, taskActionSendsCommand } from "./task-action-destination";

/** The built-in actions that a task can show at once in these tests. */
const BUILTIN_ACTIONS = [
  "set_spec",
  "set_plan",
  "build_start",
  "qa_start",
  "open_builder",
  "open_qa",
  "human_approve",
  "human_request_changes",
  "reset_implementation",
];

describe("resolveTaskActionDestination", () => {
  test("starts the task-declared launch", () => {
    const task = createTaskCardFixture({
      id: "T-1",
      availableActions: ["set_spec"],
      issueType: "feature",
    });
    expect(resolveTaskActionDestination(task, "set_spec")).toEqual({
      kind: "launch",
      launchActionId: "spec_initial",
    });
  });

  test("routes an unfamiliar effect action to the existing approval flow", () => {
    const taskWorkflow = editBuiltinTaskWorkflow(({ definition }) => {
      const action = definition.actions.find(({ id }) => id === "human_approve")!;
      definition.actions.push({ ...action, id: "accept_review" });
    });
    const task = {
      ...createTaskCardFixture({
        id: "T-1",
        status: "human_review",
        availableActions: ["accept_review"],
      }),
      taskWorkflow,
    };
    expect(resolveTaskActionDestination(task, "accept_review")).toEqual({
      kind: "approve",
      continuation: undefined,
    });
  });

  test("keeps all Request Changes candidates for selection after commit", () => {
    const launchActionIds = ["build_after_human_request_changes", "after_committed_changes"];
    const taskWorkflow = editBuiltinTaskWorkflow(({ definition }) => {
      const action = definition.actions.find(({ id }) => id === "human_request_changes")!;
      if (action.kind !== "event") throw new Error("Expected a Request Changes event.");
      action.launchActionIds = [...launchActionIds];
      const step = definition.steps.find(
        (step) => step.kind === "agent" && step.roleId === "build",
      )!;
      if (step.kind !== "agent") throw new Error("Expected Builder step.");
      step.launchActions.push({
        ...step.launchActions[0]!,
        id: "after_committed_changes",
        selectWhen: { stateIn: ["in_progress"] },
      });
    });
    const task = {
      ...createTaskCardFixture({
        id: "T-1",
        status: "human_review",
        availableActions: ["human_request_changes"],
      }),
      taskWorkflow,
    };
    expect(resolveTaskActionDestination(task, "human_request_changes")).toEqual({
      kind: "request_changes",
      continuation: { workflow: task.workflow, launchActionIds },
    });
  });

  test("dispatches a declared plain event without treating its ID as a built-in command", () => {
    const taskWorkflow = editBuiltinTaskWorkflow(({ definition }) => {
      definition.events.push({
        id: "inspection.requested",
        from: ["open"],
        guards: [],
        outcomes: [{ to: "ai_review", when: true }],
      });
      definition.actions.push({
        id: "send_for_inspection",
        label: "Inspect",
        kind: "event",
        availableWhen: true,
        eventId: "inspection.requested",
      });
    });
    const task = {
      ...createTaskCardFixture({ id: "T-1", availableActions: ["send_for_inspection"] }),
      taskWorkflow,
    };
    expect(resolveTaskActionDestination(task, "send_for_inspection")).toEqual({
      kind: "event",
      eventId: "inspection.requested",
      launchActionIds: [],
    });
    expect(taskActionSendsCommand(task, "send_for_inspection")).toBe(true);
  });

  test("opens the requested historical session even when its role cannot start", () => {
    const task = createTaskCardFixture({ id: "T-1", status: "closed" });
    const session = {
      externalSessionId: "build-session",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo/worktree",
    };
    expect(
      resolveTaskActionDestination(task, "open_builder", (role) =>
        role === "build" ? { session } : undefined,
      ),
    ).toEqual({ kind: "open_session", role: "build", options: { session } });
    expect(taskActionSendsCommand(task, "open_builder")).toBe(false);
  });

  test("asks for confirmation before an implementation reset and rejects an unavailable action", () => {
    const task = createTaskCardFixture({ id: "T-1", availableActions: ["reset_implementation"] });
    expect(resolveTaskActionDestination(task, "reset_implementation")).toEqual({
      kind: "confirm",
      action: "reset_implementation",
      continuation: undefined,
    });
    expect(() => resolveTaskActionDestination(task, "set_spec")).toThrow("unavailable");
  });
});

const builder: SessionTargetOptions = {
  session: { externalSessionId: "b-1", runtimeKind: "opencode", workingDirectory: "/wt/task-1" },
};
const sessions = (role: AgentRole) => (role === "build" ? builder : undefined);

describe("resolveTaskActionDestination of built-in actions", () => {
  test("opens the start sheet for actions that start a session", () => {
    expect(
      resolveTaskActionDestination(
        createTaskCardFixture({
          id: "T-1",
          availableActions: BUILTIN_ACTIONS,
        }),
        "set_spec",
        sessions,
      ),
    ).toEqual({
      kind: "launch",
      launchActionId: "spec_initial",
    });
    expect(
      resolveTaskActionDestination(
        createTaskCardFixture({
          id: "T-1",
          availableActions: BUILTIN_ACTIONS,
        }),
        "set_plan",
        sessions,
      ),
    ).toEqual({
      kind: "launch",
      launchActionId: "planner_initial",
    });
    expect(
      resolveTaskActionDestination(
        createTaskCardFixture({
          id: "T-1",
          availableActions: BUILTIN_ACTIONS,
        }),
        "build_start",
        sessions,
      ),
    ).toEqual({
      kind: "launch",
      launchActionId: "build_implementation_start",
    });
    expect(
      resolveTaskActionDestination(
        createTaskCardFixture({
          id: "T-1",
          availableActions: BUILTIN_ACTIONS,
        }),
        "qa_start",
        sessions,
      ),
    ).toEqual({
      kind: "launch",
      launchActionId: "qa_review",
    });
  });

  test("opens the session of a role, or reports that the role has none", () => {
    expect(
      resolveTaskActionDestination(
        createTaskCardFixture({
          id: "T-1",
          availableActions: BUILTIN_ACTIONS,
        }),
        "open_builder",
        sessions,
      ),
    ).toEqual({
      kind: "open_session",
      role: "build",
      options: builder,
    });
    expect(
      resolveTaskActionDestination(
        createTaskCardFixture({
          id: "T-1",
          availableActions: BUILTIN_ACTIONS,
        }),
        "open_qa",
        sessions,
      ),
    ).toEqual({
      kind: "no_session",
      role: "qa",
    });
  });

  test("routes review and override actions to their sheets and confirmations", () => {
    expect(
      resolveTaskActionDestination(
        createTaskCardFixture({
          id: "T-1",
          availableActions: BUILTIN_ACTIONS,
        }),
        "human_approve",
        sessions,
      ),
    ).toEqual({
      kind: "approve",
    });
    expect(
      resolveTaskActionDestination(
        createTaskCardFixture({
          id: "T-1",
          availableActions: BUILTIN_ACTIONS,
        }),
        "human_request_changes",
        sessions,
      ),
    ).toEqual({
      kind: "request_changes",
      continuation: {
        workflow: createTaskCardFixture().workflow,
        launchActionIds: ["build_after_human_request_changes"],
      },
    });
    expect(
      resolveTaskActionDestination(
        createTaskCardFixture({
          id: "T-1",
          availableActions: BUILTIN_ACTIONS,
        }),
        "reset_implementation",
        sessions,
      ),
    ).toEqual({
      kind: "confirm",
      action: "reset_implementation",
    });
  });
});

describe("taskActionSendsCommand", () => {
  test("gates the actions that need the live host and keeps session views open", () => {
    for (const action of [
      "set_spec",
      "set_plan",
      "build_start",
      "qa_start",
      "human_approve",
      "human_request_changes",
      "reset_implementation",
    ] as const) {
      expect(taskActionSendsCommand(createTaskCardFixture(), action)).toBe(true);
    }
    for (const action of ["open_spec", "open_planner", "open_builder", "open_qa"] as const) {
      expect(taskActionSendsCommand(createTaskCardFixture(), action)).toBe(false);
    }
  });
});

test("dispatch keeps the actions of each workflow in a shared lane", () => {
  const { alpha, beta, board } = createSharedBoardWorkflows();
  const task = createWorkflowTaskCardFixture(alpha, board, { status: "shared_review" });
  expect(resolveTaskActionDestination(task, "alpha_hold", () => undefined)).toEqual({
    kind: "event",
    eventId: "alpha_hold",
    launchActionIds: [],
  });
  const other = createWorkflowTaskCardFixture(beta, board, { status: "shared_review" });
  expect(() => resolveTaskActionDestination(other, "alpha_hold", () => undefined)).toThrow(
    "has no action",
  );
  expect(() => resolveTaskActionDestination(other, "beta_hold", () => undefined)).toThrow(
    "unavailable",
  );
});

import {
  createSharedBoardWorkflows,
  createWorkflowTaskCardFixture,
} from "@openducktor/workflows/test-support";
import { createTaskCardFixture } from "../../test-support/shared-test-fixtures";
import { type WorkflowRoleId as AgentRole } from "@openducktor/workflows";
import { describe, expect, test } from "bun:test";
import type { SessionTargetOptions } from "../board/session-target-resolution";
import { resolveTaskActionDestination, taskActionSendsCommand } from "./task-action-destination";

const builder: SessionTargetOptions = {
  session: { externalSessionId: "b-1", runtimeKind: "opencode", workingDirectory: "/wt/task-1" },
};
const sessions = (role: AgentRole) => (role === "build" ? builder : undefined);

describe("resolveTaskActionDestination", () => {
  test("opens the start sheet for actions that start a session", () => {
    expect(
      resolveTaskActionDestination(
        createTaskCardFixture({
          id: "T-1",
          availableActions: [
            "set_spec",
            "set_plan",
            "build_start",
            "qa_start",
            "open_builder",
            "open_qa",
            "human_approve",
            "human_request_changes",
            "reset_implementation",
            "reset_task",
            "close_task",
          ],
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
          availableActions: [
            "set_spec",
            "set_plan",
            "build_start",
            "qa_start",
            "open_builder",
            "open_qa",
            "human_approve",
            "human_request_changes",
            "reset_implementation",
            "reset_task",
            "close_task",
          ],
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
          availableActions: [
            "set_spec",
            "set_plan",
            "build_start",
            "qa_start",
            "open_builder",
            "open_qa",
            "human_approve",
            "human_request_changes",
            "reset_implementation",
            "reset_task",
            "close_task",
          ],
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
          availableActions: [
            "set_spec",
            "set_plan",
            "build_start",
            "qa_start",
            "open_builder",
            "open_qa",
            "human_approve",
            "human_request_changes",
            "reset_implementation",
            "reset_task",
            "close_task",
          ],
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
          availableActions: [
            "set_spec",
            "set_plan",
            "build_start",
            "qa_start",
            "open_builder",
            "open_qa",
            "human_approve",
            "human_request_changes",
            "reset_implementation",
            "reset_task",
            "close_task",
          ],
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
          availableActions: [
            "set_spec",
            "set_plan",
            "build_start",
            "qa_start",
            "open_builder",
            "open_qa",
            "human_approve",
            "human_request_changes",
            "reset_implementation",
            "reset_task",
            "close_task",
          ],
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
          availableActions: [
            "set_spec",
            "set_plan",
            "build_start",
            "qa_start",
            "open_builder",
            "open_qa",
            "human_approve",
            "human_request_changes",
            "reset_implementation",
            "reset_task",
            "close_task",
          ],
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
          availableActions: [
            "set_spec",
            "set_plan",
            "build_start",
            "qa_start",
            "open_builder",
            "open_qa",
            "human_approve",
            "human_request_changes",
            "reset_implementation",
            "reset_task",
            "close_task",
          ],
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
          availableActions: [
            "set_spec",
            "set_plan",
            "build_start",
            "qa_start",
            "open_builder",
            "open_qa",
            "human_approve",
            "human_request_changes",
            "reset_implementation",
            "reset_task",
            "close_task",
          ],
        }),
        "reset_implementation",
        sessions,
      ),
    ).toEqual({
      kind: "confirm",
      action: "reset_implementation",
    });
    expect(
      resolveTaskActionDestination(
        createTaskCardFixture({
          id: "T-1",
          availableActions: [
            "set_spec",
            "set_plan",
            "build_start",
            "qa_start",
            "open_builder",
            "open_qa",
            "human_approve",
            "human_request_changes",
            "reset_implementation",
            "reset_task",
            "close_task",
          ],
        }),
        "reset_task",
        sessions,
      ),
    ).toEqual({
      kind: "confirm",
      action: "reset_task",
    });
    expect(
      resolveTaskActionDestination(
        createTaskCardFixture({
          id: "T-1",
          availableActions: [
            "set_spec",
            "set_plan",
            "build_start",
            "qa_start",
            "open_builder",
            "open_qa",
            "human_approve",
            "human_request_changes",
            "reset_implementation",
            "reset_task",
            "close_task",
          ],
        }),
        "close_task",
        sessions,
      ),
    ).toEqual({
      kind: "confirm",
      action: "close_task",
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
      "reset_task",
      "close_task",
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
  expect(resolveTaskActionDestination(task, "alpha_shelve", () => undefined)).toEqual({
    kind: "confirm",
    action: "close_task",
  });
  const other = createWorkflowTaskCardFixture(beta, board, { status: "shared_review" });
  expect(() => resolveTaskActionDestination(other, "alpha_hold", () => undefined)).toThrow(
    "has no action",
  );
  expect(() => resolveTaskActionDestination(other, "beta_hold", () => undefined)).toThrow(
    "unavailable",
  );
});

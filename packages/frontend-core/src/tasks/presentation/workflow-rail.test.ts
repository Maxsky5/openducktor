import { describe, expect, test } from "bun:test";
import { createTaskCardFixture } from "../../test-support/shared-test-fixtures";
import { buildWorkflowRail } from "./workflow-rail";

describe("buildWorkflowRail", () => {
  test("shows each step in order with the session and live state of its role", () => {
    const task = createTaskCardFixture({
      id: "T-1",
      status: "in_progress",
      availableActions: ["open_builder"],
    });
    const rail = buildWorkflowRail(task, (role) =>
      role === "build"
        ? { session: "build-session", liveSession: "waiting_input", waitingOnBackground: false }
        : { session: null, liveSession: "none", waitingOnBackground: false },
    );
    expect(rail.map(({ id, role }) => ({ id, role }))).toEqual(
      task.taskWorkflow.definition.steps.map((step) => ({
        id: step.id,
        role: step.kind === "agent" ? step.roleId : null,
      })),
    );
    const build = rail.find(({ role }) => role === "build")!;
    expect(build.session).toBe("build-session");
    expect(build.state.tone).toBe("waiting_input");
    expect(build.stateLabel).toBe("Needs input");
    expect(build.attentionVariant).toBe("session_waiting_input");
    expect(rail.find(({ role }) => role === "spec")?.session).toBeNull();
  });

  test("marks the step of a running session that waits on background tasks", () => {
    const task = createTaskCardFixture({
      id: "T-2",
      status: "in_progress",
      availableActions: ["open_builder"],
    });
    const rail = buildWorkflowRail(task, (role) =>
      role === "build"
        ? { session: "build-session", liveSession: "running", waitingOnBackground: true }
        : { session: null, liveSession: "none", waitingOnBackground: false },
    );
    const build = rail.find(({ role }) => role === "build")!;
    expect(build.state).toMatchObject({ liveSession: "running", waitingOnBackground: true });
    expect(build.hint).toBe("Session is running and waiting on background tasks");
    expect(rail.find(({ role }) => role === "spec")?.state.waitingOnBackground).toBe(false);
  });
});

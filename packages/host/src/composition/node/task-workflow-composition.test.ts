import { describe, expect, test } from "bun:test";
import type { TaskWorkflow } from "@openducktor/workflows";
import { createReviewTaskWorkflow } from "@openducktor/workflows/test-support";
import { Effect } from "effect";
import { createSessionRolePolicies } from "../../application/agent-sessions/session-role-policies";

const original = createReviewTaskWorkflow();
const editor = original.roles.find(({ id }) => id === "editor")!;
/** The review workflow after a role save gives the editor write access. */
const changed: TaskWorkflow = {
  ...original,
  role: (role) =>
    role === "editor" ? { ...editor, workspaceAccess: "write" } : original.role(role),
};
const session = (externalSessionId: string | null, workspaceId = "repo") => ({
  workspaceId,
  taskId: "task-1",
  role: "editor",
  externalSessionId,
});

describe("session role policies", () => {
  test("attaches a session that this host did not start with the workflow of its task", () => {
    let current = original;
    const policies = createSessionRolePolicies(() => current);

    expect(policies.resolve(session("session-1"))).toEqual({
      tools: ["odt_read_task", "odt_read_task_artifacts", "odt_set_task_artifact"],
      readOnly: true,
    });
    current = changed;
    expect(policies.resolve(session("session-1"))).toMatchObject({ readOnly: true });
    expect(policies.resolve(session("session-2"))).toMatchObject({ readOnly: false });
  });

  test("attaches a session with the workflow of its task in its own workspace", () => {
    const policies = createSessionRolePolicies((workspaceId, taskId) =>
      workspaceId === "workspace-b" && taskId === "task-1" ? changed : original,
    );

    expect(policies.resolve(session("session-1", "workspace-a"))).toMatchObject({
      readOnly: true,
    });
    expect(policies.resolve(session("session-1", "workspace-b"))).toMatchObject({
      readOnly: false,
    });
  });

  test("rejects a role that the workflow of the task does not declare", () => {
    const policies = createSessionRolePolicies(() => original);

    expect(() => policies.resolve({ ...session("session-1"), role: "build" })).toThrow("build");
  });

  test("rejects a task that this host has not read", () => {
    const policies = createSessionRolePolicies(() => undefined);

    expect(() => policies.resolve(session("session-1"))).toThrow("Reload the task, then retry.");
  });

  test("rejects a new session that has no prepared start", () => {
    const policies = createSessionRolePolicies(() => original);

    expect(() => policies.resolve(session(null))).toThrow("Start the session from the task again.");
  });

  test("keeps equal task IDs of two workspaces apart", async () => {
    const policies = createSessionRolePolicies(() => original);

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const first = yield* policies.prepare(session(null, "workspace-a"), original);
          const second = yield* policies.prepare(session(null, "workspace-b"), changed);
          expect(policies.resolve(session(null, "workspace-a"))).toMatchObject({ readOnly: true });
          expect(policies.resolve(session(null, "workspace-b"))).toMatchObject({
            readOnly: false,
          });
          yield* first.keep("session-1");
          yield* second.keep("session-1");
        }),
      ),
    );

    expect(policies.resolve(session("session-1", "workspace-a"))).toMatchObject({
      readOnly: true,
    });
    expect(policies.resolve(session("session-1", "workspace-b"))).toMatchObject({
      readOnly: false,
    });
  });

  test("gives a resumed session the current policy and restores it when the resume fails", async () => {
    const policies = createSessionRolePolicies(() => original);
    expect(policies.resolve(session("session-1"))).toMatchObject({ readOnly: true });

    const failed = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          yield* policies.prepare(session("session-1"), changed);
          expect(policies.resolve(session("session-1"))).toMatchObject({ readOnly: false });
          return yield* Effect.fail("resume failed");
        }),
      ),
    );
    expect(failed._tag).toBe("Failure");
    expect(policies.resolve(session("session-1"))).toMatchObject({ readOnly: true });

    await Effect.runPromise(Effect.scoped(policies.prepare(session("session-1"), changed)));
    expect(policies.resolve(session("session-1"))).toMatchObject({ readOnly: false });
  });
});

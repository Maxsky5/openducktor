import { describe, expect, test } from "bun:test";
import type { WorkflowRolePolicy } from "@openducktor/core";
import type { TaskWorkflow } from "@openducktor/workflows";
import { createReviewTaskWorkflow } from "@openducktor/workflows/test-support";
import { Effect } from "effect";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import { task as harnessTask } from "../tasks/test-support/task-workflow-harness";
import { createTaskSessionLifecycleCoordinator } from "../tasks/worktrees/task-session-lifecycle-coordinator";
import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import { createSessionRolePolicies } from "./session-role-policies";
import { createTaskSessionOperations } from "./task-session-operations";

const original = createReviewTaskWorkflow();
const editor = original.roles.find(({ id }) => id === "editor")!;
/** The review workflow after a role save gives the editor write access. */
const changed: TaskWorkflow = {
  ...original,
  role: (role) =>
    role === "editor" ? { ...editor, workspaceAccess: "write" } : original.role(role),
};
const scope = { workspaceId: "repo", taskId: "task-1", role: "editor" };
const session = (externalSessionId: string | null) => ({ ...scope, externalSessionId });

describe("task session start role policy", () => {
  const createHarness = () => {
    let workflow = original;
    let nextSession = 1;
    let startFailure: string | null = null;
    const policies = createSessionRolePolicies(() => workflow);
    const startPolicies: WorkflowRolePolicy[] = [];
    const operations = createTaskSessionOperations({
      prepareRolePolicy: (sessionScope) => policies.prepare(sessionScope, workflow),
      taskWorkflows: builtinTaskWorkflows,
      canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
      taskReader: { getTask: () => Effect.die(new Error("unexpected task read")) },
      taskLifecycle: createTaskSessionLifecycleCoordinator(),
      taskSessionStart: {
        prepare: () =>
          Effect.succeed({
            workspaceId: "repo",
            canonicalRepoPath: "/repo",
            rollback: () => Effect.void,
            preparedStatus: "in_progress",
            role: "editor",
            runtimeKind: "opencode" as const,
            task: harnessTask({ status: "in_progress" }),
            workingDirectory: "/repo/worktree",
          }),
        complete: () => Effect.succeed(undefined),
      },
      runtime: {
        // The runtime adapter reads the policy before the new session has an identity.
        startSession: (input) =>
          Effect.suspend(() => {
            if (input.sessionScope.kind !== "workflow")
              return Effect.die(new Error("unexpected repository session"));
            startPolicies.push(
              policies.resolve({ ...input.sessionScope, externalSessionId: null }),
            );
            if (startFailure)
              return Effect.fail(
                new HostOperationError({ operation: "test.start", message: startFailure }),
              );
            return Effect.succeed({
              externalSessionId: `session-${nextSession++}`,
              runtimeKind: "opencode" as const,
              workingDirectory: "/repo/worktree",
              title: "Editor session",
              startedAt: "2026-11-12T10:00:00.000Z",
              status: "idle" as const,
            });
          }),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: { agentSessionsList: () => Effect.die(new Error("unexpected list")) },
      writes: {
        saveSession: () => Effect.succeed({ publish: Effect.void }),
        applyStartEvent: () =>
          Effect.succeed({ task: harnessTask({ status: "in_progress" }), publish: Effect.void }),
      },
    });
    const start = () =>
      operations.start(
        {
          repoPath: "/repo",
          runtimeKind: "opencode",
          sessionScope: { kind: "workflow", ...scope },
          systemPrompt: "Review the task",
          model: { runtimeKind: "opencode", providerId: "openai", modelId: "gpt-5" },
        },
        {
          checkCanceled: () => Effect.void,
          created: () => Effect.void,
          saved: () => {},
          stop: () => Effect.void,
        },
      );
    return {
      policies,
      startPolicies,
      start,
      saveRole: () => {
        workflow = changed;
      },
      failStarts: (message: string) => {
        startFailure = message;
      },
    };
  };

  test("keeps the policy of a running session when a later session starts after a role save", async () => {
    const h = createHarness();
    await Effect.runPromise(h.start());
    h.saveRole();
    await Effect.runPromise(h.start());

    expect(h.startPolicies.map(({ readOnly }) => readOnly)).toEqual([true, false]);
    expect(h.policies.resolve(session("session-1"))).toMatchObject({ readOnly: true });
    expect(h.policies.resolve(session("session-2"))).toMatchObject({ readOnly: false });
  });

  test("leaves the policy of a running session when a start fails", async () => {
    const h = createHarness();
    await Effect.runPromise(h.start());
    h.saveRole();
    h.failStarts("runtime start failed");

    await expect(Effect.runPromise(h.start())).rejects.toThrow("runtime start failed");
    expect(h.startPolicies.map(({ readOnly }) => readOnly)).toEqual([true, false]);
    expect(h.policies.resolve(session("session-1"))).toMatchObject({ readOnly: true });
    expect(() => h.policies.resolve(session(null))).toThrow(
      "Start the session from the task again.",
    );
  });
});

describe("session role policies", () => {
  test("fail with a typed error for a session of a role that the version does not bind", async () => {
    const policies = createSessionRolePolicies(() => original);
    const unbound = { ...scope, role: "translator", externalSessionId: "old-session" };
    const prepared = await Effect.runPromise(
      Effect.scoped(policies.prepare(unbound, original)).pipe(Effect.flip),
    );
    expect(prepared).toBeInstanceOf(HostValidationError);
    expect(prepared.message).toContain("has no translator role");
    expect(() => policies.resolve(unbound)).toThrow("has no translator role");
  });
});

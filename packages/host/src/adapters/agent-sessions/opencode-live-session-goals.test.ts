import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { AgentSessionLiveAdapterChange } from "../../ports/agent-session-live-adapter-port";
import { builtinWorkflowRolePolicy } from "../../test-support/workflow-role-policy";
import {
  createLifecycle,
  createRuntimeHarness,
  createTestOpenCodeLiveSessionAdapterPreparer,
  ignoreObservationLoss,
  ref,
  runtime,
} from "./opencode-live-session-adapter.test-support";

const sessionScope = {
  kind: "workflow" as const,
  workspaceId: "repo",
  taskId: "task-1",
  role: "build" as const,
};
const activeGoal = { objective: "Ship the release", status: "active" as const };

const prepareAdapter = async (harness = createRuntimeHarness()) => {
  const changes: AgentSessionLiveAdapterChange[] = [];
  const prepared = await Effect.runPromise(
    createTestOpenCodeLiveSessionAdapterPreparer({
      resolveWorkflowRolePolicy: builtinWorkflowRolePolicy,
      liveSessionLifecycle: createLifecycle(changes),
      prepareRuntime: harness.prepareRuntime,
    })(runtime, ignoreObservationLoss),
  );
  await Effect.runPromise(prepared.startForwarding());
  return { adapter: prepared.adapter, harness, changes };
};

const readGoal = async (adapter: Awaited<ReturnType<typeof prepareAdapter>>["adapter"]) => {
  const read = await Effect.runPromise(adapter.readSnapshot(ref));
  if (read.type !== "live") throw new Error("The session is not live.");
  return read.session.goal;
};

describe("OpenCode live session goals", () => {
  test("shows each goal change of the goal plugin and keeps it through other updates", async () => {
    const { adapter, harness, changes } = await prepareAdapter();
    try {
      await Effect.runPromise(
        adapter.resumeSession({ resumeMode: "reattach", ...ref, sessionScope }),
      );
      changes.length = 0;
      await harness.emit({
        type: "goal_updated",
        externalSessionId: ref.externalSessionId,
        goal: activeGoal,
      });
      expect(changes).toEqual([
        { type: "session_upsert", snapshot: expect.objectContaining({ goal: activeGoal }) },
      ]);

      await Effect.runPromise(adapter.updateSessionTitle({ ...ref, title: "Renamed" }));
      expect(await readGoal(adapter)).toEqual(activeGoal);

      await harness.emit({
        type: "goal_updated",
        externalSessionId: ref.externalSessionId,
        goal: null,
      });
      expect(await readGoal(adapter)).toBeUndefined();
    } finally {
      await Effect.runPromise(adapter.releaseRuntime());
    }
  });

  test("restores the goal that a session read reports", async () => {
    const paused = { ...activeGoal, status: "paused" as const, reason: "Stopped by the user" };
    const harness = createRuntimeHarness({
      sessionSources: [
        {
          repoPath: ref.repoPath,
          externalSessionId: ref.externalSessionId,
          workingDirectory: ref.workingDirectory,
          sessionAssociation: sessionScope,
          title: "Session",
          startedAt: "2026-07-16T10:00:00.000Z",
          runtimeActivity: "idle",
          pendingApprovals: [],
          pendingQuestions: [],
          goal: paused,
        },
      ],
    });
    const { adapter } = await prepareAdapter(harness);
    try {
      await Effect.runPromise(adapter.refreshSnapshots!(ref.repoPath, [{ ...ref, sessionScope }]));
      expect(await readGoal(adapter)).toEqual(paused);
    } finally {
      await Effect.runPromise(adapter.releaseRuntime());
    }
  });

  test("runs a goal action as an accepted goal command without writing the goal", async () => {
    const { adapter, harness } = await prepareAdapter();
    try {
      await Effect.runPromise(
        adapter.resumeSession({ resumeMode: "reattach", ...ref, sessionScope }),
      );
      let sent = false;
      const accepted = await Effect.runPromise(
        adapter.controlGoal(
          { ...ref, sessionScope, command: { kind: "pause" } },
          { onSent: () => (sent = true) },
        ),
      );
      expect(accepted).toEqual({ type: "command_accepted", commandName: "goal" });
      expect(sent).toBe(true);
      expect(harness.controlCalls.at(-1)).toEqual({
        operation: "goal",
        input: expect.objectContaining({ ...ref, sessionScope, command: { kind: "pause" } }),
      });
      expect(await readGoal(adapter)).toBeUndefined();
    } finally {
      await Effect.runPromise(adapter.releaseRuntime());
    }
  });
});

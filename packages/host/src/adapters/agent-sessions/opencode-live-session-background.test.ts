import { describe, expect, test } from "bun:test";
import type { AgentSessionBackgroundTask } from "@openducktor/contracts";
import { isAgentSessionWaitingOnBackground } from "@openducktor/core";
import { Effect } from "effect";
import { isReadyForTurn } from "../../application/agent-sessions/session-foreground-readiness";
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
const devServer: AgentSessionBackgroundTask = {
  taskId: "shell:sh_dev",
  kind: "command",
  title: "bun run dev",
  stop: { allowed: true },
};
const timestamp = "2026-07-16T10:05:00.000Z";

/** A runtime that has the idle session of `ref`. */
const createSessionHarness = () =>
  createRuntimeHarness({
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
      },
    ],
  });

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
  await Effect.runPromise(
    prepared.adapter.resumeSession({ resumeMode: "reattach", ...ref, sessionScope }),
  );
  return { adapter: prepared.adapter, harness, changes };
};

const readSession = async (adapter: Awaited<ReturnType<typeof prepareAdapter>>["adapter"]) => {
  const read = await Effect.runPromise(adapter.readSnapshot(ref));
  if (read.type !== "live") throw new Error("The session is not live.");
  return read.session;
};

describe("OpenCode live session background tasks", () => {
  test("keeps the session running on background work after its reply, until the work ends", async () => {
    const { adapter, harness } = await prepareAdapter(createSessionHarness());
    try {
      await harness.emit({
        type: "background_updated",
        externalSessionId: ref.externalSessionId,
        tasks: [devServer],
        resultPending: false,
      });
      expect(await readSession(adapter)).toMatchObject({
        activity: "running",
        foregroundTurnActive: true,
        backgroundTasks: [devServer],
      });

      await harness.emit({
        type: "session_event",
        externalSessionId: ref.externalSessionId,
        event: {
          type: "session_turn_finished",
          externalSessionId: ref.externalSessionId,
          timestamp,
          completionId: "evt_done",
          messageIds: [],
          turnOutcome: "completed",
        },
      });
      const waiting = await readSession(adapter);
      expect(waiting).toMatchObject({ activity: "running", foregroundTurnActive: false });
      expect(isAgentSessionWaitingOnBackground(waiting)).toBe(true);
      expect(isReadyForTurn(waiting)).toBe(true);

      // A session read and a control result rebuild the snapshot but keep the reported work.
      await Effect.runPromise(adapter.refreshSnapshots!(ref.repoPath, [{ ...ref, sessionScope }]));
      await Effect.runPromise(adapter.updateSessionTitle({ ...ref, title: "Renamed" }));
      expect(await readSession(adapter)).toMatchObject({
        activity: "running",
        foregroundTurnActive: false,
        backgroundTasks: [devServer],
      });

      await harness.emit({
        type: "background_updated",
        externalSessionId: ref.externalSessionId,
        tasks: [],
        resultPending: true,
      });
      const pending = await readSession(adapter);
      expect(pending).not.toHaveProperty("backgroundTasks");
      expect(pending).toMatchObject({ backgroundResultPending: true, activity: "running" });

      await harness.emit({
        type: "background_updated",
        externalSessionId: ref.externalSessionId,
        tasks: [],
        resultPending: false,
      });
      const idle = await readSession(adapter);
      expect(idle.activity).toBe("idle");
      expect(idle).not.toHaveProperty("foregroundTurnActive");
      expect(idle).not.toHaveProperty("backgroundResultPending");
    } finally {
      await Effect.runPromise(adapter.releaseRuntime());
    }
  });

  test("treats a status with no foreground turn as the end of the reply", async () => {
    const { adapter, harness } = await prepareAdapter();
    try {
      await harness.emit({
        type: "background_updated",
        externalSessionId: ref.externalSessionId,
        tasks: [devServer],
        resultPending: false,
      });
      await harness.emit({
        type: "session_event",
        externalSessionId: ref.externalSessionId,
        event: {
          type: "session_status",
          externalSessionId: ref.externalSessionId,
          timestamp,
          status: { type: "busy", message: null },
          foregroundTurnActive: false,
        },
      });
      expect(isAgentSessionWaitingOnBackground(await readSession(adapter))).toBe(true);
    } finally {
      await Effect.runPromise(adapter.releaseRuntime());
    }
  });

  test("keeps lost background tracking as unavailable status until the session is released", async () => {
    const { adapter, harness } = await prepareAdapter(createSessionHarness());
    const reason = "OpenCode sent an invalid background shell result. Check the OpenCode version.";
    const idle = {
      type: "session_event" as const,
      externalSessionId: ref.externalSessionId,
      event: {
        type: "session_idle" as const,
        externalSessionId: ref.externalSessionId,
        timestamp,
        turnOutcome: "completed" as const,
      },
    };
    try {
      await harness.emit({
        type: "session_fault",
        externalSessionId: ref.externalSessionId,
        message: reason,
        statusUnavailable: true,
        backgroundTrackingLost: true,
      });
      // Status events and later task reports give no evidence of the lost task.
      await harness.emit(idle);
      await harness.emit({
        type: "background_updated",
        externalSessionId: ref.externalSessionId,
        tasks: [devServer],
        resultPending: false,
      });
      await Effect.runPromise(adapter.refreshSnapshots!(ref.repoPath, [{ ...ref, sessionScope }]));
      const unavailable = await readSession(adapter);
      expect(unavailable.statusUnavailableReason).toBe(reason);
      expect(isAgentSessionWaitingOnBackground(unavailable)).toBe(false);

      await Effect.runPromise(adapter.releaseSession(ref));
      await Effect.runPromise(
        adapter.resumeSession({ resumeMode: "reattach", ...ref, sessionScope }),
      );
      await harness.emit(idle);
      expect(await readSession(adapter)).not.toHaveProperty("statusUnavailableReason");
    } finally {
      await Effect.runPromise(adapter.releaseRuntime());
    }
  });

  test("never publishes the parent as Idle when a child release loses its pending result", async () => {
    const { adapter, harness, changes } = await prepareAdapter(createSessionHarness());
    const reason =
      "The conversation 'child-1' was released while 1 background task result was not delivered.";
    try {
      await harness.emit({
        type: "background_updated",
        externalSessionId: ref.externalSessionId,
        tasks: [],
        resultPending: true,
      });
      const before = changes.length;
      // The adapter reports the loss first, then the work that the release left.
      await harness.emit({
        type: "session_fault",
        externalSessionId: ref.externalSessionId,
        message: reason,
        statusUnavailable: true,
        backgroundTrackingLost: true,
      });
      await harness.emit({
        type: "background_updated",
        externalSessionId: ref.externalSessionId,
        tasks: [],
        resultPending: false,
      });
      const parentSnapshots = changes
        .slice(before)
        .flatMap((change) =>
          change.type === "session_upsert" &&
          change.snapshot.ref.externalSessionId === ref.externalSessionId
            ? [change.snapshot]
            : [],
        );
      expect(parentSnapshots.length).toBeGreaterThan(0);
      for (const snapshot of parentSnapshots) {
        expect(snapshot.statusUnavailableReason).toBe(reason);
        expect(isReadyForTurn(snapshot)).toBe(false);
      }
    } finally {
      await Effect.runPromise(adapter.releaseRuntime());
    }
  });

  test("keeps lost background tracking of a child as unavailable status of its ancestors", async () => {
    const { adapter, harness } = await prepareAdapter(createSessionHarness());
    const childRef = { ...ref, externalSessionId: "child-1" };
    const reason = "OpenCode sent an invalid shell notice. Check the OpenCode version.";
    const readChild = async () => {
      const read = await Effect.runPromise(adapter.readSnapshot(childRef));
      if (read.type !== "live") throw new Error("The child session is not live.");
      return read.session;
    };
    try {
      await harness.emit({
        type: "session_source",
        source: {
          repoPath: ref.repoPath,
          externalSessionId: childRef.externalSessionId,
          parentExternalSessionId: ref.externalSessionId,
          workingDirectory: ref.workingDirectory,
          sessionAssociation: { kind: "unbound" },
          title: "OpenCode subagent",
          startedAt: "2026-07-16T10:01:00.000Z",
          runtimeActivity: "running",
          pendingApprovals: [],
          pendingQuestions: [],
        },
      });
      await harness.emit({
        type: "background_updated",
        externalSessionId: ref.externalSessionId,
        tasks: [devServer],
        resultPending: false,
      });
      await harness.emit({
        type: "session_fault",
        externalSessionId: childRef.externalSessionId,
        message: reason,
        statusUnavailable: true,
        backgroundTrackingLost: true,
      });
      // The reply of the parent ends, and a later report gives no evidence of the lost task.
      await harness.emit({
        type: "session_event",
        externalSessionId: ref.externalSessionId,
        event: {
          type: "session_idle",
          externalSessionId: ref.externalSessionId,
          timestamp,
          turnOutcome: "completed",
        },
      });
      await harness.emit({
        type: "background_updated",
        externalSessionId: ref.externalSessionId,
        tasks: [],
        resultPending: false,
      });
      const parent = await readSession(adapter);
      expect(parent.statusUnavailableReason).toBe(reason);
      expect((await readChild()).statusUnavailableReason).toBe(reason);

      await Effect.runPromise(adapter.releaseSession(ref));
      await Effect.runPromise(
        adapter.resumeSession({ resumeMode: "reattach", ...ref, sessionScope }),
      );
      await harness.emit({
        type: "session_event",
        externalSessionId: ref.externalSessionId,
        event: { type: "session_idle", externalSessionId: ref.externalSessionId, timestamp },
      });
      expect(await readSession(adapter)).not.toHaveProperty("statusUnavailableReason");
    } finally {
      await Effect.runPromise(adapter.releaseRuntime());
    }
  });

  test("stops one background task through the runtime and reports its reason on failure", async () => {
    const harness = createRuntimeHarness({
      stopBackgroundTaskError: new Error("shell service failed"),
    });
    const { adapter } = await prepareAdapter(harness);
    try {
      const failed = await Effect.runPromise(
        adapter.stopBackgroundTask({ ...ref, taskId: devServer.taskId }).pipe(Effect.flip),
      );
      expect(failed.message).toContain("shell service failed");
      expect(harness.controlCalls.at(-1)).toEqual({
        operation: "stopTask",
        input: { ...ref, taskId: devServer.taskId },
      });
    } finally {
      await Effect.runPromise(adapter.releaseRuntime());
    }
  });
});

import { describe, expect, test } from "bun:test";
import { AgentSessionTurnActiveError, type AgentEvent } from "@openducktor/core";
import {
  codexGoalFixture,
  codexRpcError,
  codexSessionRuntimeRef,
  codexStartSessionInput,
  codexTurnFixture,
  codexUserMessageInput,
  createHarness,
  createRuntimeStreamSubscription,
  flushCodexAdapterWork,
} from "./codex-app-server-adapter.test-harness";
import { CodexMessageAcceptedError } from "./codex-message-accepted-error";

const THREAD_ID = "thread/start-runtime-live";

const startGoalSession = async () => {
  const stream = createRuntimeStreamSubscription();
  const harness = createHarness({ subscribeEvents: stream.subscribeEvents });
  await harness.adapter.startSession(codexStartSessionInput());
  const events: AgentEvent[] = [];
  const ref = codexSessionRuntimeRef();
  const unsubscribe = await harness.adapter.subscribeEvents(ref, (event) => events.push(event));
  const transport = harness.transports.get("runtime-live");
  if (!transport) throw new Error("Expected the Codex transport.");
  const snapshot = () =>
    harness.adapter
      .listLiveSessionSnapshots("runtime-live")
      .find((candidate) => candidate.ref.externalSessionId === THREAD_ID);
  const emitGoal = async (goal: Parameters<typeof codexGoalFixture>[0] | null) => {
    stream.emitNotification(
      goal === null
        ? { method: "thread/goal/cleared", params: { threadId: THREAD_ID } }
        : {
            method: "thread/goal/updated",
            params: { threadId: THREAD_ID, turnId: null, goal: codexGoalFixture(goal) },
          },
    );
    await flushCodexAdapterWork();
  };
  const emitTurn = async (
    method: "turn/started" | "turn/completed",
    id: string,
    status: "inProgress" | "completed" | "failed" = method === "turn/started"
      ? "inProgress"
      : "completed",
  ) => {
    stream.emitNotification({
      method,
      params: { threadId: THREAD_ID, turn: codexTurnFixture({ id, status, items: [] }) },
    });
    await flushCodexAdapterWork();
  };
  return { ...harness, stream, events, ref, unsubscribe, transport, snapshot, emitGoal, emitTurn };
};

const goalCalls = (session: Awaited<ReturnType<typeof startGoalSession>>) =>
  session.transport.calls.filter(({ method }) => method.startsWith("thread/goal/"));

describe("CodexAppServerAdapter goals", () => {
  test("shows the goal that Codex reports, and removes a cleared goal", async () => {
    const session = await startGoalSession();
    try {
      await session.emitGoal({ status: "active" });
      expect(session.snapshot()?.goal).toEqual({
        objective: "Ship the release",
        status: "active",
      });
      await session.emitGoal({ status: "budgetLimited" });
      expect(session.snapshot()?.goal).toEqual({
        objective: "Ship the release",
        status: "limit_reached",
      });
      await session.emitGoal({ status: "blocked" });
      expect(session.snapshot()?.goal?.status).toBe("blocked");
      await session.emitGoal(null);
      expect(session.snapshot()).not.toHaveProperty("goal");
    } finally {
      session.unsubscribe();
    }
  });

  test("keeps the goal that Codex reports before a resumed session registers", async () => {
    const stream = createRuntimeStreamSubscription();
    const { adapter } = createHarness({ subscribeEvents: stream.subscribeEvents });
    await adapter.startSession(codexStartSessionInput());
    stream.emitNotification({
      method: "thread/goal/updated",
      params: {
        threadId: "thread-1",
        turnId: null,
        goal: codexGoalFixture({ threadId: "thread-1", status: "paused" }),
      },
    });
    await flushCodexAdapterWork();

    await adapter.resumeSession(codexSessionRuntimeRef("thread-1"));

    expect(
      adapter
        .listLiveSessionSnapshots("runtime-live")
        .find(({ ref }) => ref.externalSessionId === "thread-1")?.goal,
    ).toEqual({ objective: "Ship the release", status: "paused" });
  });

  test("keeps the session running between goal turns and ends it when the goal stops", async () => {
    const session = await startGoalSession();
    try {
      await session.emitGoal({ status: "active" });
      await session.emitTurn("turn/started", "goal-turn-1");
      // A goal turn that Codex starts is the running turn, so a new turn waits in the queue.
      await expect(
        session.adapter.sendUserMessage(
          codexUserMessageInput({ parts: [{ kind: "text", text: "Hello" }] }),
        ),
      ).rejects.toBeInstanceOf(AgentSessionTurnActiveError);
      const steered = await session.adapter.sendUserMessage(
        codexUserMessageInput({
          parts: [{ kind: "text", text: "Also fix CI" }],
          delivery: "steer",
        }),
      );

      await session.emitTurn("turn/completed", "goal-turn-1");
      expect(session.events.filter(({ type }) => type === "session_idle")).toEqual([]);
      expect(session.events.filter(({ type }) => type === "session_turn_finished")).toEqual([
        expect.objectContaining({
          completionId: "goal-turn-1",
          messageIds: [steered.messageId],
          turnOutcome: "completed",
        }),
      ]);
      expect(session.snapshot()).toMatchObject({
        activity: "running",
        foregroundTurnActive: false,
      });

      await session.emitTurn("turn/started", "goal-turn-2");
      expect(session.snapshot()?.activity).toBe("running");
      expect(session.snapshot()).not.toHaveProperty("foregroundTurnActive");
      await session.emitTurn("turn/completed", "goal-turn-2", "failed");
      expect(session.events.at(-1)).toMatchObject({
        type: "session_turn_finished",
        turnOutcome: "failed",
      });
      expect(session.events.some(({ type }) => type === "session_error")).toBe(true);

      await session.emitGoal({ status: "complete" });
      expect(session.snapshot()).toMatchObject({ activity: "idle", goal: { status: "complete" } });
      expect(session.snapshot()).not.toHaveProperty("foregroundTurnActive");
      expect(session.events.at(-1)).toMatchObject({ type: "session_idle" });
      expect(session.events.at(-1)).not.toHaveProperty("turnOutcome");
    } finally {
      session.unsubscribe();
    }
  });

  test("ends a turn without a goal as before", async () => {
    const session = await startGoalSession();
    try {
      await session.emitTurn("turn/started", "turn-1");
      await session.emitTurn("turn/completed", "turn-1");
      expect(session.events.filter(({ type }) => type === "session_turn_finished")).toEqual([]);
      expect(session.events.at(-1)).toMatchObject({
        type: "session_idle",
        turnOutcome: "completed",
      });
      expect(session.snapshot()?.activity).toBe("idle");
    } finally {
      session.unsubscribe();
    }
  });

  test("runs goal actions of the user with the native goal requests", async () => {
    const session = await startGoalSession();
    const onSent: string[] = [];
    try {
      const accepted = await session.adapter.controlGoal(
        { ...session.ref, command: { kind: "set", objective: "Fix the flaky tests" } },
        { onSent: () => onSent.push("set") },
      );
      expect(accepted).toEqual({ type: "command_accepted", commandName: "goal" });
      // Codex reports the goal on its event stream; until then the session reports running work.
      expect(session.snapshot()).not.toHaveProperty("goal");
      expect(session.snapshot()).toMatchObject({
        activity: "running",
        foregroundTurnActive: false,
      });

      await session.adapter.controlGoal({ ...session.ref, command: { kind: "pause" } });
      await session.adapter.controlGoal({ ...session.ref, command: { kind: "resume" } });
      await session.adapter.controlGoal({ ...session.ref, command: { kind: "clear" } });

      expect(onSent).toEqual(["set"]);
      expect(goalCalls(session)).toEqual([
        {
          method: "thread/goal/set",
          params: {
            threadId: THREAD_ID,
            origin: "user",
            status: "active",
            objective: "Fix the flaky tests",
          },
        },
        {
          method: "thread/goal/set",
          params: { threadId: THREAD_ID, origin: "user", status: "paused" },
        },
        {
          method: "thread/goal/set",
          params: { threadId: THREAD_ID, origin: "user", status: "active" },
        },
        { method: "thread/goal/clear", params: { threadId: THREAD_ID, origin: "user" } },
      ]);
    } finally {
      session.unsubscribe();
    }
  });

  test("fails a goal action with the reason of Codex", async () => {
    const session = await startGoalSession();
    session.transport.goalError = codexRpcError("goals feature is disabled");
    try {
      await expect(
        session.adapter.controlGoal({ ...session.ref, command: { kind: "pause" } }),
      ).rejects.toThrow("Codex could not pause the goal: goals feature is disabled");
      expect(session.snapshot()?.activity).toBe("idle");
    } finally {
      session.unsubscribe();
    }
  });

  test("pauses only an active goal before Stop, and a failed pause fails Stop", async () => {
    const session = await startGoalSession();
    try {
      await session.adapter.pauseGoalForStop(session.ref);
      expect(goalCalls(session)).toEqual([]);

      await session.emitGoal({ status: "active" });
      await session.adapter.pauseGoalForStop(session.ref);
      expect(goalCalls(session)).toEqual([
        {
          method: "thread/goal/set",
          params: { threadId: THREAD_ID, origin: "user", status: "paused" },
        },
      ]);

      session.transport.goalError = codexRpcError("goals feature is disabled");
      await expect(session.adapter.pauseGoalForStop(session.ref)).rejects.toThrow(
        "Codex could not pause the goal, so the session did not stop: goals feature is disabled",
      );
    } finally {
      session.unsubscribe();
    }
  });

  test("pauses a goal before Stop when Codex accepted it but has not reported it yet", async () => {
    const session = await startGoalSession();
    try {
      await session.adapter.controlGoal({
        ...session.ref,
        command: { kind: "set", objective: "Ship the release" },
      });
      await session.adapter.pauseGoalForStop(session.ref);
      expect(goalCalls(session).at(-1)).toEqual({
        method: "thread/goal/set",
        params: { threadId: THREAD_ID, origin: "user", status: "paused" },
      });
    } finally {
      session.unsubscribe();
    }
  });

  test("pauses a goal before Stop while Codex has not answered a Resume", async () => {
    const session = await startGoalSession();
    try {
      await session.emitGoal({ status: "paused" });
      session.transport.beforeGoalAnswer = async () => {
        session.transport.beforeGoalAnswer = null;
        await session.adapter.pauseGoalForStop(session.ref);
      };
      await session.adapter.controlGoal({ ...session.ref, command: { kind: "resume" } });

      expect(goalCalls(session).map(({ params }) => params)).toEqual([
        { threadId: THREAD_ID, origin: "user", status: "active" },
        { threadId: THREAD_ID, origin: "user", status: "paused" },
      ]);
    } finally {
      session.unsubscribe();
    }
  });

  test("does not wait for a goal turn when Codex reports the goal as not active first", async () => {
    const session = await startGoalSession();
    session.transport.beforeGoalAnswer = () => session.emitGoal({ status: "budgetLimited" });
    try {
      await session.adapter.controlGoal({ ...session.ref, command: { kind: "resume" } });
      expect(session.snapshot()).toMatchObject({
        activity: "idle",
        goal: { status: "limit_reached" },
      });
      session.transport.beforeGoalAnswer = null;
      await session.adapter.pauseGoalForStop(session.ref);
      expect(goalCalls(session)).toHaveLength(1);
    } finally {
      session.unsubscribe();
    }
  });

  test("ends the wait for a goal turn when the thread fails", async () => {
    const session = await startGoalSession();
    try {
      await session.emitGoal({ status: "active" });
      await session.emitTurn("turn/started", "goal-turn-1");
      await session.emitTurn("turn/completed", "goal-turn-1");
      expect(session.snapshot()?.activity).toBe("running");

      session.stream.emitNotification({
        method: "thread/status/changed",
        params: { threadId: THREAD_ID, status: { type: "systemError" } },
      });
      await flushCodexAdapterWork();

      expect(session.snapshot()?.activity).toBe("idle");
    } finally {
      session.unsubscribe();
    }
  });

  test("sets the goal of a launch after Codex starts the turn of the first message", async () => {
    const session = await startGoalSession();
    try {
      await session.adapter.sendUserMessage(
        codexUserMessageInput({ parts: [{ kind: "text", text: "Implement the task" }] }),
        { goal: { objective: "Implement task task-1" } },
      );
      const methods = session.transport.calls.map(({ method }) => method);
      expect(methods.slice(methods.indexOf("turn/start"))).toEqual([
        "turn/start",
        "thread/goal/set",
      ]);
      expect(goalCalls(session)[0]?.params).toEqual({
        threadId: THREAD_ID,
        origin: "user",
        status: "active",
        objective: "Implement task task-1",
      });

      session.transport.goalError = codexRpcError("goals feature is disabled");
      const sending = session.adapter.sendUserMessage(
        codexUserMessageInput({ parts: [{ kind: "text", text: "Again" }] }),
        { goal: { objective: "Implement task task-1" } },
      );
      await expect(sending).rejects.toBeInstanceOf(CodexMessageAcceptedError);
      await expect(sending).rejects.toMatchObject({
        acceptedMessage: { message: "Again" },
        message:
          "Codex could not set the goal: goals feature is disabled. Send /goal Implement task task-1 to set the goal.",
      });
    } finally {
      session.unsubscribe();
    }
  });
});

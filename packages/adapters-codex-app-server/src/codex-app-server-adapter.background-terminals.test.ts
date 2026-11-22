import { describe, expect, spyOn, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
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
import {
  codexAgentMessageItemFixture,
  codexCollabAgentToolCallFixture,
  codexCommandExecutionItemFixture,
} from "./test-fixtures/codex-protocol";
import type { AgentSessionLiveSnapshot } from "@openducktor/contracts";
import type { CodexAppServerAdapterOptions } from "./types";
import { CODEX_COMMAND_END_CONFIRMATION_LIMIT_MS } from "./codex-background-terminals";

const THREAD_ID = "thread/start-runtime-live";
const CHILD_ID = "child-thread";

const startSession = async (overrides: Partial<CodexAppServerAdapterOptions> = {}) => {
  const stream = createRuntimeStreamSubscription();
  // The host applies each delta to the snapshots that it has.
  const projected = new Map<string, AgentSessionLiveSnapshot>();
  const harness = createHarness({
    subscribeEvents: stream.subscribeEvents,
    readRuntimeVersion: () => "codex-cli 0.171.0",
    onLiveSessionMutation: (mutation) => {
      for (const snapshot of mutation.snapshots) {
        projected.set(snapshot.ref.externalSessionId, snapshot);
      }
    },
    ...overrides,
  });
  await harness.adapter.startSession(codexStartSessionInput());
  for (const snapshot of harness.adapter.listLiveSessionSnapshots("runtime-live")) {
    projected.set(snapshot.ref.externalSessionId, snapshot);
  }
  const expectDeltasMatchSnapshots = () => {
    for (const snapshot of harness.adapter.listLiveSessionSnapshots("runtime-live")) {
      expect(projected.get(snapshot.ref.externalSessionId)).toEqual(snapshot);
    }
  };
  const events: AgentEvent[] = [];
  const ref = codexSessionRuntimeRef();
  const unsubscribe = await harness.adapter.subscribeEvents(ref, (event) => events.push(event));
  const transport = harness.transports.get("runtime-live");
  if (!transport) throw new Error("Expected the Codex transport.");
  const snapshot = (threadId = THREAD_ID) =>
    harness.adapter
      .listLiveSessionSnapshots("runtime-live")
      .find((candidate) => candidate.ref.externalSessionId === threadId);
  const emit = async (message: Parameters<typeof stream.emitNotification>[0]) => {
    stream.emitNotification(message);
    await flushCodexAdapterWork();
  };
  const turnMessage = (
    method: "turn/started" | "turn/completed",
    id: string,
    threadId = THREAD_ID,
  ) => ({
    method,
    params: {
      threadId,
      turn: codexTurnFixture({
        id,
        status: method === "turn/started" ? "inProgress" : "completed",
        items: [],
      }),
    },
  });
  const commandStartMessage = (
    itemId: string,
    turnId: string,
    threadId = THREAD_ID,
    processId: string | null = `${itemId}-process`,
  ) => ({
    method: "item/started",
    params: {
      threadId,
      turnId,
      startedAtMs: Date.now(),
      item: codexCommandExecutionItemFixture({
        id: itemId,
        command: `bun run ${itemId}`,
        processId,
        status: "inProgress",
        exitCode: null,
        aggregatedOutput: null,
      }),
    },
  });
  const commandEndMessage = (itemId: string, turnId: string, threadId = THREAD_ID) => ({
    method: "item/completed",
    params: {
      threadId,
      turnId,
      completedAtMs: Date.now(),
      item: codexCommandExecutionItemFixture({
        id: itemId,
        command: `bun run ${itemId}`,
        processId: `${itemId}-process`,
        status: "completed",
      }),
    },
  });
  const emitTurn = (method: "turn/started" | "turn/completed", id: string, threadId = THREAD_ID) =>
    emit(turnMessage(method, id, threadId));
  const startCommand = (itemId: string, turnId: string, threadId = THREAD_ID) =>
    emit(commandStartMessage(itemId, turnId, threadId));
  const completeCommand = (itemId: string, turnId: string, threadId = THREAD_ID) =>
    emit(commandEndMessage(itemId, turnId, threadId));
  const emitThreadIdle = (threadId = THREAD_ID) =>
    emit({ method: "thread/status/changed", params: { threadId, status: { type: "idle" } } });
  const spawnChild = () =>
    emit({
      method: "item/completed",
      params: {
        threadId: THREAD_ID,
        turnId: "turn-1",
        completedAtMs: Date.now(),
        item: codexCollabAgentToolCallFixture({
          id: "spawn",
          senderThreadId: THREAD_ID,
          tool: "spawnAgent",
          status: "completed",
          receiverThreadIds: [CHILD_ID],
          agentsStates: { [CHILD_ID]: { status: "running", message: null } },
        }),
      },
    });
  return {
    ...harness,
    stream,
    events,
    ref,
    unsubscribe,
    transport,
    snapshot,
    emit,
    turnMessage,
    commandStartMessage,
    commandEndMessage,
    emitTurn,
    startCommand,
    completeCommand,
    emitThreadIdle,
    spawnChild,
    expectDeltasMatchSnapshots,
  };
};

const idleEvents = (events: AgentEvent[]) => events.filter(({ type }) => type === "session_idle");
const turnFinishedEvents = (events: AgentEvent[]) =>
  events.filter(({ type }) => type === "session_turn_finished");

/** Lets a test run the timeouts of one delay early. Other timeouts run natively. */
const holdTimeouts = (delay: number) => {
  const held: Array<() => void> = [];
  const nativeSetTimeout = globalThis.setTimeout;
  const spy = spyOn(globalThis, "setTimeout").mockImplementation(
    // SAFETY: the replacement takes the arguments of the native setTimeout and returns its timer.
    ((callback: () => void, timerDelay?: number) => {
      if (timerDelay === delay) held.push(callback);
      return nativeSetTimeout(callback, timerDelay);
    }) as typeof setTimeout,
  );
  return { held, restore: () => spy.mockRestore() };
};

const failureOf = (promise: Promise<void>): Promise<Error | null> =>
  promise.then(
    () => null,
    (error: Error) => error,
  );

/** The tracking loss of the parent after the release of a child that runs `bun run dev`. */
const LOST_CHILD_DEV = `OpenDucktor stopped following the Codex session '${CHILD_ID}' before Codex confirmed that these background commands ended: 'bun run dev'. The commands may still run, so the status of the parent sessions is unavailable. Check their processes, then restart the runtime.`;

const devServerTask = (threadId = THREAD_ID) => ({
  taskId: `${threadId}:dev`,
  kind: "command",
  title: "bun run dev",
  stop: { allowed: true },
});

describe("CodexAppServerAdapter background terminals", () => {
  test("keeps the session running while a terminal runs after its turn, and ends it with the terminal", async () => {
    const session = await startSession();
    try {
      await session.emitTurn("turn/started", "turn-1");
      await session.startCommand("dev", "turn-1");
      await session.startCommand("lint", "turn-1");
      await session.completeCommand("lint", "turn-1");
      // A running command joins the list only when its turn ends.
      expect(session.snapshot()).not.toHaveProperty("backgroundTasks");

      // Codex reports the idle thread before the turn end.
      await session.emitThreadIdle();
      await session.emitTurn("turn/completed", "turn-1");

      expect(idleEvents(session.events)).toEqual([]);
      expect(session.events.filter(({ type }) => type === "session_turn_finished")).toEqual([
        expect.objectContaining({ completionId: "turn-1", turnOutcome: "completed" }),
      ]);
      expect(session.snapshot()).toMatchObject({
        activity: "running",
        foregroundTurnActive: false,
        backgroundTasks: [devServerTask()],
      });
      session.expectDeltasMatchSnapshots();

      // A new reply runs in front of the terminal, which stays in the list.
      await session.emitTurn("turn/started", "turn-2");
      expect(session.snapshot()).not.toHaveProperty("foregroundTurnActive");
      expect(session.snapshot()?.backgroundTasks).toEqual([devServerTask()]);
      await session.emitTurn("turn/completed", "turn-2");
      expect(idleEvents(session.events)).toEqual([]);
      expect(session.snapshot()?.foregroundTurnActive).toBe(false);

      await session.completeCommand("dev", "turn-1");

      expect(idleEvents(session.events)).toHaveLength(1);
      expect(session.events.at(-1)).toMatchObject({ type: "session_idle" });
      expect(session.events.at(-1)).not.toHaveProperty("turnOutcome");
      expect(session.snapshot()?.activity).toBe("idle");
      expect(session.snapshot()).not.toHaveProperty("backgroundTasks");
      expect(session.snapshot()).not.toHaveProperty("foregroundTurnActive");
      session.expectDeltasMatchSnapshots();
    } finally {
      session.unsubscribe();
    }
  });

  test("keeps a Background session running when a new turn ends at its start", async () => {
    const session = await startSession();
    try {
      await session.emitTurn("turn/started", "turn-1");
      await session.startCommand("dev", "turn-1");
      await session.emitTurn("turn/completed", "turn-1");

      // The harness answers `turn/start` with a turn that already completed.
      await session.adapter.sendUserMessage(
        codexUserMessageInput({ parts: [{ kind: "text", text: "Status?" }] }),
      );
      await flushCodexAdapterWork();

      expect(idleEvents(session.events)).toEqual([]);
      expect(session.snapshot()).toMatchObject({
        activity: "running",
        backgroundTasks: [devServerTask()],
      });

      await session.completeCommand("dev", "turn-1");
      expect(idleEvents(session.events)).toHaveLength(1);
    } finally {
      session.unsubscribe();
    }
  });

  test("lists the terminal of a child thread on the parent until it ends", async () => {
    const session = await startSession();
    try {
      await session.emitTurn("turn/started", "turn-1");
      await session.spawnChild();
      await session.emitTurn("turn/started", "child-turn", CHILD_ID);
      await session.startCommand("dev", "child-turn", CHILD_ID);
      await session.emitTurn("turn/completed", "child-turn", CHILD_ID);

      expect(session.snapshot(CHILD_ID)).toMatchObject({
        activity: "running",
        foregroundTurnActive: false,
        backgroundTasks: [devServerTask(CHILD_ID)],
      });
      expect(session.snapshot()?.backgroundTasks).toEqual([devServerTask(CHILD_ID)]);
      session.expectDeltasMatchSnapshots();

      await session.emitThreadIdle();
      await session.emitTurn("turn/completed", "turn-1");
      expect(idleEvents(session.events)).toEqual([]);
      expect(session.snapshot()).toMatchObject({
        activity: "running",
        foregroundTurnActive: false,
      });

      await session.completeCommand("dev", "child-turn", CHILD_ID);

      expect(session.events.at(-1)).toMatchObject({
        type: "session_idle",
        externalSessionId: THREAD_ID,
      });
      expect(session.snapshot()?.activity).toBe("idle");
      expect(session.snapshot()).not.toHaveProperty("backgroundTasks");
      expect(session.snapshot(CHILD_ID)).not.toHaveProperty("backgroundTasks");
      expect(session.snapshot(CHILD_ID)).not.toHaveProperty("foregroundTurnActive");
      session.expectDeltasMatchSnapshots();
    } finally {
      session.unsubscribe();
    }
  });

  test("holds an idle parent while the terminal of its child runs", async () => {
    const session = await startSession();
    try {
      await session.emitTurn("turn/started", "turn-1");
      await session.spawnChild();
      await session.emitThreadIdle();
      await session.emitTurn("turn/completed", "turn-1");
      expect(idleEvents(session.events)).toEqual([
        expect.objectContaining({ externalSessionId: THREAD_ID, turnOutcome: "completed" }),
      ]);
      expect(session.snapshot()?.activity).toBe("idle");

      await session.emitTurn("turn/started", "child-turn", CHILD_ID);
      await session.startCommand("dev", "child-turn", CHILD_ID);
      await session.emitTurn("turn/completed", "child-turn", CHILD_ID);

      expect(session.snapshot()).toMatchObject({
        activity: "running",
        foregroundTurnActive: false,
        backgroundTasks: [devServerTask(CHILD_ID)],
      });
      session.expectDeltasMatchSnapshots();

      await session.completeCommand("dev", "child-turn", CHILD_ID);

      const parentIdleEvents = idleEvents(session.events).filter(
        ({ externalSessionId }) => externalSessionId === THREAD_ID,
      );
      expect(parentIdleEvents).toHaveLength(2);
      expect(parentIdleEvents.at(-1)).not.toHaveProperty("turnOutcome");
      expect(session.snapshot()?.activity).toBe("idle");
      expect(session.snapshot()).not.toHaveProperty("foregroundTurnActive");
      expect(session.snapshot()).not.toHaveProperty("backgroundTasks");
      session.expectDeltasMatchSnapshots();
    } finally {
      session.unsubscribe();
    }
  });

  test("goes idle once after the final reply when the last terminal ends before the turn end", async () => {
    const session = await startSession();
    try {
      await session.emitTurn("turn/started", "turn-1");
      await session.startCommand("dev", "turn-1");
      await session.emit({
        method: "item/completed",
        params: {
          threadId: THREAD_ID,
          turnId: "turn-1",
          completedAtMs: Date.now(),
          item: codexAgentMessageItemFixture({ id: "answer", text: "The server runs." }),
        },
      });
      await session.emitThreadIdle();
      await session.completeCommand("dev", "turn-1");
      expect(idleEvents(session.events)).toEqual([]);
      expect(session.snapshot()?.activity).toBe("running");

      await session.emit({
        method: "turn/completed",
        params: {
          threadId: THREAD_ID,
          turn: codexTurnFixture({ id: "turn-1", status: "completed", items: [], durationMs: 10 }),
        },
      });

      const types = session.events.map(({ type }) => type);
      expect(types.indexOf("assistant_message")).toBeGreaterThan(-1);
      expect(types.indexOf("assistant_message")).toBeLessThan(types.indexOf("session_idle"));
      expect(idleEvents(session.events)).toEqual([
        expect.objectContaining({ turnOutcome: "completed" }),
      ]);
      expect(turnFinishedEvents(session.events)).toEqual([]);
      expect(session.snapshot()?.activity).toBe("idle");
      session.expectDeltasMatchSnapshots();
    } finally {
      session.unsubscribe();
    }
  });

  test("keeps the session running when an older turn ends after a newer turn started", async () => {
    const session = await startSession();
    try {
      await session.emitTurn("turn/started", "turn-1");
      await session.startCommand("dev", "turn-1");
      await session.emitThreadIdle();
      await session.emitTurn("turn/started", "turn-2");
      await session.emitTurn("turn/completed", "turn-1");

      expect(idleEvents(session.events)).toEqual([]);
      expect(turnFinishedEvents(session.events)).toEqual([]);
      expect(session.snapshot()).toMatchObject({
        activity: "running",
        backgroundTasks: [devServerTask()],
      });
      expect(session.snapshot()).not.toHaveProperty("foregroundTurnActive");

      await session.emitTurn("turn/completed", "turn-2");
      expect(idleEvents(session.events)).toEqual([]);
      expect(turnFinishedEvents(session.events)).toEqual([
        expect.objectContaining({ completionId: "turn-2", turnOutcome: "completed" }),
      ]);
      expect(session.snapshot()?.foregroundTurnActive).toBe(false);

      await session.completeCommand("dev", "turn-1");
      expect(idleEvents(session.events)).toHaveLength(1);
      expect(session.snapshot()?.activity).toBe("idle");
      session.expectDeltasMatchSnapshots();
    } finally {
      session.unsubscribe();
    }
  });

  test("keeps a goal session running between goal turns, and holds it on its terminal after the goal", async () => {
    const session = await startSession();
    try {
      await session.emit({
        method: "thread/goal/updated",
        params: { threadId: THREAD_ID, turnId: null, goal: codexGoalFixture({ status: "active" }) },
      });
      await session.emitTurn("turn/started", "goal-turn-1");
      await session.startCommand("dev", "goal-turn-1");
      await session.emitTurn("turn/completed", "goal-turn-1");
      expect(session.snapshot()).toMatchObject({
        activity: "running",
        foregroundTurnActive: false,
        goal: { status: "active" },
        backgroundTasks: [devServerTask()],
      });

      await session.emit({
        method: "thread/goal/updated",
        params: {
          threadId: THREAD_ID,
          turnId: null,
          goal: codexGoalFixture({ status: "complete" }),
        },
      });
      expect(idleEvents(session.events)).toEqual([]);
      expect(session.snapshot()).toMatchObject({
        activity: "running",
        foregroundTurnActive: false,
      });

      await session.completeCommand("dev", "goal-turn-1");
      expect(idleEvents(session.events)).toHaveLength(1);
      expect(session.snapshot()?.activity).toBe("idle");
    } finally {
      session.unsubscribe();
    }
  });

  test("offers Stop only on a known Codex version that can terminate a terminal", async () => {
    const tooOld =
      "Codex 0.139.2 cannot stop a background terminal. Update Codex to 0.140.0 or later.";
    const unknown =
      "OpenDucktor cannot read the Codex version. Stopping a background terminal needs Codex 0.140.0 or later.";
    const versions: Array<[string | null, string | null]> = [
      ["0.140.0", null],
      ["codex-cli 0.139.2", tooOld],
      [null, unknown],
    ];
    for (const [version, reason] of versions) {
      const session = await startSession({ readRuntimeVersion: () => version });
      try {
        await session.emitTurn("turn/started", "turn-1");
        await session.startCommand("dev", "turn-1");
        await session.emitTurn("turn/completed", "turn-1");
        expect(session.snapshot()?.backgroundTasks?.[0]?.stop).toEqual(
          reason === null ? { allowed: true } : { allowed: false, reason },
        );
        if (reason === null) continue;

        await expect(
          session.adapter.stopBackgroundTask({ ...session.ref, taskId: `${THREAD_ID}:dev` }),
        ).rejects.toThrow(reason);
        expect(session.transport.calls.map(({ method }) => method)).not.toContain(
          "thread/backgroundTerminals/terminate",
        );
      } finally {
        session.unsubscribe();
      }
    }
  });

  test("stops one terminal of the session tree, and treats an ended terminal as stopped", async () => {
    const session = await startSession();
    const taskRef = { ...session.ref, taskId: `${THREAD_ID}:dev` };
    const terminateCalls = () =>
      session.transport.calls.filter(
        ({ method }) => method === "thread/backgroundTerminals/terminate",
      );
    try {
      await session.emitTurn("turn/started", "turn-1");
      await session.startCommand("dev", "turn-1");
      await session.emitTurn("turn/completed", "turn-1");

      // A task outside the tree of the ref needs no runtime call.
      await session.adapter.stopBackgroundTask({ ...session.ref, taskId: "other:dev" });
      expect(terminateCalls()).toEqual([]);

      await session.adapter.stopBackgroundTask(taskRef);
      expect(terminateCalls()).toEqual([
        {
          method: "thread/backgroundTerminals/terminate",
          params: { threadId: THREAD_ID, processId: "dev-process" },
        },
      ]);

      session.transport.terminateBackgroundTerminal = async () => ({ terminated: false });
      await expect(session.adapter.stopBackgroundTask(taskRef)).rejects.toThrow(
        "Codex did not stop the background command 'bun run dev'. The command still runs.",
      );

      session.transport.terminateBackgroundTerminal = async () => {
        throw codexRpcError("thread not loaded");
      };
      await expect(session.adapter.stopBackgroundTask(taskRef)).rejects.toThrow(
        "Codex could not stop the background command 'bun run dev': Codex app-server request failed for runtime runtime-live: thread not loaded",
      );

      // Codex ends the command before it answers.
      session.transport.terminateBackgroundTerminal = async () => {
        await session.completeCommand("dev", "turn-1");
        throw codexRpcError("process ended");
      };
      await session.adapter.stopBackgroundTask(taskRef);
      expect(session.snapshot()).not.toHaveProperty("backgroundTasks");
    } finally {
      session.unsubscribe();
    }
  });

  test("tracks a command that an approval started without a process ID, and stops it with the listed process", async () => {
    const session = await startSession();
    const taskRef = { ...session.ref, taskId: `${THREAD_ID}:dev` };
    try {
      await session.emitTurn("turn/started", "turn-1");
      // Codex sends the start of an approved command at the approval, with no process ID.
      await session.emit(session.commandStartMessage("dev", "turn-1", THREAD_ID, null));
      await session.emitTurn("turn/completed", "turn-1");
      expect(session.snapshot()?.backgroundTasks?.map(({ taskId }) => taskId)).toEqual([
        `${THREAD_ID}:dev`,
      ]);

      session.transport.listBackgroundTerminals = async (cursor) =>
        cursor === null
          ? {
              data: [{ itemId: "other", processId: "other-process", command: "x" }],
              nextCursor: "2",
            }
          : {
              data: [{ itemId: "dev", processId: "approved-process", command: "x" }],
              nextCursor: null,
            };
      await session.adapter.stopBackgroundTask(taskRef);
      expect(
        session.transport.calls.filter(
          ({ method }) => method === "thread/backgroundTerminals/terminate",
        ),
      ).toEqual([
        {
          method: "thread/backgroundTerminals/terminate",
          params: { threadId: THREAD_ID, processId: "approved-process" },
        },
      ]);

      session.transport.listBackgroundTerminals = async () => ({ data: [], nextCursor: null });
      await expect(session.adapter.stopBackgroundTask(taskRef)).rejects.toThrow(
        "Codex could not stop the background command 'bun run dev': Codex lists no running terminal for the command 'bun run dev'.",
      );
    } finally {
      session.unsubscribe();
    }
  });

  test("ends the terminals of every thread on Stop session, and keeps the session when Codex fails", async () => {
    const session = await startSession();
    const cleanCalls = () =>
      session.transport.calls.filter(({ method }) => method === "thread/backgroundTerminals/clean");
    try {
      await session.emitTurn("turn/started", "turn-1");
      await session.startCommand("dev", "turn-1");
      await session.emitTurn("turn/completed", "turn-1");

      session.transport.cleanBackgroundTerminalsError = codexRpcError("clean failed");
      await expect(session.adapter.stopSession(session.ref)).rejects.toThrow(
        `Codex could not stop the background terminals of session '${THREAD_ID}': Codex app-server request failed for runtime runtime-live: clean failed`,
      );
      expect(session.snapshot()?.backgroundTasks).toEqual([devServerTask()]);

      session.transport.cleanBackgroundTerminalsError = null;
      let stopped = false;
      const stopping = session.adapter.stopSession(session.ref).then(() => {
        stopped = true;
      });
      await flushCodexAdapterWork();
      expect(cleanCalls().at(-1)).toEqual({
        method: "thread/backgroundTerminals/clean",
        params: { threadId: THREAD_ID },
      });
      // Codex answers `clean` before the process ends, so the terminal stays until its end.
      expect(stopped).toBe(false);
      expect(session.snapshot()?.backgroundTasks).toEqual([devServerTask()]);

      await session.completeCommand("dev", "turn-1");
      await stopping;
      expect(session.snapshot()).toBeUndefined();
    } finally {
      session.unsubscribe();
    }
  });

  test("ends on Stop session a child terminal that starts while Stop waits for the root terminal", async () => {
    const session = await startSession();
    const cleanedThreads = () =>
      session.transport.calls
        .filter(({ method }) => method === "thread/backgroundTerminals/clean")
        .map(({ params }) => params);
    try {
      await session.emitTurn("turn/started", "turn-1");
      await session.spawnChild();
      await session.emitTurn("turn/started", "child-turn", CHILD_ID);
      await session.startCommand("dev", "turn-1");
      await session.emitTurn("turn/completed", "turn-1");

      let stopped = false;
      const stopping = session.adapter.stopSession(session.ref).then(() => {
        stopped = true;
      });
      await flushCodexAdapterWork();
      expect(cleanedThreads()).toEqual([{ threadId: THREAD_ID }]);

      await session.startCommand("worker", "child-turn", CHILD_ID);
      await session.emitTurn("turn/completed", "child-turn", CHILD_ID);
      await session.completeCommand("dev", "turn-1");

      expect(stopped).toBe(false);
      expect(cleanedThreads()).toEqual([{ threadId: THREAD_ID }, { threadId: CHILD_ID }]);
      expect(session.snapshot()?.backgroundTasks).toEqual([
        { ...devServerTask(CHILD_ID), taskId: `${CHILD_ID}:worker`, title: "bun run worker" },
      ]);

      await session.completeCommand("worker", "child-turn", CHILD_ID);
      await stopping;
      expect(session.snapshot()).toBeUndefined();
    } finally {
      session.unsubscribe();
    }
  });

  test("ends on Stop session a child terminal that starts in the batch of the root terminal end", async () => {
    const session = await startSession();
    const cleanedThreads = () =>
      session.transport.calls
        .filter(({ method }) => method === "thread/backgroundTerminals/clean")
        .map(({ params }) => params);
    try {
      await session.emitTurn("turn/started", "turn-1");
      await session.spawnChild();
      await session.emitTurn("turn/started", "child-turn", CHILD_ID);
      await session.startCommand("dev", "turn-1");
      await session.emitTurn("turn/completed", "turn-1");

      let stopped = false;
      const stopping = session.adapter.stopSession(session.ref).then(() => {
        stopped = true;
      });
      await flushCodexAdapterWork();
      expect(cleanedThreads()).toEqual([{ threadId: THREAD_ID }]);

      // Codex can write these lines in one stdout chunk, so they reach the adapter in one batch.
      session.stream.emitNotification(session.commandEndMessage("dev", "turn-1"));
      session.stream.emitNotification(
        session.commandStartMessage("worker", "child-turn", CHILD_ID),
      );
      session.stream.emitNotification(
        session.turnMessage("turn/completed", "child-turn", CHILD_ID),
      );
      await flushCodexAdapterWork();

      expect(stopped).toBe(false);
      expect(cleanedThreads()).toEqual([{ threadId: THREAD_ID }, { threadId: CHILD_ID }]);
      expect(session.snapshot()?.backgroundTasks).toEqual([
        { ...devServerTask(CHILD_ID), taskId: `${CHILD_ID}:worker`, title: "bun run worker" },
      ]);

      await session.completeCommand("worker", "child-turn", CHILD_ID);
      await stopping;
      expect(session.snapshot()).toBeUndefined();
    } finally {
      session.unsubscribe();
    }
  });

  test("fails Stop session and keeps the commands when the tree starts commands in each stop round", async () => {
    const session = await startSession();
    try {
      await session.emitTurn("turn/started", "turn-1");
      await session.spawnChild();
      await session.emitTurn("turn/started", "child-turn", CHILD_ID);
      await session.startCommand("dev", "turn-1");
      await session.emitTurn("turn/completed", "turn-1");

      const stopping = failureOf(session.adapter.stopSession(session.ref));
      await flushCodexAdapterWork();
      await session.startCommand("c1", "child-turn", CHILD_ID);
      await session.completeCommand("dev", "turn-1");
      await session.startCommand("c2", "child-turn", CHILD_ID);
      await session.completeCommand("c1", "child-turn", CHILD_ID);
      await session.startCommand("c3", "child-turn", CHILD_ID);
      await session.emitTurn("turn/completed", "child-turn", CHILD_ID);
      await session.completeCommand("c2", "child-turn", CHILD_ID);
      const failure = await stopping;

      expect(failure).toBeInstanceOf(Error);
      expect(failure?.message).toBe(
        "The Codex session started background commands again after 3 stop rounds: 'bun run c3'. The session keeps them. Stop the subagents or the commands that still run, then stop the session again.",
      );
      expect(
        session.transport.calls
          .filter(({ method }) => method === "thread/backgroundTerminals/clean")
          .map(({ params }) => params),
      ).toEqual([{ threadId: THREAD_ID }, { threadId: CHILD_ID }, { threadId: CHILD_ID }]);
      expect(session.snapshot()?.backgroundTasks).toEqual([
        { ...devServerTask(CHILD_ID), taskId: `${CHILD_ID}:c3`, title: "bun run c3" },
      ]);
    } finally {
      session.unsubscribe();
    }
  });

  test("fails Stop session when the runtime ends before Codex confirms the terminal end", async () => {
    const session = await startSession();
    try {
      await session.emitTurn("turn/started", "turn-1");
      await session.startCommand("dev", "turn-1");
      await session.emitTurn("turn/completed", "turn-1");

      const stopping = session.adapter.stopSession(session.ref);
      await flushCodexAdapterWork();
      session.adapter.releaseRuntime("runtime-live");

      await expect(stopping).rejects.toThrow(
        "OpenDucktor stopped following the Codex session before Codex confirmed that these background commands ended: 'bun run dev'. The commands may still run. Check their processes.",
      );
    } finally {
      session.unsubscribe();
    }
  });

  test("fails Stop session when the session is released before Stop reads its commands", async () => {
    const session = await startSession();
    try {
      await session.emitTurn("turn/started", "turn-1");
      await session.startCommand("dev", "turn-1");
      await session.emitTurn("turn/completed", "turn-1");

      const stopping = failureOf(session.adapter.stopSession(session.ref));
      const releasing = session.adapter.releaseSession(session.ref);
      const failure = await stopping;
      await releasing;

      expect(failure).toBeInstanceOf(Error);
      expect(failure?.message).toBe(
        "OpenDucktor stopped following the Codex session before Codex confirmed that these background commands ended: 'bun run dev'. The commands may still run. Check their processes.",
      );
      expect(session.transport.calls.map(({ method }) => method)).not.toContain(
        "thread/backgroundTerminals/clean",
      );
    } finally {
      session.unsubscribe();
    }
  });

  test("fails Stop session when a child is released before Stop reads the commands of the tree", async () => {
    const session = await startSession();
    const childRef = codexSessionRuntimeRef(CHILD_ID);
    try {
      await session.emitTurn("turn/started", "turn-1");
      await session.spawnChild();
      await session.adapter.resumeSession(childRef);
      await session.emitTurn("turn/started", "child-turn", CHILD_ID);
      await session.startCommand("dev", "child-turn", CHILD_ID);
      await session.emitTurn("turn/completed", "child-turn", CHILD_ID);
      expect(session.snapshot()?.backgroundTasks).toEqual([devServerTask(CHILD_ID)]);

      const stopping = failureOf(session.adapter.stopSession(session.ref));
      const releasing = session.adapter.releaseSession(childRef);
      const failure = await stopping;
      await releasing;

      expect(failure?.message).toBe(LOST_CHILD_DEV);
      expect(session.transport.calls.map(({ method }) => method)).not.toContain(
        "thread/backgroundTerminals/clean",
      );
      expect(session.snapshot()).toBeDefined();
    } finally {
      session.unsubscribe();
    }
  });

  test("keeps a child terminal lost for the parent across Stop retries after a release during Stop", async () => {
    const session = await startSession();
    const childRef = codexSessionRuntimeRef(CHILD_ID);
    const cleanCalls = () =>
      session.transport.calls.filter(({ method }) => method === "thread/backgroundTerminals/clean");
    try {
      await session.emitTurn("turn/started", "turn-1");
      await session.spawnChild();
      await session.adapter.resumeSession(childRef);
      await session.emitTurn("turn/started", "child-turn", CHILD_ID);
      await session.startCommand("dev", "child-turn", CHILD_ID);
      await session.emitTurn("turn/completed", "child-turn", CHILD_ID);
      // The child is released while Stop waits for Codex to confirm the end of its terminal.
      session.transport.beforeCleanAnswer = async () => {
        session.transport.beforeCleanAnswer = null;
        await session.adapter.releaseSession(childRef);
      };

      const first = await failureOf(session.adapter.stopSession(session.ref));
      expect(first?.message).toBe(
        "OpenDucktor stopped following the Codex session before Codex confirmed that these background commands ended: 'bun run dev'. The commands may still run. Check their processes.",
      );
      expect(cleanCalls()).toHaveLength(1);
      expect(session.snapshot()).toMatchObject({ statusUnavailableReason: LOST_CHILD_DEV });
      expect(session.snapshot()).not.toHaveProperty("backgroundTasks");

      const retry = await failureOf(session.adapter.stopSession(session.ref));
      expect(retry?.message).toBe(LOST_CHILD_DEV);
      const taskRetry = await failureOf(
        session.adapter.stopBackgroundTask({ ...session.ref, taskId: `${CHILD_ID}:dev` }),
      );
      expect(taskRetry?.message).toBe(LOST_CHILD_DEV);
      expect(cleanCalls()).toHaveLength(1);
      expect(session.snapshot()).toMatchObject({ statusUnavailableReason: LOST_CHILD_DEV });
    } finally {
      session.unsubscribe();
    }
  });

  test("keeps a released grandchild terminal lost for the root when the intermediate child is released", async () => {
    const session = await startSession();
    const GRANDCHILD_ID = "grandchild-thread";
    const childRef = codexSessionRuntimeRef(CHILD_ID);
    const grandchildRef = codexSessionRuntimeRef(GRANDCHILD_ID);
    const lost = `OpenDucktor stopped following the Codex session '${GRANDCHILD_ID}' before Codex confirmed that these background commands ended: 'bun run dev'. The commands may still run, so the status of the parent sessions is unavailable. Check their processes, then restart the runtime.`;
    const cleanCalls = () =>
      session.transport.calls.filter(({ method }) => method === "thread/backgroundTerminals/clean");
    try {
      await session.emitTurn("turn/started", "turn-1");
      await session.spawnChild();
      await session.adapter.resumeSession(childRef);
      await session.emitTurn("turn/started", "child-turn", CHILD_ID);
      await session.emit({
        method: "item/completed",
        params: {
          threadId: CHILD_ID,
          turnId: "child-turn",
          completedAtMs: Date.now(),
          item: codexCollabAgentToolCallFixture({
            id: "spawn-grandchild",
            senderThreadId: CHILD_ID,
            tool: "spawnAgent",
            status: "completed",
            receiverThreadIds: [GRANDCHILD_ID],
            agentsStates: { [GRANDCHILD_ID]: { status: "running", message: null } },
          }),
        },
      });
      await session.adapter.resumeSession(grandchildRef);
      await session.emitTurn("turn/started", "grandchild-turn", GRANDCHILD_ID);
      await session.startCommand("dev", "grandchild-turn", GRANDCHILD_ID);
      await session.emitTurn("turn/completed", "grandchild-turn", GRANDCHILD_ID);
      expect(session.snapshot()?.backgroundTasks).toEqual([devServerTask(GRANDCHILD_ID)]);

      await session.adapter.releaseSession(grandchildRef);
      expect(session.snapshot()).toMatchObject({ statusUnavailableReason: lost });
      const first = await failureOf(session.adapter.stopSession(session.ref));
      expect(first?.message).toBe(lost);

      await session.adapter.releaseSession(childRef);
      expect(session.snapshot()).toMatchObject({ statusUnavailableReason: lost });
      const retry = await failureOf(session.adapter.stopSession(session.ref));
      expect(retry?.message).toBe(lost);
      expect(cleanCalls()).toEqual([]);
      expect(session.snapshot()).toMatchObject({ statusUnavailableReason: lost });
    } finally {
      session.unsubscribe();
    }
  });

  test("fails a one-task stop when the child is released and Codex fails the terminate request", async () => {
    const session = await startSession();
    const childRef = codexSessionRuntimeRef(CHILD_ID);
    try {
      await session.emitTurn("turn/started", "turn-1");
      await session.spawnChild();
      await session.adapter.resumeSession(childRef);
      await session.emitTurn("turn/started", "child-turn", CHILD_ID);
      await session.startCommand("dev", "child-turn", CHILD_ID);
      await session.emitTurn("turn/completed", "child-turn", CHILD_ID);
      session.transport.terminateBackgroundTerminal = async () => {
        await session.adapter.releaseSession(childRef);
        throw codexRpcError("terminate failed");
      };

      const failure = await failureOf(
        session.adapter.stopBackgroundTask({ ...session.ref, taskId: `${CHILD_ID}:dev` }),
      );

      expect(failure?.message).toBe(
        "Codex could not stop the background command 'bun run dev': Codex app-server request failed for runtime runtime-live: terminate failed",
      );
      expect(session.snapshot()).toMatchObject({ statusUnavailableReason: LOST_CHILD_DEV });
      const retry = await failureOf(
        session.adapter.stopBackgroundTask({ ...session.ref, taskId: `${CHILD_ID}:dev` }),
      );
      expect(retry?.message).toBe(LOST_CHILD_DEV);
    } finally {
      session.unsubscribe();
    }
  });

  test("fails Stop session when the runtime ends while Codex answers the clean request", async () => {
    const session = await startSession();
    try {
      await session.emitTurn("turn/started", "turn-1");
      await session.startCommand("dev", "turn-1");
      await session.emitTurn("turn/completed", "turn-1");
      // Codex answers `clean` without a command end, because the runtime ended first.
      session.transport.beforeCleanAnswer = async () => {
        session.adapter.releaseRuntime("runtime-live");
      };

      const failure = await failureOf(session.adapter.stopSession(session.ref));

      expect(failure).toBeInstanceOf(Error);
      expect(failure?.message).toBe(
        "OpenDucktor stopped following the Codex session before Codex confirmed that these background commands ended: 'bun run dev'. The commands may still run. Check their processes.",
      );
    } finally {
      session.unsubscribe();
    }
  });

  test("fails Stop session and keeps the terminal when a command event of its thread cannot be read", async () => {
    const session = await startSession();
    try {
      await session.emitTurn("turn/started", "turn-1");
      await session.startCommand("dev", "turn-1");
      await session.emitTurn("turn/completed", "turn-1");

      const stopping = failureOf(session.adapter.stopSession(session.ref));
      await flushCodexAdapterWork();
      // A command end that fails validation, here by its fractional time, can be the end of the
      // stopped terminal.
      await session.emit({
        method: "item/completed",
        params: {
          threadId: THREAD_ID,
          turnId: "turn-1",
          completedAtMs: 1.5,
          item: codexCommandExecutionItemFixture({
            id: "dev",
            command: "bun run dev",
            processId: "dev-process",
            status: "completed",
          }),
        },
      });
      const failure = await stopping;

      expect(failure).toBeInstanceOf(Error);
      expect(failure?.message).toStartWith("OpenDucktor could not read a Codex event (");
      expect(failure?.message).toEndWith(
        "), so it cannot confirm that these background commands ended: 'bun run dev'. The commands may still run, so the session keeps them. Check their processes, then retry Stop or restart the runtime.",
      );
      expect(session.snapshot()?.backgroundTasks).toEqual([devServerTask()]);
    } finally {
      session.unsubscribe();
    }
  });

  test("fails Stop session and keeps the terminal when Codex confirms no end within the limit", async () => {
    const session = await startSession();
    const timeouts = holdTimeouts(CODEX_COMMAND_END_CONFIRMATION_LIMIT_MS);
    try {
      await session.emitTurn("turn/started", "turn-1");
      await session.startCommand("dev", "turn-1");
      await session.emitTurn("turn/completed", "turn-1");

      const stopping = failureOf(session.adapter.stopSession(session.ref));
      await flushCodexAdapterWork();
      expect(timeouts.held).toHaveLength(1);
      for (const runLimit of timeouts.held) runLimit();
      const failure = await stopping;

      expect(failure).toBeInstanceOf(Error);
      expect(failure?.message).toBe(
        "Codex did not confirm within 10 seconds that these background commands ended: 'bun run dev'. The commands may still run, so the session keeps them. Check their processes, then retry Stop or restart the runtime.",
      );
      expect(session.snapshot()?.backgroundTasks).toEqual([devServerTask()]);
    } finally {
      timeouts.restore();
      session.unsubscribe();
    }
  });

  test("sends no clean request on Stop session without a running terminal", async () => {
    const session = await startSession();
    try {
      await session.emitTurn("turn/started", "turn-1");
      await session.emitTurn("turn/completed", "turn-1");
      await session.adapter.stopSession(session.ref);
      expect(session.transport.calls.map(({ method }) => method)).not.toContain(
        "thread/backgroundTerminals/clean",
      );
    } finally {
      session.unsubscribe();
    }
  });
});

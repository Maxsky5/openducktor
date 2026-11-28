import { expect, test } from "bun:test";
import type { SessionMessageAssistant, SessionMessageInfo, V2Event } from "@opencode/client";
import type { AgentEvent } from "@openducktor/core";
import { OpenCodeLiveMessageProjector } from "./opencode-live-message-projector";
import { durable, prepareFixture } from "./opencode-v2-live.test-support";
import {
  cursorPage,
  model,
  ref,
  response,
  session,
  sessionLogResponse,
} from "./opencode-v2.test-support";

const sessionID = ref.externalSessionId;
const prompt = {
  id: "msg_prompt",
  type: "user",
  text: "Check both files.",
  time: { created: 1 },
} satisfies SessionMessageInfo;
const steering = {
  id: "msg_steer",
  type: "synthetic",
  text: "Also check the result.",
  time: { created: 6_000 },
} satisfies SessionMessageInfo;

type NativeEvent = Extract<V2Event, { created: number; durable: unknown }>;
const native = <Type extends NativeEvent["type"]>(
  type: Type,
  created: number,
  data: Omit<Extract<NativeEvent, { type: Type }>["data"], "sessionID">,
) => {
  const event = {
    id: `evt_${type}_${created}`,
    type,
    created,
    data: { ...data, sessionID },
    durable,
  };
  // SAFETY: The event name selects its payload type, and the fixture adds the session ID.
  return event as Extract<NativeEvent, { type: Type }>;
};

const measure = (event: AgentEvent) =>
  event.type === "assistant_message" && event.generationTokensPerSecond !== undefined
    ? [{ messageId: event.messageId, rate: event.generationTokensPerSecond }]
    : [];

test("late rate evidence does not restore an execution boundary for a replaced step", () => {
  const older: SessionMessageAssistant = {
    id: "msg_previous_attempt",
    type: "assistant",
    agent: "build",
    model,
    time: { created: 100, completed: 200 },
    content: [],
  };
  const reply: SessionMessageAssistant = {
    ...older,
    id: "msg_next_reply",
    time: { created: 500, firstToken: 600, streamed: 1_600, completed: 1_700 },
    content: [{ type: "text", text: "Current reply." }],
    finish: "stop",
    tokens: { input: 0, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
  };
  const projector = new OpenCodeLiveMessageProjector();
  projector.seed([prompt, older, { ...steering, time: { created: 300 } }, reply], [older.id]);
  projector.apply(
    native("session.step.started", 250, {
      assistantMessageID: older.id,
      agent: older.agent,
      model,
      started: 250,
    }),
  );
  const settled = projector.apply(native("session.execution.succeeded", 1_800, {}));
  const late = projector.applyRateEvidence(sessionID, {
    unmarkedExecutionEnds: new Set([older.id]),
    unmarkedSuccesses: new Set(),
  });
  expect([...settled, ...late].flatMap(measure)).toEqual([]);
  expect(projector.snapshotEvents(sessionID).flatMap(measure)).toEqual([]);
});

test.each([
  {
    name: "marked turn with steering and a tool wait",
    legacy: false,
    missingEnd: false,
    interrupted: false,
    rate: 42.1,
  },
  {
    name: "first marked turn before its idle record is visible",
    legacy: false,
    firstTurn: true,
    missingEnd: false,
    interrupted: false,
    rate: 42.1,
  },
  {
    name: "first marked turn after a measurable legacy turn",
    legacy: false,
    earlierLegacy: "measurable",
    missingEnd: false,
    interrupted: false,
    rate: 42.1,
  },
  {
    name: "first marked turn after a legacy turn missing its stream end",
    legacy: false,
    earlierLegacy: "missing stream end",
    missingEnd: false,
    interrupted: false,
    rate: 42.1,
  },
  {
    name: "first marked turn after a legacy retry interrupted before output",
    legacy: false,
    earlierLegacy: "interrupted retry",
    missingEnd: false,
    interrupted: false,
    rate: 42.1,
  },
  {
    name: "first turn in a fork with incomplete timing in a copied call",
    legacy: false,
    earlierLegacy: "fork prefix",
    missingEnd: false,
    interrupted: false,
    rate: 42.1,
  },
  {
    name: "turn missing the tool step stream end",
    legacy: false,
    missingEnd: true,
    interrupted: false,
    rate: undefined,
  },
  {
    name: "interrupted turn after a stopped step",
    legacy: false,
    missingEnd: false,
    interrupted: true,
    rate: undefined,
  },
  {
    name: "legacy turn with durable success",
    legacy: true,
    missingEnd: false,
    interrupted: false,
    rate: 33.5,
  },
  {
    name: "legacy turn with durable interruption",
    legacy: true,
    missingEnd: false,
    interrupted: true,
    rate: undefined,
  },
])(
  "projects the same live and saved rate for a $name",
  async ({ legacy, firstTurn, earlierLegacy, missingEnd, interrupted, rate }) => {
    const first: SessionMessageAssistant = {
      id: "msg_tools",
      type: "assistant",
      agent: "build",
      model,
      content: [],
      time: {
        created: 500,
        completed: 33_000,
      },
      finish: "tool-calls",
      tokens: { input: 800, output: 150, reasoning: 70, cache: { read: 300, write: 0 } },
    };
    const reply: SessionMessageAssistant = {
      id: "msg_reply",
      type: "assistant",
      agent: "build",
      model,
      content: [{ type: "text", text: "Both files are ready." }],
      time: {
        created: 39_000,
        completed: 47_000,
      },
      finish: "stop",
      tokens: { input: 900, output: 171, reasoning: 30, cache: { read: 0, write: 0 } },
    };
    if (!legacy) {
      first.time.firstToken = 1_000;
      reply.time.firstToken = 40_000;
    }
    if (!missingEnd) first.time.streamed = 5_000;
    reply.time.streamed = legacy ? 45_000 : 46_000;
    const history: SessionMessageInfo[] = [];
    if (!legacy && !firstTurn && !earlierLegacy)
      history.push({
        id: "msg_previous_idle",
        type: "idle",
        outcome: "succeeded",
        time: { created: 0 },
      });
    const events: NativeEvent[] = [];
    let interruptedStep: SessionMessageAssistant | undefined;
    const fork =
      earlierLegacy === "fork prefix"
        ? {
            sessionID: "ses_parent",
            boundary: { type: "through" as const, messageID: "msg_parent_reply" },
          }
        : undefined;
    if (earlierLegacy) {
      const earlier: SessionMessageAssistant = {
        id: fork ? "msg_native_fork_2" : "msg_legacy_reply",
        type: "assistant",
        agent: "build",
        model,
        content: [{ type: "text", text: "An earlier reply." }],
        time: { created: -3_000 },
      };
      if (earlierLegacy === "measurable") earlier.time.streamed = -1_000;
      history.push(
        {
          id: fork ? "msg_native_fork_1" : "msg_legacy_prompt",
          type: "user",
          text: "Earlier input",
          time: { created: -3_500 },
        },
        earlier,
      );
      const started = native("session.step.started", -3_000, {
        assistantMessageID: earlier.id,
        agent: earlier.agent,
        model,
        started: -3_000,
      });
      Reflect.deleteProperty(started.data, "started");
      if (!fork) events.push(started);
      if (fork) {
        earlier.time.completed = -500;
        events.push({
          ...native("session.forked", -100, { parentID: fork.sessionID, boundary: fork.boundary }),
          id: "evt_native_fork",
        });
      } else if (earlierLegacy === "interrupted retry") {
        earlier.content = [];
        interruptedStep = earlier;
        events.push(
          native("session.retry.scheduled", -2_000, {
            assistantMessageID: earlier.id,
            attempt: 1,
            at: 5_000,
            error: { type: "rate-limit", message: "Try again later" },
          }),
          native("session.execution.interrupted", -100, { reason: "user" }),
        );
      } else {
        earlier.finish = "stop";
        earlier.time.completed = -500;
        earlier.tokens = { input: 100, output: 100, reasoning: 0, cache: { read: 0, write: 0 } };
        events.push(
          native("session.step.ended", -500, {
            assistantMessageID: earlier.id,
            finish: "stop",
            tokens: earlier.tokens,
            cost: 0,
          }),
          native("session.execution.succeeded", -100, {}),
        );
      }
    }
    history.push(prompt);
    let idleDuringRead: SessionMessageInfo | undefined;
    let logReads = 0;
    const fixtureForHistory = () =>
      prepareFixture(({ url }) => {
        if (fork && url.pathname === `/api/session/${sessionID}`)
          return response(session({ fork }));
        if (url.pathname === "/api/info")
          return Response.json({
            version: legacy ? "2.0.2" : "2.4.1",
            pid: 42,
            urls: [],
            paths: { tmp: "/tmp" },
          });
        if (url.pathname === "/api/rpc/opencode.goal/get") return Response.json({ output: null });
        if (url.pathname.endsWith("/message")) return cursorPage(history);
        if (url.pathname.endsWith("/log")) {
          expect(url.searchParams.get("follow")).toBe("false");
          logReads++;
          if (idleDuringRead) {
            // A paged read can retain the old row before the next step completes it.
            if (interruptedStep) interruptedStep.time.completed = first.time.created;
            history.push(idleDuringRead);
            idleDuringRead = undefined;
          }
          return sessionLogResponse(sessionID, events);
        }
        return undefined;
      });
    const fixture = fixtureForHistory();
    const runtime = await fixture.prepare();
    const observed: AgentEvent[] = [];
    const stoppedStep = Promise.withResolvers<void>();
    const settled = Promise.withResolvers<void>();
    const reject = (error: Error) => {
      stoppedStep.reject(error);
      settled.reject(error);
    };
    const push = (event: NativeEvent) => {
      const sequenced = { ...event, durable: { ...durable, seq: events.length + 1 } };
      events.push(sequenced);
      fixture.channel.push(sequenced);
    };
    try {
      const baseline = await runtime.connection.readSessionSources(ref.repoPath, [
        { ...ref, sessionScope: { kind: "repository", workspaceId: "workspace-1" } },
      ]);
      expect(baseline.failures).toEqual([]);
      await runtime.startForwarding((signal) => {
        if (signal.type === "fault" || signal.type === "session_fault")
          reject(new Error(signal.message));
        if (signal.type !== "session_event" || signal.provenance === "baseline") return;
        const { event } = signal;
        observed.push(event);
        if (event.type === "assistant_message" && event.messageId === reply.id)
          stoppedStep.resolve();
        if (event.type === "session_idle" && event.turnOutcome) settled.resolve();
      });
      const stream = (step: SessionMessageAssistant) => {
        const assistantMessageID = step.id;
        const started = native("session.step.started", step.time.created, {
          assistantMessageID,
          agent: step.agent,
          model,
          started: step.time.created,
        });
        if (legacy) Reflect.deleteProperty(started.data, "started");
        push(started);
        if (step.time.firstToken !== undefined)
          push(native("session.step.first-token", step.time.firstToken, { assistantMessageID }));
        if (step.content.length > 0) {
          push(native("session.text.started", 41_000, { assistantMessageID, ordinal: 0 }));
          push(
            native("session.text.ended", 44_000, {
              assistantMessageID,
              ordinal: 0,
              text: reply.content[0]!.type === "text" ? reply.content[0]!.text : "",
            }),
          );
        }
        if (step.time.streamed !== undefined)
          push(native("session.step.streamed", step.time.streamed, { assistantMessageID }));
        return native("session.step.ended", step.time.completed!, {
          assistantMessageID,
          finish: step.finish!,
          tokens: step.tokens!,
          cost: 0,
        });
      };

      // The tool call delays step completion but its wait is outside the measured stream.
      const firstEnded = stream(first);
      const call = { assistantMessageID: first.id, id: "call_read" };
      push(native("session.tool.input.started", 5_001, { ...call, name: "read" }));
      push(native("session.tool.called", 5_002, { ...call, input: { filePath: "notes.md" } }));
      const steer = native("session.synthetic", steering.time.created, { text: steering.text });
      push({ ...steer, id: "evt_steer" });
      push(
        native("session.tool.success", 32_000, {
          ...call,
          content: [{ type: "text", text: "File contents" }],
        }),
      );
      push(firstEnded);
      push(stream(reply));
      await stoppedStep.promise;
      expect(observed.flatMap(measure)).toEqual([]);

      const terminal = interrupted
        ? native("session.execution.interrupted", 48_000, { reason: "user" })
        : native("session.execution.succeeded", 48_000, {});
      push(terminal);
      await settled.promise;
      const expected = rate === undefined ? [] : [{ messageId: reply.id, rate }];
      expect(observed.flatMap(measure)).toEqual(expected);

      history.push(first, steering, reply);
      if (!legacy) {
        const idle: SessionMessageInfo = {
          id: terminal.id.replace(/^evt_/, "msg_"),
          type: "idle",
          outcome: interrupted ? "interrupted" : "succeeded",
          time: { created: terminal.created },
        };
        if (interrupted) history.push(idle);
        else idleDuringRead = idle;
      }
      const readSaved = async () => {
        const reloaded = await fixtureForHistory().prepare();
        return reloaded.queries.loadSessionHistory(ref).finally(() => reloaded.release());
      };
      const savedRates = (saved: Awaited<ReturnType<typeof readSaved>>) =>
        saved.flatMap((message) =>
          message.role === "assistant" && message.generationTokensPerSecond !== undefined
            ? [{ messageId: message.messageId, rate: message.generationTokensPerSecond }]
            : [],
        );
      const saved = await readSaved();
      const expectedHistory =
        earlierLegacy === "measurable"
          ? [{ messageId: "msg_legacy_reply", rate: 50 }, ...expected]
          : expected;
      expect(savedRates(saved)).toEqual(expectedHistory);
      if (!earlierLegacy) expect(logReads).toBe(interrupted && !legacy ? 0 : 1);
      if (!legacy && !interrupted) {
        expect(savedRates(await readSaved())).toEqual(expectedHistory);
        if (!earlierLegacy) expect(logReads).toBe(1);
      }
      if (legacy)
        expect(saved.find((message) => message.messageId === reply.id)).not.toHaveProperty(
          "forkPoint",
        );
    } finally {
      await runtime.release();
    }
  },
);

test.each([true, false])(
  "keeps the legacy reply outcome when a later execution has no model step (legacy success: %s)",
  async (legacySuccess) => {
    const reply: SessionMessageAssistant = {
      id: "msg_legacy_reply",
      type: "assistant",
      agent: "build",
      model,
      content: [{ type: "text", text: "Earlier reply." }],
      time: { created: 100, streamed: 1_100, completed: 1_200 },
      finish: "stop",
      tokens: { input: 0, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
    };
    const started = native("session.step.started", 100, {
      assistantMessageID: reply.id,
      agent: reply.agent,
      model,
      started: 100,
    });
    Reflect.deleteProperty(started.data, "started");
    const interrupted = (time: number) =>
      native("session.execution.interrupted", time, { reason: "user" });
    const succeeded = (time: number) => native("session.execution.succeeded", time, {});
    const newerTerminal = legacySuccess ? interrupted(1_500) : succeeded(1_500);
    const history: SessionMessageInfo[] = [
      prompt,
      reply,
      { ...steering, time: { created: 1_400 } },
      {
        id: newerTerminal.id.replace(/^evt_/, "msg_"),
        type: "idle",
        outcome: legacySuccess ? "interrupted" : "succeeded",
        time: { created: newerTerminal.created },
      },
    ];
    const fixture = prepareFixture(({ url }) => {
      if (url.pathname.endsWith("/message")) return cursorPage(history);
      if (url.pathname.endsWith("/log"))
        return sessionLogResponse(sessionID, [
          started,
          native("session.step.ended", 1_200, {
            assistantMessageID: reply.id,
            finish: "stop",
            tokens: reply.tokens!,
            cost: 0,
          }),
          legacySuccess ? succeeded(1_300) : interrupted(1_300),
          native("session.execution.started", 1_400, {}),
          newerTerminal,
        ]);
      return undefined;
    });
    const runtime = await fixture.prepare();
    try {
      const saved = await runtime.queries.loadSessionHistory(ref);
      const previous = saved.find((message) => message.messageId === reply.id);
      expect(previous?.role).toBe("assistant");
      expect(previous?.role === "assistant" && previous.generationTokensPerSecond).toBe(
        legacySuccess ? 100 : undefined,
      );
    } finally {
      await runtime.release();
    }
  },
);

test.each(["settled", "released"])(
  "does not hold other sessions behind a log read for a %s turn",
  async (outcome) => {
    const older: SessionMessageAssistant = {
      id: "msg_previous",
      type: "assistant",
      agent: "build",
      model,
      time: { created: 100, completed: 200 },
      content: [],
    };
    const reply: SessionMessageAssistant = {
      id: "msg_current",
      type: "assistant",
      agent: "build",
      model,
      time: { created: 500, firstToken: 600, streamed: 1_600, completed: 1_700 },
      content: [{ type: "text", text: "Current reply." }],
      finish: "stop",
      tokens: { input: 0, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
    };
    const previousStart = native("session.step.started", 100, {
      assistantMessageID: older.id,
      agent: older.agent,
      model,
      started: 100,
    });
    Reflect.deleteProperty(previousStart.data, "started");
    const terminal = native("session.execution.succeeded", 1_800, {});
    const other = { ...ref, externalSessionId: "ses_other" };
    const sessionScope = { kind: "repository", workspaceId: "workspace-1" } as const;
    const logRequested = Promise.withResolvers<AbortSignal | undefined>();
    const finishLog = Promise.withResolvers<void>();
    const busy = Promise.withResolvers<void>();
    const settled = Promise.withResolvers<void>();
    const measured = Promise.withResolvers<number>();
    const rates: number[] = [];
    const fixture = prepareFixture(({ url, signal }) => {
      if (url.pathname === "/api/session/ses_other")
        return response(session({ id: other.externalSessionId }));
      if (url.pathname === `/api/session/${sessionID}/message`)
        return cursorPage([prompt, older, { ...steering, time: { created: 400 } }, reply]);
      if (url.pathname === `/api/experimental/session/${sessionID}/log`) {
        logRequested.resolve(signal);
        return finishLog.promise.then(() =>
          sessionLogResponse(sessionID, [
            previousStart,
            native("session.execution.interrupted", 300, { reason: "user" }),
          ]),
        );
      }
      return undefined;
    });
    const runtime = await fixture.prepare();
    try {
      await runtime.connection.readSessionSources(ref.repoPath, [{ ...other, sessionScope }]);
      await runtime.startForwarding((signal) => {
        if (signal.type !== "session_event") return;
        const { event } = signal;
        if (signal.externalSessionId === other.externalSessionId && event.type === "session_status")
          busy.resolve();
        if (event.type === "session_idle" && event.turnOutcome === "completed") settled.resolve();
        for (const { rate } of measure(event)) {
          rates.push(rate);
          measured.resolve(rate);
        }
      });
      const restoring = runtime.connection.readSessionSources(ref.repoPath, [
        { ...ref, sessionScope },
        { ...other, sessionScope },
      ]);
      const signal = await logRequested.promise;
      const otherStarted = native("session.execution.started", 1_801, {});
      fixture.channel.push({
        ...otherStarted,
        data: { sessionID: other.externalSessionId },
        durable: { ...durable, aggregateID: other.externalSessionId },
      });
      fixture.channel.push(terminal);
      expect(
        await Promise.race([
          Promise.all([busy.promise, settled.promise]).then(() => "delivered"),
          Bun.sleep(180).then(() => "blocked"),
        ]),
      ).toBe("delivered");
      expect((await restoring).failures).toEqual([]);
      expect(rates).toEqual([]);

      if (outcome === "released") {
        await runtime.connection.releaseSession(ref);
        expect(signal?.aborted).toBe(true);
      }
      finishLog.resolve();
      if (outcome === "settled") expect(await measured.promise).toBe(100);
    } finally {
      finishLog.resolve();
      await runtime.release();
    }
  },
);

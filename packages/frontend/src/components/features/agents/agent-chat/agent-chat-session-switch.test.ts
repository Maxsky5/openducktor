import { expect, spyOn, test } from "bun:test";
import {
  agentSessionHistorySchema,
  agentSessionTranscriptEventSchema,
  type AgentSessionHistoryMessage,
  type AgentSessionTranscriptEvent,
} from "@openducktor/contracts";
import { render } from "@testing-library/react";
import { act, createElement, useSyncExternalStore } from "react";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import { AgentSessionHistoryLoadContext, AgentSessionsContext } from "@/state/app-state-contexts";
import { createAgentSessionTranscriptEventConsumer } from "@/state/operations/agent-orchestrator/events/session-transcript-events";
import { useSelectedSessionHistoryLoad } from "@/state/operations/agent-orchestrator/history/use-selected-session-history-load";
import { createSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import { applyLoadedSessionHistory } from "@/state/operations/agent-orchestrator/support/session-history-chat-messages";
import { createSessionTurnState } from "@/state/operations/agent-orchestrator/support/session-turn-state";
import { createAnimationFrameTestDriver } from "@/test-utils/animation-frame-test-driver";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { AgentSessionHistoryLoadContextValue } from "@/types/state-slices";
import { buildMessage } from "./agent-chat-test-fixtures";
import { toAgentChatTranscriptSession } from "./agent-chat-transcript-session";
import { useAgentChatTranscriptModel } from "./use-agent-chat-transcript-model";

test.each([
  [false, false],
  [false, true],
  [true, false],
  [true, true],
])("keeps live text when history is complete=%s and live final=%s", (completed, liveFinal) => {
  const session = createAgentSessionFixture({ externalSessionId: "session-idle-first" });
  const store = createAgentSessionsStore("/repo");
  store.replaceSession(session);
  const consumer = createAgentSessionTranscriptEventConsumer(
    {
      readSession: store.getSessionSnapshot,
      ensureSession: (identity, createSession) =>
        store.getSessionSnapshot(identity) ?? createSession(),
      updateSession: store.updateSession,
      updateSessionTodos: () => {},
      sessionTurnState: createSessionTurnState(),
    },
    { batchWindowMs: 60_000 },
  );
  const sessionRef = {
    externalSessionId: session.externalSessionId,
    runtimeKind: session.runtimeKind,
    workingDirectory: session.workingDirectory,
    repoPath: "/repo",
  };
  const timestamp = "2026-10-01T08:00:05Z";
  const messageId = "assistant-idle-first";
  const answer = "Done after idle";
  const answers = () =>
    store
      .getSessionSnapshot(session)
      ?.messages.items.filter((message) => message.role === "assistant" && message.content);
  const messagesAtReadStart = store.getSessionSnapshot(session)?.messages;

  try {
    const events = liveFinal
      ? [
          { type: "session_idle" },
          { type: "assistant_message", messageId, message: "" },
          { type: "assistant_message", messageId, message: answer },
        ]
      : [{ type: "assistant_delta", messageId, channel: "text", delta: answer }];
    for (const event of events) {
      consumer.handle(
        agentSessionTranscriptEventSchema.parse({
          ...event,
          externalSessionId: session.externalSessionId,
          sessionRef,
          timestamp,
        }),
      );
    }
    consumer.flushSession(sessionRef);
    expect(answers()?.map((message) => [message.id, message.content])).toEqual([
      [messageId, answer],
    ]);

    const history = agentSessionHistorySchema.parse([
      {
        messageId,
        role: "assistant",
        timestamp,
        text: completed ? answer : "Earlier partial answer",
        parts: [
          {
            kind: "text",
            messageId,
            partId: "text-idle-first",
            text: completed ? answer : "Earlier partial answer",
            completed,
          },
          ...(completed
            ? [
                {
                  kind: "step",
                  messageId,
                  partId: "step-idle-first",
                  phase: "finish",
                  reason: "stop",
                },
              ]
            : []),
        ],
      },
    ]);
    store.updateSession(session, (current) =>
      applyLoadedSessionHistory(current, history, messagesAtReadStart),
    );

    expect(answers()).toHaveLength(1);
    expect(answers()?.[0]).toMatchObject({
      id: completed ? "text:assistant-idle-first:text-idle-first" : messageId,
      content: answer,
      meta: { kind: "assistant", isFinal: completed || liveFinal },
    });
  } finally {
    consumer.close();
  }
});

test.each([
  [false, true],
  [true, true],
  [false, false],
  [true, false],
])(
  "keeps warmed live text after history with completed parts=%s, interleaved tool=%s",
  async (completed, interleavedTool) => {
    const firstSession = createAgentSessionFixture({
      externalSessionId: "session-a",
      runtimeKind: "opencode",
      runtimeGeneration: "generation-1",
      historyLoadState: "loaded",
      messages: createSessionMessagesState("session-a", [
        buildMessage("user", "Inspect the task", {
          id: "user-a",
          timestamp: "2026-10-01T08:00:00Z",
          meta: { kind: "user", state: "read" },
        }),
      ]),
    });
    const otherSession = createAgentSessionFixture({
      externalSessionId: "session-b",
      runtimeGeneration: "generation-1",
      historyLoadState: "loaded",
    });
    const store = createAgentSessionsStore("/repo");
    store.replaceSession(firstSession);
    store.replaceSession(otherSession);
    const consumer = createAgentSessionTranscriptEventConsumer(
      {
        readSession: store.getSessionSnapshot,
        ensureSession: (identity, createSession) =>
          store.getSessionSnapshot(identity) ?? createSession(),
        updateSession: store.updateSession,
        updateSessionTodos: () => {},
        sessionTurnState: createSessionTurnState(),
      },
      { batchWindowMs: 60_000 },
    );
    const historyResponse = Promise.withResolvers<AgentSessionHistoryMessage[]>();
    let deferHistory = false;
    let historyStarted = false;
    const historyActions: AgentSessionHistoryLoadContextValue = {
      loadSelectedSessionBaselineHistory: async () => null,
      revalidateAgentSessionHistory: async (identity) => {
        if (!deferHistory || identity.externalSessionId !== firstSession.externalSessionId) {
          return null;
        }
        historyStarted = true;
        const messagesAtReadStart = store.getSessionSnapshot(identity)?.messages;
        const history = await historyResponse.promise;
        return store.updateSession(identity, (session) =>
          applyLoadedSessionHistory(session, history, messagesAtReadStart),
        );
      },
    };
    const observedStates: ReturnType<typeof useAgentChatTranscriptModel>[] = [];
    const Probe = ({ identity }: { identity: AgentSessionIdentity }) => {
      const session = useSyncExternalStore(store.subscribe, () =>
        store.getSessionSnapshot(identity),
      );
      useSelectedSessionHistoryLoad({ session, repoReadinessState: "ready" });
      observedStates.push(
        useAgentChatTranscriptModel({
          session: session ? toAgentChatTranscriptSession(session) : null,
          showThinkingMessages: true,
        }),
      );
      return null;
    };
    const view = (identity: AgentSessionIdentity) =>
      createElement(
        AgentSessionsContext.Provider,
        { value: store },
        createElement(
          AgentSessionHistoryLoadContext.Provider,
          { value: historyActions },
          createElement(Probe, { identity }),
        ),
      );
    const driver = createAnimationFrameTestDriver();
    const rendered = render(view(firstSession));
    const sourceMessageId = "assistant-a";
    const textBefore = "    const answer = 42;\n\n\n    return answer;\n";
    const textAfter = "    console.log(answer);\n\n\n    console.log(42);\n";
    const finalText = (interleavedTool ? `${textBefore}\n${textAfter}` : textBefore).trim();
    const parts: AgentSessionHistoryMessage["parts"] = [
      {
        kind: "text",
        messageId: sourceMessageId,
        partId: "text-before",
        text: textBefore,
        completed,
      },
    ];
    if (interleavedTool) {
      parts.push(
        {
          kind: "tool",
          messageId: sourceMessageId,
          partId: "tool-a",
          callId: "call-a",
          tool: "read",
          toolType: "read",
          status: "completed",
        },
        {
          kind: "text",
          messageId: sourceMessageId,
          partId: "text-after",
          text: textAfter,
          completed,
        },
      );
    }
    parts.push({
      kind: "step",
      messageId: sourceMessageId,
      partId: "step-a",
      phase: "finish",
      reason: "stop",
    });
    const sessionRef = {
      externalSessionId: firstSession.externalSessionId,
      runtimeKind: firstSession.runtimeKind,
      workingDirectory: firstSession.workingDirectory,
      repoPath: "/repo",
    };
    const receive = (event: AgentSessionTranscriptEvent) =>
      consumer.handle(agentSessionTranscriptEventSchema.parse(event));
    const visibleMessages = () => {
      const state = observedStates.at(-1);
      if (!state) {
        throw new Error("Expected a rendered transcript state.");
      }
      return state.transcriptState.rows.flatMap((row) =>
        row.kind === "message" ? [[row.message.id, row.message.role, row.message.content]] : [],
      );
    };

    try {
      rendered.rerender(view(otherSession));
      await driver.flushTimers(20);
      act(() => {
        for (const [index, part] of parts.entries()) {
          receive({
            type: "assistant_part",
            externalSessionId: firstSession.externalSessionId,
            sessionRef,
            timestamp: `2026-10-01T08:00:0${index + 1}Z`,
            part,
          });
        }
        receive({
          type: "assistant_message",
          externalSessionId: firstSession.externalSessionId,
          sessionRef,
          timestamp: "2026-10-01T08:00:05Z",
          messageId: sourceMessageId,
          message: finalText,
          durationMs: 5_000,
        });
        receive({
          type: "session_idle",
          externalSessionId: firstSession.externalSessionId,
          sessionRef,
          timestamp: "2026-10-01T08:00:05Z",
        });
      });
      await driver.flushTimers(20);
      deferHistory = true;
      const beforeSwitch = observedStates.length;
      rendered.rerender(view(firstSession));
      expect(observedStates[beforeSwitch]?.hasCurrentRowsForActiveSession).toBe(true);
      expect(historyStarted).toBe(true);
      const cachedMessages = visibleMessages();

      await act(async () => {
        historyResponse.resolve(
          agentSessionHistorySchema.parse([
            {
              messageId: "user-a",
              role: "user",
              state: "read",
              displayParts: [],
              timestamp: "2026-10-01T08:00:00Z",
              text: "Inspect the task",
              parts: [],
            },
            {
              messageId: sourceMessageId,
              role: "assistant",
              timestamp: "2026-10-01T08:00:05Z",
              text: finalText,
              durationMs: 5_000,
              parts,
            },
          ]),
        );
      });
      await driver.flushTimers(20);
      expect(observedStates.at(-1)?.hasCurrentRowsForActiveSession).toBe(true);
      expect(visibleMessages()).toEqual(cachedMessages);
      for (const state of observedStates.slice(beforeSwitch)) {
        expect(
          state.transcriptState.rows.flatMap((row) =>
            row.kind === "message" ? [[row.message.id, row.message.role, row.message.content]] : [],
          ),
        ).toEqual(cachedMessages);
      }
      expect(visibleMessages()).toEqual([
        ["user-a", "user", "Inspect the task"],
        ["text:assistant-a:text-before", "assistant", textBefore],
        ...(interleavedTool
          ? [
              ["tool:assistant-a:call-a", "tool", "Tool read completed"],
              ["text:assistant-a:text-after", "assistant", textAfter],
            ]
          : []),
      ]);
    } finally {
      historyResponse.resolve([]);
      consumer.close();
      rendered.unmount();
    }
  },
);

test("stops an inactive build when selection evicts its cache entry", () => {
  const sessions = Array.from({ length: 7 }, (_, index) =>
    createAgentSessionFixture({
      externalSessionId: `session-eviction-${index}`,
      historyLoadState: "loaded",
      messages: createSessionMessagesState(`session-eviction-${index}`, [
        buildMessage("assistant", `Answer ${index}`, { id: `answer-${index}` }),
      ]),
    }),
  );
  const firstSession = sessions[0]!;
  const store = createAgentSessionsStore("/repo");
  for (const session of sessions) {
    store.replaceSession(session);
  }
  let latest: ReturnType<typeof useAgentChatTranscriptModel> | undefined;
  const Probe = ({ identity }: { identity: AgentSessionIdentity }) => {
    const session = useSyncExternalStore(store.subscribe, () => store.getSessionSnapshot(identity));
    latest = useAgentChatTranscriptModel({
      session: session ? toAgentChatTranscriptSession(session) : null,
      showThinkingMessages: true,
    });
    return null;
  };
  const view = (identity: AgentSessionIdentity) =>
    createElement(
      AgentSessionsContext.Provider,
      { value: store },
      createElement(Probe, { identity }),
    );
  type Timer = ReturnType<typeof globalThis.setTimeout>;
  const timers = new Map<Timer, () => void>();
  const clock: {
    setTimeout: (callback: () => void, delay?: number) => Timer;
    clearTimeout: (timer: Timer) => void;
  } = globalThis;
  const setTimeout = clock.setTimeout;
  const clearTimeout = clock.clearTimeout;
  const schedule = spyOn(clock, "setTimeout").mockImplementation((callback, delay) => {
    if (delay !== 0) {
      return setTimeout(callback, delay);
    }
    const timer = setTimeout(() => {}, 60_000);
    clearTimeout(timer);
    timers.set(timer, callback);
    return timer;
  });
  const cancel = spyOn(clock, "clearTimeout").mockImplementation((timer) => {
    timers.delete(timer);
    clearTimeout(timer);
  });
  const runChunk = () => {
    const next = timers.entries().next().value;
    if (!next) {
      throw new Error("Expected a queued transcript build.");
    }
    timers.delete(next[0]);
    act(next[1]);
  };
  const rendered = render(view(toAgentChatTranscriptSession(firstSession)));

  try {
    for (const session of sessions.slice(1, 6)) {
      rendered.rerender(view(toAgentChatTranscriptSession(session)));
      runChunk();
      expect(latest?.hasCurrentRowsForActiveSession).toBe(true);
    }
    let reads = 0;
    const messages = Array.from({ length: 1_000 }, (_, index) => ({
      ...buildMessage("assistant", `New answer ${index}`),
      get id() {
        reads += 1;
        return `new-answer-${index}`;
      },
    }));
    act(() => {
      store.replaceSession({
        ...firstSession,
        messages: createSessionMessagesState(firstSession.externalSessionId, messages, 1),
      });
    });
    rendered.rerender(view(toAgentChatTranscriptSession(sessions[6]!)));
    const beforeChunk = reads;
    runChunk();
    expect(reads).toBeGreaterThan(beforeChunk);
    expect(timers.size).toBe(2);
    const afterChunk = reads;

    runChunk();
    expect(latest?.hasCurrentRowsForActiveSession).toBe(true);
    expect(timers.size).toBe(0);
    expect(reads).toBe(afterChunk);

    rendered.rerender(view(toAgentChatTranscriptSession(firstSession)));
    expect(latest?.isTranscriptModelMissing).toBe(true);
    expect(latest?.transcriptState.rows).toEqual([]);
  } finally {
    rendered.unmount();
    schedule.mockRestore();
    cancel.mockRestore();
  }
});

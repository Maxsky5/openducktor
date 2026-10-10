import { expect, test } from "bun:test";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import { historyToChatMessages } from "../support/session-history-chat-messages";
import {
  buildSession,
  createSessionsRef,
  createSessionUpdater,
  getSessionMessages,
  listenToAgentSessionEvents,
  type SessionEvent,
} from "./session-events-test-harness";

const comparableMessage = (message: AgentChatMessage) => {
  if (message.meta?.kind !== "tool") return message;
  const {
    observedStartedAtMs: _observedStartedAtMs,
    observedEndedAtMs: _observedEndedAtMs,
    inputReadyAtMs: _inputReadyAtMs,
    ...meta
  } = message.meta;
  return { ...message, meta };
};

test("keeps failed native output out of successful turn footers after hydration", () => {
  const messages = historyToChatMessages(
    [
      {
        messageId: "msg-failed",
        role: "assistant",
        timestamp: "2026-02-22T08:00:01.000Z",
        text: "",
        error: "Provider stream failed",
        parts: [
          {
            kind: "step",
            messageId: "msg-failed",
            partId: "msg-failed:finish",
            phase: "finish",
            reason: "stop",
          },
        ],
      },
    ],
    { role: "spec" },
  );
  expect(
    messages.some((message) => message.meta?.kind === "assistant" && message.meta.isFinal),
  ).toBe(false);
  expect(
    messages.some(
      (message) =>
        message.meta?.kind === "session_notice" && message.meta.reason === "session_error",
    ),
  ).toBe(true);
});

test("keeps a multi-step V2 transcript identical before and after hydration", async () => {
  let handleEvent: ((event: SessionEvent) => void) | undefined;
  const sessionsRef = createSessionsRef([buildSession()]);
  const unsubscribe = await listenToAgentSessionEvents({
    adapter: {
      subscribeEvents: async (_session, handler) => {
        handleEvent = handler;
        return () => {};
      },
      replyApproval: async () => {},
    },
    sessionsRef,
    updateSession: createSessionUpdater(sessionsRef),
    resolveTurnDurationMs: () => undefined,
    clearTurnDuration: () => {},
  });
  const history: AgentSessionHistoryMessage[] = [
    {
      messageId: "msg-read",
      role: "assistant",
      timestamp: "2026-02-22T08:00:01.000Z",
      text: "",
      parts: [
        {
          kind: "tool",
          messageId: "msg-read",
          partId: "call-read",
          callId: "call-read",
          tool: "read",
          toolType: "read",
          status: "completed",
          input: { path: "README.md" },
          output: "Project guide",
        },
        {
          kind: "step",
          messageId: "msg-read",
          partId: "msg-read:finish",
          phase: "finish",
          reason: "tool-calls",
        },
      ],
    },
    {
      messageId: "msg-plan",
      role: "assistant",
      timestamp: "2026-02-22T08:00:03.000Z",
      text: "",
      parts: [
        {
          kind: "reasoning",
          messageId: "msg-plan",
          partId: "msg-plan:reasoning:0",
          text: "Writing the plan",
          completed: false,
        },
        {
          kind: "tool",
          messageId: "msg-plan",
          partId: "call-plan",
          callId: "call-plan",
          tool: "openducktor_odt_set_plan",
          toolType: "workflow",
          status: "pending",
          inputStreaming: true,
        },
      ],
    },
  ];
  const emitParts = (message: AgentSessionHistoryMessage) => {
    for (const part of message.parts)
      handleEvent!({
        type: "assistant_part",
        externalSessionId: "session-1",
        timestamp: message.timestamp,
        part,
      });
  };
  const expectParity = () => {
    const live = getSessionMessages(sessionsRef).map(comparableMessage);
    const hydrated = historyToChatMessages(history, { role: "spec" }).map(comparableMessage);
    expect(live).toEqual(hydrated);
    return live;
  };
  try {
    for (const message of history) emitParts(message);
    expect(expectParity().map((message) => message.role)).toEqual(["tool", "thinking", "tool"]);
    expect(getSessionMessages(sessionsRef).at(-1)?.meta).toMatchObject({
      status: "pending",
      inputStreaming: true,
    });

    history[1]!.parts = [
      {
        kind: "reasoning",
        messageId: "msg-plan",
        partId: "msg-plan:reasoning:0",
        text: "Writing the plan now.",
        completed: true,
      },
      {
        kind: "tool",
        messageId: "msg-plan",
        partId: "call-plan",
        callId: "call-plan",
        tool: "openducktor_odt_set_plan",
        toolType: "workflow",
        status: "completed",
        input: { taskId: "task-1", markdown: "# Plan" },
        output: "Plan saved",
        startedAtMs: 10_000,
        endedAtMs: 10_050,
      },
      {
        kind: "step",
        messageId: "msg-plan",
        partId: "msg-plan:finish",
        phase: "finish",
        reason: "tool-calls",
      },
    ];
    emitParts(history[1]!);
    const final: AgentSessionHistoryMessage = {
      messageId: "msg-final",
      role: "assistant",
      timestamp: "2026-02-22T08:00:04.000Z",
      text: "Plan saved.",
      durationMs: 4_000,
      parts: [
        {
          kind: "text",
          messageId: "msg-final",
          partId: "msg-final:text:0",
          text: "Plan saved.",
          completed: true,
        },
        {
          kind: "step",
          messageId: "msg-final",
          partId: "msg-final:finish",
          phase: "finish",
          reason: "stop",
        },
      ],
    };
    history.push(final);
    emitParts(final);
    handleEvent!({
      type: "assistant_message",
      externalSessionId: "session-1",
      messageId: final.messageId,
      timestamp: final.timestamp,
      message: final.text,
      durationMs: final.durationMs,
    });
    const live = expectParity();
    expect(
      live.filter((message) => message.meta?.kind === "assistant" && message.meta.isFinal),
    ).toHaveLength(1);
    expect(live.at(-1)?.meta).toMatchObject({ isFinal: true, durationMs: 4_000 });
    expect(
      live.find((message) => message.meta?.kind === "tool" && message.meta.callId === "call-plan")
        ?.meta,
    ).not.toHaveProperty("inputStreaming");
  } finally {
    unsubscribe();
  }
});

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createElement, createRef, type MutableRefObject, type PropsWithChildren } from "react";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createChatSettingsFixture } from "@/test-utils/shared-test-fixtures";
import { AgentChatSettingsProvider } from "./agent-chat-settings-context";
import { buildMessage, buildSession } from "./agent-chat-test-fixtures";
import {
  getTurnActiveStreamingAssistantMessageId,
  useAgentChatRenderedTranscript,
} from "./use-agent-chat-rendered-transcript";

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;

beforeEach(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  if (previousActEnvironment === undefined) {
    delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    return;
  }
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

const settingsWrapper = ({ children }: PropsWithChildren) =>
  createElement(
    AgentChatSettingsProvider,
    { value: createChatSettingsFixture({ showThinkingMessages: true }) },
    children,
  );

describe("getTurnActiveStreamingAssistantMessageId", () => {
  test("assigns the active streaming id only to the turn containing that message", () => {
    const firstTurnRows = [
      { kind: "message" as const, key: "session:user-1", message: buildMessage("user", "Q") },
    ];
    const secondTurnRows = [
      {
        kind: "message" as const,
        key: "session:assistant-live",
        message: buildMessage("assistant", "Working", {
          id: "assistant-live",
          meta: { kind: "assistant", isFinal: false },
        }),
      },
    ];

    expect(getTurnActiveStreamingAssistantMessageId(firstTurnRows, "assistant-live")).toBeNull();
    expect(getTurnActiveStreamingAssistantMessageId(secondTurnRows, "assistant-live")).toBe(
      "assistant-live",
    );
  });

  test("ignores finalized duplicate assistant ids when selecting the streaming turn", () => {
    const finalizedDuplicateRows = [
      {
        kind: "message" as const,
        key: "session:assistant-live:older",
        message: buildMessage("assistant", "Earlier answer", {
          id: "assistant-live",
          meta: { kind: "assistant", isFinal: true },
        }),
      },
    ];
    const streamingRows = [
      {
        kind: "message" as const,
        key: "session:assistant-live:current",
        message: buildMessage("assistant", "Working", {
          id: "assistant-live",
          meta: { kind: "assistant", isFinal: false },
        }),
      },
    ];

    expect(
      getTurnActiveStreamingAssistantMessageId(finalizedDuplicateRows, "assistant-live"),
    ).toBeNull();
    expect(getTurnActiveStreamingAssistantMessageId(streamingRows, "assistant-live")).toBe(
      "assistant-live",
    );
  });

  test("rendered transcript assigns the streaming id only to the containing turn", async () => {
    const session = buildSession({
      externalSessionId: "session-rendered-streaming-turn",
      status: "running",
      messages: [
        buildMessage("user", "First question", { id: "user-1" }),
        buildMessage("assistant", "First answer", { id: "assistant-1" }),
        buildMessage("user", "Second question", { id: "user-2" }),
        buildMessage("assistant", "Working", {
          id: "assistant-live",
          meta: { kind: "assistant", isFinal: false },
        }),
      ],
    });
    const displayedSessionKey = agentSessionIdentityKey(session);
    const scrollToBottomOnSendRef: MutableRefObject<(() => void) | null> = { current: null };
    const syncBottomAfterComposerLayoutRef: MutableRefObject<(() => void) | null> = {
      current: null,
    };
    const harness = createHookHarness(
      () =>
        useAgentChatRenderedTranscript({
          session,
          displayedSessionKey,
          isSessionWorking: true,
          shouldResetTranscriptWindow: false,
          transcriptNotice: null,
          messagesContainerRef: createRef<HTMLDivElement>(),
          scrollToBottomOnSendRef,
          syncBottomAfterComposerLayoutRef,
        }),
      {},
      { wrapper: settingsWrapper },
    );

    await harness.mount();

    expect(harness.getLatest().renderedTurns).toHaveLength(2);
    expect(harness.getLatest().renderedTurns[0]?.activeStreamingAssistantMessageId).toBeNull();
    expect(harness.getLatest().renderedTurns[1]?.activeStreamingAssistantMessageId).toBe(
      "assistant-live",
    );
    await harness.unmount();
  });

  test("rendered transcript ignores finalized duplicate ids in older turns", async () => {
    const session = buildSession({
      externalSessionId: "session-rendered-streaming-duplicate-id",
      status: "running",
      messages: [
        buildMessage("user", "First question", { id: "user-1" }),
        buildMessage("assistant", "First answer", {
          id: "assistant-live",
          meta: { kind: "assistant", isFinal: true },
        }),
        buildMessage("user", "Second question", { id: "user-2" }),
        buildMessage("assistant", "Working", {
          id: "assistant-live",
          meta: { kind: "assistant", isFinal: false },
        }),
      ],
    });
    const displayedSessionKey = agentSessionIdentityKey(session);
    const scrollToBottomOnSendRef: MutableRefObject<(() => void) | null> = { current: null };
    const syncBottomAfterComposerLayoutRef: MutableRefObject<(() => void) | null> = {
      current: null,
    };
    const harness = createHookHarness(
      () =>
        useAgentChatRenderedTranscript({
          session,
          displayedSessionKey,
          isSessionWorking: true,
          shouldResetTranscriptWindow: false,
          transcriptNotice: null,
          messagesContainerRef: createRef<HTMLDivElement>(),
          scrollToBottomOnSendRef,
          syncBottomAfterComposerLayoutRef,
        }),
      {},
      { wrapper: settingsWrapper },
    );

    await harness.mount();

    expect(harness.getLatest().renderedTurns).toHaveLength(2);
    expect(harness.getLatest().renderedTurns[0]?.activeStreamingAssistantMessageId).toBeNull();
    expect(harness.getLatest().renderedTurns[1]?.activeStreamingAssistantMessageId).toBe(
      "assistant-live",
    );
    await harness.unmount();
  });

  test("keeps rendered turns stable across unrelated rerenders of a large running session", async () => {
    const messages = Array.from({ length: 120 }, (_, messageIndex) => {
      const isAssistant = messageIndex % 2 === 1;
      return buildMessage(isAssistant ? "assistant" : "user", `Message ${messageIndex}`, {
        id: `message-${messageIndex}`,
        ...(isAssistant
          ? {
              meta: {
                kind: "assistant" as const,
                isFinal: messageIndex < 119,
              },
            }
          : {}),
      });
    });
    const session = buildSession({
      externalSessionId: "session-rendered-large-stability",
      status: "running",
      messages,
    });
    const displayedSessionKey = agentSessionIdentityKey(session);
    const messagesContainerRef = createRef<HTMLDivElement>();
    const scrollToBottomOnSendRef: MutableRefObject<(() => void) | null> = { current: null };
    const syncBottomAfterComposerLayoutRef: MutableRefObject<(() => void) | null> = {
      current: null,
    };
    const harness = createHookHarness(
      (_props: { tick: number }) =>
        useAgentChatRenderedTranscript({
          session,
          displayedSessionKey,
          isSessionWorking: true,
          shouldResetTranscriptWindow: false,
          transcriptNotice: null,
          messagesContainerRef,
          scrollToBottomOnSendRef,
          syncBottomAfterComposerLayoutRef,
        }),
      { tick: 0 },
      { wrapper: settingsWrapper },
    );

    await harness.mount();
    await harness.waitFor((state) => state.renderedTurns.length > 0, 2000);
    const initialRenderedTurns = harness.getLatest().renderedTurns;

    await harness.update({ tick: 1 });

    expect(harness.getLatest().renderedTurns).toBe(initialRenderedTurns);
    await harness.unmount();
  });
});

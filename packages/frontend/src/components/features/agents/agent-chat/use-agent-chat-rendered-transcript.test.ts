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
});

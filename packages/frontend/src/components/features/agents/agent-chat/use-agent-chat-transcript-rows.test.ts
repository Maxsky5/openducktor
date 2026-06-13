import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { createSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentChatThreadSession } from "./agent-chat.types";
import { buildMessage, buildQuestionRequest, buildSession } from "./agent-chat-test-fixtures";
import { useAgentChatTranscriptRows } from "./use-agent-chat-transcript-rows";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

type HarnessProps = {
  session: AgentChatThreadSession | null;
  showThinkingMessages: boolean;
  shouldPauseDerivation: boolean;
};

type HookResult = ReturnType<typeof useAgentChatTranscriptRows>;

const animationFrameCallbacks = new Map<number, FrameRequestCallback>();
let nextAnimationFrameId = 1;

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const flushAnimationFrames = async (): Promise<void> => {
  if (animationFrameCallbacks.size === 0) {
    return;
  }

  const queuedCallbacks = Array.from(animationFrameCallbacks.values());
  animationFrameCallbacks.clear();

  await act(async () => {
    for (const callback of queuedCallbacks) {
      callback(16);
    }
    await flush();
  });
  await flushAnimationFrames();
};

const waitForTimers = async (remainingTicks = 20): Promise<void> => {
  if (remainingTicks <= 0) {
    return;
  }

  await act(async () => {
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    await flush();
  });
  await waitForTimers(remainingTicks - 1);
};

const flushTranscriptDerivation = async (): Promise<void> => {
  await flushAnimationFrames();
  await waitForTimers();
};

const createLargeSession = (
  externalSessionId: string,
  messageCount = 160,
): AgentChatThreadSession => {
  const messages = Array.from({ length: messageCount }, (_, index) => {
    const turnIndex = Math.floor(index / 2);
    if (index % 2 === 0) {
      return buildMessage("user", `Question ${turnIndex}`, { id: `user-${turnIndex}` });
    }

    return buildMessage("assistant", `Answer ${turnIndex}`, { id: `assistant-${turnIndex}` });
  });

  return buildSession({
    externalSessionId,
    messages: createSessionMessagesState(externalSessionId, messages, 1),
  });
};

const mountHarness = async (props: HarnessProps) => {
  const harness = createHookHarness(
    (nextProps: HarnessProps): HookResult => useAgentChatTranscriptRows(nextProps),
    props,
  );

  await harness.mount();
  return harness;
};

describe("useAgentChatTranscriptRows", () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

  beforeEach(() => {
    animationFrameCallbacks.clear();
    nextAnimationFrameId = 1;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      const frameId = nextAnimationFrameId;
      nextAnimationFrameId += 1;
      animationFrameCallbacks.set(frameId, callback);
      return frameId;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((frameId: number) => {
      animationFrameCallbacks.delete(frameId);
    }) as typeof cancelAnimationFrame;
  });

  afterEach(() => {
    animationFrameCallbacks.clear();
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  test("starts cache-miss sessions with lightweight rows until post-paint derivation completes", async () => {
    const session = createLargeSession("session-cache-miss");
    const harness = await mountHarness({
      session,
      showThinkingMessages: true,
      shouldPauseDerivation: false,
    });

    expect(harness.getLatest().transcriptState.rows).toEqual([]);
    expect(harness.getLatest().isTranscriptRowsMissing).toBe(true);

    await flushTranscriptDerivation();

    expect(harness.getLatest().transcriptState.rows.length).toBeGreaterThan(0);
    expect(harness.getLatest().hasCurrentRowsForActiveSession).toBe(true);
    await harness.unmount();
  });

  test("discards stale derivation after switching sessions before queued work runs", async () => {
    const firstSession = createLargeSession("session-stale-a");
    const secondSession = createLargeSession("session-stale-b");
    const harness = await mountHarness({
      session: firstSession,
      showThinkingMessages: true,
      shouldPauseDerivation: false,
    });

    await harness.update({
      session: secondSession,
      showThinkingMessages: true,
      shouldPauseDerivation: false,
    });
    await flushTranscriptDerivation();

    const rowKeys = harness.getLatest().transcriptState.rows.map((row) => row.key);
    expect(rowKeys.length).toBeGreaterThan(0);
    expect(rowKeys.every((key) => key.startsWith("session-stale-b:"))).toBe(true);
    await harness.unmount();
  });

  test("continues in-flight derivation across unrelated same-revision session updates", async () => {
    const session = createLargeSession("session-same-revision");
    const harness = await mountHarness({
      session,
      showThinkingMessages: true,
      shouldPauseDerivation: false,
    });

    await harness.update({
      session: {
        ...session,
        pendingQuestions: [buildQuestionRequest({ requestId: "question-same-revision" })],
      },
      showThinkingMessages: true,
      shouldPauseDerivation: false,
    });
    await flushTranscriptDerivation();

    expect(harness.getLatest().transcriptState.rows.length).toBeGreaterThan(0);
    expect(harness.getLatest().hasCurrentRowsForActiveSession).toBe(true);
    await harness.unmount();
  });

  test("keeps active-session rows visible while an updated transcript revision is deriving", async () => {
    const messages = Array.from({ length: 160 }, (_, index) =>
      buildMessage("user", `Message ${index + 1}`, { id: `message-${index + 1}` }),
    );
    const session = buildSession({
      externalSessionId: "session-active-update",
      messages: createSessionMessagesState("session-active-update", messages, 1),
    });
    const harness = await mountHarness({
      session,
      showThinkingMessages: true,
      shouldPauseDerivation: false,
    });
    await flushTranscriptDerivation();
    const resolvedRows = harness.getLatest().transcriptState.rows;

    await harness.update({
      session: buildSession({
        ...session,
        messages: createSessionMessagesState(
          "session-active-update",
          [...messages, buildMessage("assistant", "Follow-up", { id: "assistant-follow-up" })],
          2,
        ),
      }),
      showThinkingMessages: true,
      shouldPauseDerivation: false,
    });

    expect(harness.getLatest().transcriptState.rows).toBe(resolvedRows);
    expect(harness.getLatest().isTranscriptRowsPending).toBe(true);
    await harness.unmount();
  });

  test("reuses cached rows when switching back to an equivalent SessionMessagesState", async () => {
    const messages = Array.from({ length: 160 }, (_, index) =>
      buildMessage(index % 2 === 0 ? "user" : "assistant", `Message ${index + 1}`, {
        id: `message-${index + 1}`,
      }),
    );
    const firstSession = buildSession({
      externalSessionId: "session-cache-reuse",
      messages: createSessionMessagesState("session-cache-reuse", messages, 1),
    });
    const secondSession = createLargeSession("session-cache-reuse-other");
    const harness = await mountHarness({
      session: firstSession,
      showThinkingMessages: true,
      shouldPauseDerivation: false,
    });
    await flushTranscriptDerivation();
    const cachedRows = harness.getLatest().transcriptState.rows;

    await harness.update({
      session: secondSession,
      showThinkingMessages: true,
      shouldPauseDerivation: false,
    });
    await flushTranscriptDerivation();
    await harness.update({
      session: buildSession({
        ...firstSession,
        messages: createSessionMessagesState("session-cache-reuse", messages, 1),
      }),
      showThinkingMessages: true,
      shouldPauseDerivation: false,
    });

    expect(harness.getLatest().transcriptState.rows).toBe(cachedRows);
    expect(harness.getLatest().hasCurrentRowsForActiveSession).toBe(true);
    await harness.unmount();
  });

  test("detects same-array same-count raw message mutation on session object replacement", async () => {
    const messages = [buildMessage("assistant", "Before", { id: "assistant-1" })];
    const session = buildSession({
      externalSessionId: "session-raw-replacement",
      messages,
    });
    const harness = await mountHarness({
      session,
      showThinkingMessages: true,
      shouldPauseDerivation: false,
    });
    expect(harness.getLatest().transcriptState.rows[1]?.kind).toBe("message");

    messages[0] = buildMessage("assistant", "After", { id: "assistant-1" });

    await harness.update({
      session: buildSession({
        ...session,
        messages,
      }),
      showThinkingMessages: true,
      shouldPauseDerivation: false,
    });
    await flushTranscriptDerivation();

    const messageRow = harness
      .getLatest()
      .transcriptState.rows.find((row) => row.kind === "message");
    expect(messageRow?.kind === "message" ? messageRow.message.content : null).toBe("After");
    await harness.unmount();
  });
});

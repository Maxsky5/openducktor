import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { createSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import { createAnimationFrameTestDriver } from "@/test-utils/animation-frame-test-driver";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentChatThreadSession } from "./agent-chat.types";
import { buildMessage, buildSession } from "./agent-chat-test-fixtures";
import { useAgentChatTranscriptModel } from "./use-agent-chat-transcript-model";

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;

type HarnessProps = {
  session: AgentChatThreadSession | null;
  showThinkingMessages: boolean;
};

type HookResult = ReturnType<typeof useAgentChatTranscriptModel>;

const animationFrameDriver = createAnimationFrameTestDriver();

const flushTranscriptDerivation = async (
  isDone: () => boolean,
  { timeoutMs }: { timeoutMs: number },
): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await animationFrameDriver.flushFrames();
    await animationFrameDriver.flushTimers(1);
    if (isDone()) {
      return;
    }
  }

  throw new Error("Timed out waiting for transcript row derivation.");
};

const createLargeSession = (
  externalSessionId: string,
  messageCount = 500,
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
    (nextProps: HarnessProps): HookResult => useAgentChatTranscriptModel(nextProps),
    props,
  );

  await harness.mount();
  return harness;
};

describe("useAgentChatTranscriptModel", () => {
  beforeEach(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    animationFrameDriver.install();
  });

  afterEach(() => {
    animationFrameDriver.restore();
    if (previousActEnvironment === undefined) {
      delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
      return;
    }
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  test("starts cache-miss sessions with lightweight rows until post-paint derivation completes", async () => {
    const session = createLargeSession("session-cache-miss");
    const harness = await mountHarness({
      session,
      showThinkingMessages: true,
    });

    expect(harness.getLatest().transcriptState.rows).toEqual([]);
    expect(harness.getLatest().isTranscriptModelMissing).toBe(true);

    await flushTranscriptDerivation(() => harness.getLatest().hasCurrentRowsForActiveSession, {
      timeoutMs: 1_000,
    });

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
    });

    await harness.update({
      session: secondSession,
      showThinkingMessages: true,
    });
    await flushTranscriptDerivation(() => harness.getLatest().hasCurrentRowsForActiveSession, {
      timeoutMs: 1_000,
    });

    const rowKeys = harness.getLatest().transcriptState.rows.map((row) => row.key);
    const secondSessionKey = agentSessionIdentityKey(secondSession);
    expect(rowKeys.length).toBeGreaterThan(0);
    expect(rowKeys.every((key) => key.startsWith(`${secondSessionKey}:`))).toBe(true);
    await harness.unmount();
  });

  test("continues in-flight derivation across unrelated same-revision session updates", async () => {
    const session = createLargeSession("session-same-revision");
    const harness = await mountHarness({
      session,
      showThinkingMessages: true,
    });

    await harness.update({
      session: {
        ...session,
        title: "Updated title with the same transcript revision",
      },
      showThinkingMessages: true,
    });
    await flushTranscriptDerivation(() => harness.getLatest().hasCurrentRowsForActiveSession, {
      timeoutMs: 1_000,
    });

    expect(harness.getLatest().transcriptState.rows.length).toBeGreaterThan(0);
    expect(harness.getLatest().hasCurrentRowsForActiveSession).toBe(true);
    await harness.unmount();
  });

  test("updates a large running session tail append immediately without waiting for derivation", async () => {
    const session = createLargeSession("session-tail-append");
    const harness = await mountHarness({
      session,
      showThinkingMessages: true,
    });
    await flushTranscriptDerivation(() => harness.getLatest().hasCurrentRowsForActiveSession, {
      timeoutMs: 1_000,
    });
    const prefixRow = harness.getLatest().transcriptState.rows[0];

    const nextSession = buildSession({
      ...session,
      messages: createSessionMessagesState(
        "session-tail-append",
        [
          ...session.messages.items,
          buildMessage("assistant", "Follow-up", { id: "assistant-new" }),
        ],
        session.messages.version + 1,
      ),
    });
    await harness.update({
      session: nextSession,
      showThinkingMessages: true,
    });

    const latest = harness.getLatest();
    expect(latest.hasCurrentRowsForActiveSession).toBe(true);
    expect(latest.isTranscriptModelPending).toBe(false);
    expect(latest.transcriptState.rows[0]).toBe(prefixRow);
    expect(
      latest.transcriptState.rows.some(
        (row) => row.kind === "message" && row.message.id === "assistant-new",
      ),
    ).toBe(true);
    await harness.unmount();
  });

  test("tail append with a duplicate message id preserves the existing prefix", async () => {
    const session = createLargeSession("session-tail-append-duplicate-id");
    const harness = await mountHarness({
      session,
      showThinkingMessages: true,
    });
    await flushTranscriptDerivation(() => harness.getLatest().hasCurrentRowsForActiveSession, {
      timeoutMs: 1_000,
    });
    const previousRows = harness.getLatest().transcriptState.rows;
    const prefixRow = previousRows[0];
    const previousRowCount = previousRows.length;

    await harness.update({
      session: buildSession({
        ...session,
        messages: createSessionMessagesState(
          "session-tail-append-duplicate-id",
          [
            ...session.messages.items,
            buildMessage("assistant", "Duplicate id tail", {
              id: "assistant-0",
              meta: { kind: "assistant", isFinal: false },
            }),
          ],
          session.messages.version + 1,
        ),
      }),
      showThinkingMessages: true,
    });

    const latestRows = harness.getLatest().transcriptState.rows;
    expect(harness.getLatest().hasCurrentRowsForActiveSession).toBe(true);
    expect(latestRows[0]).toBe(prefixRow);
    expect(latestRows).toHaveLength(previousRowCount + 1);
    const tailRow = latestRows.at(-1);
    expect(tailRow?.kind === "message" ? tailRow.message.content : null).toBe("Duplicate id tail");
    await harness.unmount();
  });

  test("finalizes a large running session streaming assistant tail update immediately", async () => {
    const baseSession = createLargeSession("session-tail-finalize");
    const streamingAssistant = buildMessage("assistant", "Streaming", {
      id: "assistant-streaming",
      meta: { kind: "assistant", isFinal: false, agentRole: "build" },
    });
    const session = buildSession({
      ...baseSession,
      messages: createSessionMessagesState(
        "session-tail-finalize",
        [...baseSession.messages.items, streamingAssistant],
        2,
      ),
    });
    const harness = await mountHarness({
      session,
      showThinkingMessages: true,
    });
    await flushTranscriptDerivation(() => harness.getLatest().hasCurrentRowsForActiveSession, {
      timeoutMs: 1_000,
    });
    const prefixRow = harness.getLatest().transcriptState.rows[0];
    expect(harness.getLatest().transcriptState.activeStreamingAssistantMessageId).toBe(
      "assistant-streaming",
    );

    const finalizedAssistant = buildMessage("assistant", "Done", {
      id: "assistant-streaming",
      meta: { kind: "assistant", isFinal: true, agentRole: "build", durationMs: 4_000 },
    });
    await harness.update({
      session: buildSession({
        ...session,
        messages: createSessionMessagesState(
          "session-tail-finalize",
          [...baseSession.messages.items, finalizedAssistant],
          3,
        ),
      }),
      showThinkingMessages: true,
    });

    const latest = harness.getLatest();
    expect(latest.hasCurrentRowsForActiveSession).toBe(true);
    expect(latest.isTranscriptModelPending).toBe(false);
    expect(latest.transcriptState.rows[0]).toBe(prefixRow);
    expect(latest.transcriptState.activeStreamingAssistantMessageId).toBeNull();
    expect(
      latest.transcriptState.rows.some(
        (row) => row.kind === "turn_duration" && row.durationMs === 4_000,
      ),
    ).toBe(true);
    await harness.unmount();
  });

  test("does not use stale prefix metadata for a shrinking assistant replacement", async () => {
    const firstUserMessage = buildMessage("user", "Attached context", {
      id: "user-with-attachment",
      meta: {
        kind: "user",
        state: "read",
        parts: [
          {
            kind: "attachment",
            attachment: {
              id: "attachment-1",
              kind: "pdf",
              mime: "text/plain",
              name: "context.txt",
              path: "/tmp/context.txt",
            },
          },
        ],
      },
    });
    const previousMessages = [
      firstUserMessage,
      ...Array.from({ length: 499 }, (_, index) =>
        buildMessage("assistant", `Previous ${index + 1}`, {
          id: `assistant-${index + 1}`,
          meta: { kind: "assistant", isFinal: false },
        }),
      ),
    ];
    const session = buildSession({
      externalSessionId: "session-shrink-assistant-replacement",
      messages: createSessionMessagesState(
        "session-shrink-assistant-replacement",
        previousMessages,
        1,
      ),
    });
    const harness = await mountHarness({
      session,
      showThinkingMessages: true,
    });
    await flushTranscriptDerivation(() => harness.getLatest().hasCurrentRowsForActiveSession, {
      timeoutMs: 1_000,
    });
    expect(harness.getLatest().transcriptState.hasAttachmentMessages).toBe(true);
    expect(harness.getLatest().transcriptState.lastUserMessageKey).toBe(
      `${agentSessionIdentityKey(session)}:0:user-with-attachment`,
    );

    const nextMessages = Array.from({ length: 50 }, (_, index) =>
      buildMessage("assistant", `Current ${index + 1}`, {
        id: `current-assistant-${index + 1}`,
        meta: { kind: "assistant", isFinal: false },
      }),
    );
    await harness.update({
      session: buildSession({
        ...session,
        messages: createSessionMessagesState(
          "session-shrink-assistant-replacement",
          nextMessages,
          2,
        ),
      }),
      showThinkingMessages: true,
    });

    const latest = harness.getLatest();
    expect(latest.hasCurrentRowsForActiveSession).toBe(true);
    expect(latest.transcriptState.hasAttachmentMessages).toBe(false);
    expect(latest.transcriptState.lastUserMessageKey).toBeNull();
    expect(latest.transcriptState.rows).toHaveLength(50);
    await harness.unmount();
  });

  test("keeps active-session rows visible while a non-tail transcript revision is deriving", async () => {
    const messages = Array.from({ length: 500 }, (_, index) =>
      buildMessage("user", `Message ${index + 1}`, { id: `message-${index + 1}` }),
    );
    const session = buildSession({
      externalSessionId: "session-active-update",
      messages: createSessionMessagesState("session-active-update", messages, 1),
    });
    const harness = await mountHarness({
      session,
      showThinkingMessages: true,
    });
    await flushTranscriptDerivation(() => harness.getLatest().hasCurrentRowsForActiveSession, {
      timeoutMs: 1_000,
    });
    const resolvedRows = harness.getLatest().transcriptState.rows;

    await harness.update({
      session: buildSession({
        ...session,
        messages: createSessionMessagesState(
          "session-active-update",
          [
            buildMessage("user", "Changed first message", { id: "message-1" }),
            ...messages.slice(1),
          ],
          2,
        ),
      }),
      showThinkingMessages: true,
    });

    expect(harness.getLatest().transcriptState.rows).toBe(resolvedRows);
    expect(harness.getLatest().isTranscriptModelPending).toBe(true);
    await harness.unmount();
  });

  test("falls back to full derivation for earlier change plus assistant tail edit", async () => {
    const messages = Array.from({ length: 500 }, (_, index) => {
      if (index === 499) {
        return buildMessage("assistant", "Streaming", {
          id: "assistant-tail",
          meta: { kind: "assistant", isFinal: false },
        });
      }
      return buildMessage(index % 2 === 0 ? "user" : "assistant", `Message ${index + 1}`, {
        id: `message-${index + 1}`,
      });
    });
    const session = buildSession({
      externalSessionId: "session-earlier-change-tail-edit",
      messages: createSessionMessagesState("session-earlier-change-tail-edit", messages, 1),
    });
    const harness = await mountHarness({ session, showThinkingMessages: true });
    await flushTranscriptDerivation(() => harness.getLatest().hasCurrentRowsForActiveSession, {
      timeoutMs: 1_000,
    });
    const resolvedRows = harness.getLatest().transcriptState.rows;

    const nextMessages = messages.slice();
    nextMessages[10] = buildMessage("user", "Earlier changed", { id: "message-11" });
    nextMessages[499] = buildMessage("assistant", "Tail edited", {
      id: "assistant-tail",
      meta: { kind: "assistant", isFinal: false },
    });
    await harness.update({
      session: buildSession({
        ...session,
        messages: createSessionMessagesState("session-earlier-change-tail-edit", nextMessages, 2),
      }),
      showThinkingMessages: true,
    });

    expect(harness.getLatest().transcriptState.rows).toBe(resolvedRows);
    expect(harness.getLatest().isTranscriptModelPending).toBe(true);

    await flushTranscriptDerivation(() => harness.getLatest().hasCurrentRowsForActiveSession, {
      timeoutMs: 1_000,
    });
    expect(
      harness
        .getLatest()
        .transcriptState.rows.some(
          (row) => row.kind === "message" && row.message.content === "Tail edited",
        ),
    ).toBe(true);
    expect(
      harness
        .getLatest()
        .transcriptState.rows.some(
          (row) => row.kind === "message" && row.message.content === "Earlier changed",
        ),
    ).toBe(true);
    await harness.unmount();
  });

  test("reuses cached rows when switching back to an equivalent SessionMessagesState", async () => {
    const messages = Array.from({ length: 500 }, (_, index) =>
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
    });
    await flushTranscriptDerivation(() => harness.getLatest().hasCurrentRowsForActiveSession, {
      timeoutMs: 1_000,
    });
    const cachedRows = harness.getLatest().transcriptState.rows;

    await harness.update({
      session: secondSession,
      showThinkingMessages: true,
    });
    await flushTranscriptDerivation(() => harness.getLatest().hasCurrentRowsForActiveSession, {
      timeoutMs: 1_000,
    });
    await harness.update({
      session: buildSession({
        ...firstSession,
        messages: createSessionMessagesState("session-cache-reuse", messages, 1),
      }),
      showThinkingMessages: true,
    });

    expect(harness.getLatest().transcriptState.rows).toBe(cachedRows);
    expect(harness.getLatest().hasCurrentRowsForActiveSession).toBe(true);
    await harness.unmount();
  });

  test("publishes cached rows asynchronously when switching back to an unchanged idle session", async () => {
    const firstMessages = Array.from({ length: 500 }, (_, index) =>
      buildMessage(index % 2 === 0 ? "user" : "assistant", `First ${index + 1}`, {
        id: `first-message-${index + 1}`,
      }),
    );
    const firstSession = buildSession({
      externalSessionId: "session-cache-visible-a",
      status: "idle",
      messages: createSessionMessagesState("session-cache-visible-a", firstMessages, 1),
    });
    const secondSession = createLargeSession("session-cache-visible-b");
    const observedStates: HookResult[] = [];
    const Probe = (props: HarnessProps) => {
      observedStates.push(useAgentChatTranscriptModel(props));
      return null;
    };

    const rendered = render(
      createElement(Probe, {
        session: firstSession,
        showThinkingMessages: true,
      }),
    );

    await flushTranscriptDerivation(
      () => Boolean(observedStates.at(-1)?.hasCurrentRowsForActiveSession),
      { timeoutMs: 1_000 },
    );
    const cachedRows = observedStates.at(-1)?.transcriptState.rows;
    expect(cachedRows?.length).toBeGreaterThan(0);

    rendered.rerender(
      createElement(Probe, {
        session: secondSession,
        showThinkingMessages: true,
      }),
    );
    await flushTranscriptDerivation(
      () => Boolean(observedStates.at(-1)?.hasCurrentRowsForActiveSession),
      { timeoutMs: 1_000 },
    );

    const observationsBeforeSwitchBack = observedStates.length;
    rendered.rerender(
      createElement(Probe, {
        session: buildSession({
          ...firstSession,
          messages: createSessionMessagesState("session-cache-visible-a", firstMessages, 1),
        }),
        showThinkingMessages: true,
      }),
    );

    const firstRenderAfterSwitchBack = observedStates[observationsBeforeSwitchBack];
    expect(firstRenderAfterSwitchBack?.transcriptState.rows).toEqual([]);
    expect(firstRenderAfterSwitchBack?.isTranscriptModelMissing).toBe(true);

    await flushTranscriptDerivation(
      () => Boolean(observedStates.at(-1)?.hasCurrentRowsForActiveSession),
      { timeoutMs: 1_000 },
    );
    expect(observedStates.at(-1)?.transcriptState.rows).toBe(cachedRows);
    expect(observedStates.at(-1)?.isTranscriptModelMissing).toBe(false);

    rendered.unmount();
  });

  test("updates rows when the session receives a new message state", async () => {
    const session = buildSession({
      externalSessionId: "session-state-replacement",
      messages: createSessionMessagesState("session-state-replacement", [
        buildMessage("assistant", "Before", { id: "assistant-1" }),
      ]),
    });
    const harness = await mountHarness({
      session,
      showThinkingMessages: true,
    });
    expect(harness.getLatest().transcriptState.rows[1]?.kind).toBe("message");

    await harness.update({
      session: buildSession({
        ...session,
        messages: createSessionMessagesState(
          "session-state-replacement",
          [buildMessage("assistant", "After", { id: "assistant-1" })],
          session.messages.version + 1,
        ),
      }),
      showThinkingMessages: true,
    });
    await flushTranscriptDerivation(() => harness.getLatest().hasCurrentRowsForActiveSession, {
      timeoutMs: 1_000,
    });

    const messageRow = harness
      .getLatest()
      .transcriptState.rows.find((row) => row.kind === "message");
    expect(messageRow?.kind === "message" ? messageRow.message.content : null).toBe("After");
    await harness.unmount();
  });
});

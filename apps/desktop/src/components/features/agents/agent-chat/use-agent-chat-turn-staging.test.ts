import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentChatWindowTurn } from "./agent-chat-thread-windowing";
import { useAgentChatTurnStaging } from "./use-agent-chat-turn-staging";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const buildTurns = (count: number): AgentChatWindowTurn[] =>
  Array.from({ length: count }, (_, index) => ({
    key: `turn-${index}`,
    start: index * 2,
    end: index * 2 + 1,
    rows: [],
  }));

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("useAgentChatTurnStaging", () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const animationFrameCallbacks = new Map<number, FrameRequestCallback>();
  let nextAnimationFrameId = 1;

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
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  test("shows only the latest turn first when history is windowed", async () => {
    const turns = buildTurns(6);
    const harness = createHookHarness(
      ({ activeSessionId, windowStart, nextTurns }) =>
        useAgentChatTurnStaging({
          activeSessionId,
          windowStart,
          turns: nextTurns,
          disabled: false,
        }),
      {
        activeSessionId: "session-1",
        windowStart: 10,
        nextTurns: turns,
      },
    );

    await harness.mount();

    expect(harness.getLatest().map((turn: AgentChatWindowTurn) => turn.key)).toEqual(["turn-5"]);

    await act(async () => {
      while (animationFrameCallbacks.size > 0) {
        const queuedCallbacks = Array.from(animationFrameCallbacks.values());
        animationFrameCallbacks.clear();
        for (const callback of queuedCallbacks) {
          callback(16);
        }
        await flush();
      }
    });

    expect(harness.getLatest().map((turn: AgentChatWindowTurn) => turn.key)).toEqual(
      turns.map((turn) => turn.key),
    );

    await harness.unmount();
  });

  test("does not restage once a session has completed staging", async () => {
    const turns = buildTurns(6);
    const harness = createHookHarness(
      ({ activeSessionId, windowStart, nextTurns }) =>
        useAgentChatTurnStaging({
          activeSessionId,
          windowStart,
          turns: nextTurns,
          disabled: false,
        }),
      {
        activeSessionId: "session-1",
        windowStart: 10,
        nextTurns: turns,
      },
    );

    await harness.mount();

    await act(async () => {
      while (animationFrameCallbacks.size > 0) {
        const queuedCallbacks = Array.from(animationFrameCallbacks.values());
        animationFrameCallbacks.clear();
        for (const callback of queuedCallbacks) {
          callback(16);
        }
        await flush();
      }
    });

    const expandedTurns = buildTurns(8);
    await harness.update({
      activeSessionId: "session-1",
      windowStart: 12,
      nextTurns: expandedTurns,
    });

    expect(harness.getLatest().map((turn: AgentChatWindowTurn) => turn.key)).toEqual(
      expandedTurns.map((turn) => turn.key),
    );

    await harness.unmount();
  });

  test("returns all turns immediately when staging is disabled", async () => {
    const turns = buildTurns(6);
    const harness = createHookHarness(
      ({ activeSessionId, windowStart, nextTurns, disabled }) =>
        useAgentChatTurnStaging({
          activeSessionId,
          windowStart,
          turns: nextTurns,
          disabled,
        }),
      {
        activeSessionId: "session-1",
        windowStart: 10,
        nextTurns: turns,
        disabled: true,
      },
    );

    await harness.mount();

    expect(harness.getLatest().map((turn: AgentChatWindowTurn) => turn.key)).toEqual(
      turns.map((turn) => turn.key),
    );
    expect(animationFrameCallbacks.size).toBe(0);

    await harness.unmount();
  });
});

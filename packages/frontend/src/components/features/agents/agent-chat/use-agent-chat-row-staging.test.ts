import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act } from "react";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentChatWindowRow, AgentChatWindowTurn } from "./agent-chat-thread-windowing";
import { useAgentChatRowStaging } from "./use-agent-chat-row-staging";

const reactActGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const buildRows = (count: number, externalSessionId = "session-1"): AgentChatWindowRow[] =>
  Array.from({ length: count }, (_, index) => ({
    kind: "message" as const,
    key: `${externalSessionId}:row-${index}`,
    message: {
      id: `row-${index}`,
      role: "assistant" as const,
      content: `Row ${index}`,
      timestamp: "2026-04-21T12:00:00.000Z",
    },
  }));

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("useAgentChatRowStaging", () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const animationFrameCallbacks = new Map<number, FrameRequestCallback>();
  let nextAnimationFrameId = 1;
  let originalIsReactActEnvironment: boolean | undefined;

  beforeEach(() => {
    originalIsReactActEnvironment = reactActGlobal.IS_REACT_ACT_ENVIRONMENT;
    reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true;
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
    if (typeof originalIsReactActEnvironment === "undefined") {
      delete reactActGlobal.IS_REACT_ACT_ENVIRONMENT;
    } else {
      reactActGlobal.IS_REACT_ACT_ENVIRONMENT = originalIsReactActEnvironment;
    }
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  test("shows only the latest rows first for a large single-turn transcript", async () => {
    const rows = buildRows(80);
    const turns: AgentChatWindowTurn[] = [{ key: "turn-0", start: 0, end: 79 }];
    const harness = createHookHarness(
      ({ activeExternalSessionId, nextRows, nextTurns }) =>
        useAgentChatRowStaging({
          activeExternalSessionId,
          rows: nextRows,
          turns: nextTurns,
          disabled: false,
        }),
      {
        activeExternalSessionId: "session-1",
        nextRows: rows,
        nextTurns: turns,
      },
    );

    await harness.mount();

    expect(harness.getLatest().rows).toHaveLength(8);
    expect(harness.getLatest().turns).toEqual([{ key: "turn-0", start: 0, end: 7 }]);

    await harness.unmount();
  });

  test("stages rows again when revisiting a session", async () => {
    const rows = buildRows(80);
    const turns: AgentChatWindowTurn[] = [{ key: "turn-0", start: 0, end: 79 }];
    const harness = createHookHarness(
      ({ activeExternalSessionId, nextRows, nextTurns }) =>
        useAgentChatRowStaging({
          activeExternalSessionId,
          rows: nextRows,
          turns: nextTurns,
          disabled: false,
        }),
      {
        activeExternalSessionId: "session-a",
        nextRows: rows,
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

    await harness.update({
      activeExternalSessionId: "session-b",
      nextRows: buildRows(12, "session-b"),
      nextTurns: [{ key: "turn-b", start: 0, end: 11 }],
    });

    await harness.update({
      activeExternalSessionId: "session-a",
      nextRows: rows,
      nextTurns: turns,
    });

    expect(harness.getLatest().rows).toHaveLength(8);
    expect(animationFrameCallbacks.size).toBeGreaterThan(0);

    await harness.unmount();
  });

  test("resumes staging when rows grow for the active session", async () => {
    const onBeforePrepend = mock(() => {});
    const harness = createHookHarness(
      ({ activeExternalSessionId, nextRows, nextTurns }) =>
        useAgentChatRowStaging({
          activeExternalSessionId,
          rows: nextRows,
          turns: nextTurns,
          disabled: false,
          onBeforePrepend,
        }),
      {
        activeExternalSessionId: "session-1",
        nextRows: buildRows(80),
        nextTurns: [{ key: "turn-0", start: 0, end: 79 }],
      },
    );

    await harness.mount();

    await act(async () => {
      const callback = animationFrameCallbacks.values().next().value;
      animationFrameCallbacks.clear();
      callback?.(16);
      await flush();
    });

    expect(harness.getLatest().rows).toHaveLength(16);
    expect(onBeforePrepend).toHaveBeenCalledTimes(1);

    await harness.update({
      activeExternalSessionId: "session-1",
      nextRows: buildRows(96),
      nextTurns: [{ key: "turn-0", start: 0, end: 95 }],
    });

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

    expect(harness.getLatest().rows).toHaveLength(96);
    expect(harness.getLatest().turns).toEqual([{ key: "turn-0", start: 0, end: 95 }]);

    await harness.unmount();
  });

  test("returns all rows immediately when a small active transcript grows", async () => {
    const harness = createHookHarness(
      ({ activeExternalSessionId, nextRows, nextTurns }) =>
        useAgentChatRowStaging({
          activeExternalSessionId,
          rows: nextRows,
          turns: nextTurns,
          disabled: false,
        }),
      {
        activeExternalSessionId: "session-1",
        nextRows: buildRows(1),
        nextTurns: [{ key: "turn-0", start: 0, end: 0 }],
      },
    );

    await harness.mount();
    await harness.update({
      activeExternalSessionId: "session-1",
      nextRows: buildRows(2),
      nextTurns: [{ key: "turn-0", start: 0, end: 1 }],
    });

    expect(harness.getLatest().rows.map((row: AgentChatWindowRow) => row.key)).toEqual([
      "session-1:row-0",
      "session-1:row-1",
    ]);
    expect(animationFrameCallbacks.size).toBe(0);

    await harness.unmount();
  });
});

import { afterEach, describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import {
  CHAT_AUTOSCROLL_THRESHOLD_PX,
  CHAT_PROGRAMMATIC_AUTOSCROLL_DATASET,
  COMPOSER_TEXTAREA_MAX_HEIGHT_PX,
  COMPOSER_TEXTAREA_MIN_HEIGHT_PX,
  computeComposerTextareaLayout,
  computeTodoPanelBottomOffset,
  isNearBottom,
  resizeComposerTextareaElement,
  scrollMessagesContainerToBottom,
  useAgentChatLayout,
} from "./use-agent-chat-layout";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalResizeObserver = globalThis.ResizeObserver;

describe("use-agent-chat-layout helpers", () => {
  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  test("detects pinned-to-bottom with threshold", () => {
    const element = {
      scrollHeight: 1_000,
      scrollTop: 1_000 - 400 - CHAT_AUTOSCROLL_THRESHOLD_PX + 1,
      clientHeight: 400,
    };
    expect(isNearBottom(element)).toBe(true);
  });

  test("marks not-pinned when distance exceeds threshold", () => {
    const element = {
      scrollHeight: 1_000,
      scrollTop: 1_000 - 400 - CHAT_AUTOSCROLL_THRESHOLD_PX - 10,
      clientHeight: 400,
    };
    expect(isNearBottom(element)).toBe(false);
  });

  test("clamps textarea layout to minimum height", () => {
    expect(computeComposerTextareaLayout(10)).toEqual({
      heightPx: COMPOSER_TEXTAREA_MIN_HEIGHT_PX,
      overflowY: "hidden",
    });
  });

  test("clamps textarea layout to maximum height and enables overflow", () => {
    expect(computeComposerTextareaLayout(COMPOSER_TEXTAREA_MAX_HEIGHT_PX + 120)).toEqual({
      heightPx: COMPOSER_TEXTAREA_MAX_HEIGHT_PX,
      overflowY: "auto",
    });
  });

  test("anchors todo panel with a fixed offset from the thread bottom", () => {
    expect(computeTodoPanelBottomOffset(40)).toBe(12);
    expect(computeTodoPanelBottomOffset(180)).toBe(12);
  });

  test("scrollMessagesContainerToBottom repins the latest rows after layout changes", () => {
    const scrollTo = mock(() => {});
    const container = {
      dataset: {},
      clientHeight: 320,
      scrollHeight: 960,
      scrollTo,
      scrollTop: 40,
    } as unknown as HTMLDivElement;

    scrollMessagesContainerToBottom(container);

    expect(scrollTo).toHaveBeenCalledWith({
      top: 640,
      behavior: "auto",
    });
    expect(container.scrollTop).toBe(640);
    expect(container.dataset[CHAT_PROGRAMMATIC_AUTOSCROLL_DATASET]).toBe("640");
  });

  test("resizeComposerTextareaElement avoids transient collapse when the target height is unchanged", () => {
    const styleState = {
      height: "40px",
      overflowY: "hidden" as const,
    };
    const textarea = {
      getBoundingClientRect: () => ({ height: 40 }),
      scrollHeight: 40,
      style: styleState,
    } as unknown as HTMLTextAreaElement;

    resizeComposerTextareaElement(textarea);

    expect(styleState.height).toBe("44px");
    expect(styleState.overflowY).toBe("hidden");
  });

  test("resizeComposerTextareaElement shrinks the composer when content becomes shorter", () => {
    const styleState = {
      height: "120px",
      overflowY: "hidden" as const,
    };
    const textarea = {
      getBoundingClientRect: () => ({ height: 120 }),
      scrollHeight: 40,
      style: styleState,
    } as unknown as HTMLTextAreaElement;

    resizeComposerTextareaElement(textarea);

    expect(styleState.height).toBe("44px");
    expect(styleState.overflowY).toBe("hidden");
  });

  test("repins when active session changes", async () => {
    let latest: unknown = null;

    const Harness = ({ activeSessionId }: { activeSessionId: string | null }) => {
      latest = useAgentChatLayout({
        input: "",
        activeSessionId,
      });
      return null;
    };

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(createElement(Harness, { activeSessionId: "session-1" }));
      await Promise.resolve();
    });

    await act(async () => {
      const state = latest as ReturnType<typeof useAgentChatLayout> | null;
      if (!state) {
        throw new Error("Hook state unavailable");
      }
      state.setIsPinnedToBottom(false);
      await Promise.resolve();
    });

    const stateAfterPinUpdate = latest as ReturnType<typeof useAgentChatLayout> | null;
    if (!stateAfterPinUpdate) {
      throw new Error("Hook state unavailable");
    }
    expect(stateAfterPinUpdate.isPinnedToBottom).toBe(false);

    await act(async () => {
      renderer.update(createElement(Harness, { activeSessionId: "session-2" }));
      await Promise.resolve();
    });

    const stateAfterSessionSwitch = latest as ReturnType<typeof useAgentChatLayout> | null;
    if (!stateAfterSessionSwitch) {
      throw new Error("Hook state unavailable");
    }
    expect(stateAfterSessionSwitch.isPinnedToBottom).toBe(true);

    await act(async () => {
      renderer.unmount();
      await Promise.resolve();
    });
  });
});

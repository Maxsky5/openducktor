import { afterEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import {
  COMPOSER_TEXTAREA_MAX_HEIGHT_PX,
  COMPOSER_TEXTAREA_MIN_HEIGHT_PX,
  computeComposerTextareaLayout,
  computeTodoPanelBottomOffset,
  resizeComposerTextareaElement,
  useAgentChatLayout,
} from "./use-agent-chat-layout";

type LayoutHookState = {
  messagesContainerRef: { current: HTMLDivElement | null };
  composerFormRef: { current: HTMLFormElement | null };
  composerTextareaRef: { current: HTMLTextAreaElement | null };
  todoPanelBottomOffset: number;
  resizeComposerTextarea: () => void;
};

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

  test("returns stable refs and offset state for the layout hook", async () => {
    const latestRef: { current: LayoutHookState | null } = { current: null };

    const Harness = ({
      activeSessionId,
      input,
    }: {
      activeSessionId: string | null;
      input: string;
    }) => {
      latestRef.current = useAgentChatLayout({ activeSessionId, input });
      return null;
    };

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(Harness, { activeSessionId: "session-1", input: "" }),
      );
      await Promise.resolve();
    });

    const initialState = latestRef.current;
    if (!initialState) {
      throw new Error("Hook state unavailable");
    }

    expect(initialState.todoPanelBottomOffset).toBe(12);
    expect(initialState.messagesContainerRef.current).toBeNull();
    expect(initialState.composerFormRef.current).toBeNull();
    expect(initialState.composerTextareaRef.current).toBeNull();
    expect(typeof initialState.resizeComposerTextarea).toBe("function");

    await act(async () => {
      renderer.update(createElement(Harness, { activeSessionId: "session-2", input: "draft" }));
      await Promise.resolve();
    });

    const updatedState = latestRef.current;
    if (!updatedState) {
      throw new Error("Hook state unavailable");
    }

    expect(updatedState.todoPanelBottomOffset).toBe(12);

    await act(async () => {
      renderer.unmount();
      await Promise.resolve();
    });
  });
});

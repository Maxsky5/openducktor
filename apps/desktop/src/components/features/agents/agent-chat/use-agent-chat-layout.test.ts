import { describe, expect, test } from "bun:test";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import {
  COMPOSER_TEXTAREA_MAX_HEIGHT_PX,
  COMPOSER_TEXTAREA_MIN_HEIGHT_PX,
  computeComposerTextareaLayout,
  resizeComposerTextareaElement,
  useAgentChatLayout,
} from "./use-agent-chat-layout";

type LayoutHookState = {
  messagesContainerRef: { current: HTMLDivElement | null };
  composerFormRef: { current: HTMLFormElement | null };
  composerTextareaRef: { current: HTMLTextAreaElement | null };
  resizeComposerTextarea: () => void;
};

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("use-agent-chat-layout helpers", () => {
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

  test("resizeComposerTextareaElement avoids transient collapse when the target height is unchanged", () => {
    const styleState = {
      height: "40px",
      overflowY: "hidden" as const,
    };
    const textarea = {
      getBoundingClientRect: () => ({ height: 40 }),
      scrollHeight: 40,
      style: styleState,
      value: "draft",
    } as unknown as HTMLTextAreaElement;

    resizeComposerTextareaElement(textarea);

    expect(styleState.height).toBe("44px");
    expect(styleState.overflowY).toBe("hidden");
  });

  test("resizeComposerTextareaElement restores multiline height after measurement when the layout is unchanged", () => {
    const styleState = {
      height: "120px",
      overflowY: "hidden" as "auto" | "hidden",
    };
    const assignedHeights: string[] = [];
    const assignedOverflowValues: Array<"auto" | "hidden"> = [];
    const style = {} as CSSStyleDeclaration;

    Object.defineProperty(style, "height", {
      configurable: true,
      get: () => styleState.height,
      set: (value: string) => {
        assignedHeights.push(value);
        styleState.height = value;
      },
    });
    Object.defineProperty(style, "overflowY", {
      configurable: true,
      get: () => styleState.overflowY,
      set: (value: "auto" | "hidden") => {
        assignedOverflowValues.push(value);
        styleState.overflowY = value;
      },
    });

    const textarea = {
      getBoundingClientRect: () => ({ height: 120 }),
      style,
      value: "line one\nline two",
      get scrollHeight() {
        return 120;
      },
    } as unknown as HTMLTextAreaElement;

    const result = resizeComposerTextareaElement(textarea);

    expect(result).toEqual({
      didHeightChange: false,
      overflowY: "hidden",
    });
    expect(assignedHeights).toEqual(["auto", "120px"]);
    expect(assignedOverflowValues).toEqual([]);
  });

  test("resizeComposerTextareaElement shrinks a non-empty multiline draft after browser-faithful remeasure", () => {
    const styleState = {
      height: "120px",
      overflowY: "hidden" as "auto" | "hidden",
    };
    const assignedHeights: string[] = [];
    const style = {} as CSSStyleDeclaration;

    Object.defineProperty(style, "height", {
      configurable: true,
      get: () => styleState.height,
      set: (value: string) => {
        assignedHeights.push(value);
        styleState.height = value;
      },
    });
    Object.defineProperty(style, "overflowY", {
      configurable: true,
      get: () => styleState.overflowY,
      set: (value: "auto" | "hidden") => {
        styleState.overflowY = value;
      },
    });

    const textarea = {
      getBoundingClientRect: () => ({ height: 120 }),
      style,
      value: "draft",
      get scrollHeight() {
        return styleState.height === "auto" ? COMPOSER_TEXTAREA_MIN_HEIGHT_PX : 120;
      },
    } as unknown as HTMLTextAreaElement;

    const result = resizeComposerTextareaElement(textarea);

    expect(result).toEqual({
      didHeightChange: true,
      overflowY: "hidden",
    });
    expect(assignedHeights).toEqual(["auto", "44px"]);
    expect(styleState.height).toBe("44px");
    expect(styleState.overflowY).toBe("hidden");
  });

  test("resizeComposerTextareaElement clamps empty drafts to minimum height", () => {
    const styleState = {
      height: "220px",
      overflowY: "auto" as "auto" | "hidden",
    };
    const textarea = {
      getBoundingClientRect: () => ({ height: 220 }),
      scrollHeight: 220,
      style: styleState,
      value: "",
    } as unknown as HTMLTextAreaElement;

    resizeComposerTextareaElement(textarea);

    expect(styleState.height).toBe("44px");
    expect(styleState.overflowY).toBe("hidden");
  });

  test("returns stable refs for the layout hook", async () => {
    const harness = createSharedHookHarness(
      ({ activeSessionId, input }: { activeSessionId: string | null; input: string }) => {
        return useAgentChatLayout({ activeSessionId, input });
      },
      { activeSessionId: "session-1", input: "" },
    );

    await harness.mount();

    const initialState = harness.getLatest() as LayoutHookState;

    expect(initialState.messagesContainerRef.current).toBeNull();
    expect(initialState.composerFormRef.current).toBeNull();
    expect(initialState.composerTextareaRef.current).toBeNull();
    expect(typeof initialState.resizeComposerTextarea).toBe("function");

    await harness.update({ activeSessionId: "session-2", input: "draft" });

    const updatedState = harness.getLatest() as LayoutHookState;
    expect(updatedState.messagesContainerRef).toBe(initialState.messagesContainerRef);

    await harness.unmount();
  });

  test("resizes only when controlled input value changes", async () => {
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
    const queuedFrameCallbacks: FrameRequestCallback[] = [];

    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      queuedFrameCallbacks.push(callback);
      return queuedFrameCallbacks.length;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((_id: number) => undefined) as typeof cancelAnimationFrame;

    const harness = createSharedHookHarness(
      ({ activeSessionId, input }: { activeSessionId: string | null; input: string }) => {
        return useAgentChatLayout({ activeSessionId, input });
      },
      { activeSessionId: "session-1", input: "" },
    );

    await harness.mount();

    const state = harness.getLatest() as LayoutHookState;
    const styleState = {
      height: "44px",
      overflowY: "hidden" as const,
    };
    const textarea = {
      getBoundingClientRect: () => ({ height: 44 }),
      scrollHeight: 120,
      style: styleState,
      value: "",
    } as unknown as HTMLTextAreaElement;
    state.composerTextareaRef.current = textarea;

    const pendingInitFrames = queuedFrameCallbacks.splice(0);
    for (const callback of pendingInitFrames) {
      callback(0);
    }

    queuedFrameCallbacks.length = 0;
    textarea.value = "line one\nline two";
    await harness.update({ activeSessionId: "session-1", input: "line one\nline two" });

    expect(queuedFrameCallbacks).toHaveLength(1);
    const firstFrame = queuedFrameCallbacks.shift();
    if (!firstFrame) {
      throw new Error("Expected queued frame callback");
    }
    firstFrame(0);
    expect(styleState.height).toBe("120px");

    queuedFrameCallbacks.length = 0;
    await harness.update({ activeSessionId: "session-1", input: "line one\nline two" });
    expect(queuedFrameCallbacks).toHaveLength(0);

    Object.assign(textarea, {
      value: "",
      scrollHeight: 20,
    });
    await harness.update({ activeSessionId: "session-1", input: "" });
    expect(queuedFrameCallbacks).toHaveLength(1);

    const secondFrame = queuedFrameCallbacks.shift();
    if (!secondFrame) {
      throw new Error("Expected queued frame callback");
    }
    secondFrame(16);
    expect(styleState.height).toBe("44px");

    await harness.unmount();
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  test("initializes textarea height when ref becomes available after first mount", async () => {
    const harness = createSharedHookHarness(
      ({ activeSessionId, input }: { activeSessionId: string | null; input: string }) => {
        return useAgentChatLayout({ activeSessionId, input });
      },
      { activeSessionId: "session-1", input: "" },
    );

    await harness.mount();

    const state = harness.getLatest() as LayoutHookState;
    const styleState = {
      height: "220px",
      overflowY: "hidden" as const,
    };
    const textarea = {
      getBoundingClientRect: () => ({ height: 220 }),
      scrollHeight: 44,
      style: styleState,
      value: "",
    } as unknown as HTMLTextAreaElement;

    state.composerTextareaRef.current = textarea;
    await harness.update({ activeSessionId: "session-1", input: "" });

    expect(styleState.height).toBe("44px");

    await harness.unmount();
  });
});

import { describe, expect, test } from "bun:test";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import {
  COMPOSER_EDITOR_MIN_HEIGHT_PX,
  COMPOSER_TEXTAREA_MAX_HEIGHT_PX,
  COMPOSER_TEXTAREA_MIN_HEIGHT_PX,
  computeComposerTextareaLayout,
  resizeComposerEditorElement,
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

  test("resizeComposerTextareaElement keeps multiline height stable when the layout is unchanged", () => {
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

  test("resizeComposerEditorElement detects native multiline growth from the last synced height", () => {
    const styleState = {
      height: "",
      overflowY: "hidden" as "auto" | "hidden",
    };
    const style = {} as CSSStyleDeclaration;

    Object.defineProperty(style, "height", {
      configurable: true,
      get: () => styleState.height,
      set: (value: string) => {
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

    const editor = {
      getBoundingClientRect: () => ({ height: 120 }),
      scrollHeight: 120,
      style,
      textContent: "line one\nline two",
    } as unknown as HTMLDivElement;

    const result = resizeComposerEditorElement(editor, undefined, COMPOSER_EDITOR_MIN_HEIGHT_PX);

    expect(result).toEqual({
      didHeightChange: true,
      overflowY: "hidden",
    });
    expect(styleState.height).toBe("120px");
  });

  test("resizeComposerTextareaElement shrinks when content height decreases", () => {
    const styleState = {
      height: "120px",
      overflowY: "hidden" as "auto" | "hidden",
    };
    const style = {} as CSSStyleDeclaration;

    Object.defineProperty(style, "height", {
      configurable: true,
      get: () => styleState.height,
      set: (value: string) => {
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
      value: "short",
      get scrollHeight() {
        return styleState.height === "auto" ? COMPOSER_TEXTAREA_MIN_HEIGHT_PX : 120;
      },
    } as unknown as HTMLTextAreaElement;

    const result = resizeComposerTextareaElement(textarea);

    expect(result).toEqual({
      didHeightChange: true,
      overflowY: "hidden",
    });
    expect(styleState.height).toBe(`${COMPOSER_TEXTAREA_MIN_HEIGHT_PX}px`);
  });

  test("resizeComposerTextareaElement preserves height when the editor already reports the target size", () => {
    const styleState = {
      height: "120px",
      overflowY: "hidden" as "auto" | "hidden",
    };
    const assignedHeights: string[] = [];
    const style = {} as CSSStyleDeclaration;
    const measurementClone = {
      style: {} as CSSStyleDeclaration,
      scrollHeight: COMPOSER_TEXTAREA_MIN_HEIGHT_PX,
      value: "",
      rows: 1,
      setAttribute: () => {},
      remove: () => {},
    } as unknown as HTMLTextAreaElement;

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
      cloneNode: () => measurementClone,
      getBoundingClientRect: () => ({ height: 120, width: 320 }),
      ownerDocument: {
        body: {
          appendChild: () => {},
        },
        defaultView: {
          getComputedStyle: () =>
            ({
              boxSizing: "border-box",
              fontFamily: "monospace",
              fontSize: "14px",
              fontStyle: "normal",
              fontWeight: "400",
              letterSpacing: "normal",
              lineHeight: "20px",
              paddingTop: "8px",
              paddingRight: "12px",
              paddingBottom: "8px",
              paddingLeft: "12px",
              textIndent: "0px",
              textTransform: "none",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              wordSpacing: "0px",
              overflowWrap: "break-word",
              borderTopWidth: "1px",
              borderRightWidth: "1px",
              borderBottomWidth: "1px",
              borderLeftWidth: "1px",
            }) satisfies Partial<CSSStyleDeclaration>,
        },
      },
      style,
      rows: 1,
      scrollHeight: 120,
      value: "line one\nline two",
    } as unknown as HTMLTextAreaElement;

    const result = resizeComposerTextareaElement(textarea);

    expect(result).toEqual({
      didHeightChange: false,
      overflowY: "hidden",
    });
    expect(assignedHeights).toEqual(["auto", "120px"]);
    expect(styleState.height).toBe("120px");
  });

  test("resizeComposerTextareaElement skips no-op writes for single-line drafts already at min height", () => {
    const styleState = {
      height: "",
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
      getBoundingClientRect: () => ({ height: COMPOSER_TEXTAREA_MIN_HEIGHT_PX }),
      style,
      value: "draft",
      get scrollHeight() {
        return COMPOSER_TEXTAREA_MIN_HEIGHT_PX;
      },
    } as unknown as HTMLTextAreaElement;

    const result = resizeComposerTextareaElement(textarea);

    expect(result).toEqual({
      didHeightChange: false,
      overflowY: "hidden",
    });
    expect(assignedHeights).toEqual(["auto", ""]);
    expect(styleState.height).toBe("");
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

    try {
      globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
        queuedFrameCallbacks.push(callback);
        return queuedFrameCallbacks.length;
      }) as typeof requestAnimationFrame;
      globalThis.cancelAnimationFrame = ((_id: number) => undefined) as typeof cancelAnimationFrame;

      const harness = createSharedHookHarness(
        ({ activeSessionId }: { activeSessionId: string | null }) => {
          return useAgentChatLayout({ activeSessionId });
        },
        { activeSessionId: "session-1" },
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
      state.resizeComposerTextarea();

      expect(queuedFrameCallbacks).toHaveLength(1);
      const firstFrame = queuedFrameCallbacks.shift();
      if (!firstFrame) {
        throw new Error("Expected queued frame callback");
      }
      firstFrame(0);
      expect(styleState.height).toBe("120px");

      queuedFrameCallbacks.length = 0;
      state.resizeComposerTextarea();
      expect(queuedFrameCallbacks).toHaveLength(1);
      const repeatedFrame = queuedFrameCallbacks.shift();
      if (!repeatedFrame) {
        throw new Error("Expected queued frame callback");
      }
      repeatedFrame(8);
      expect(styleState.height).toBe("120px");

      Object.assign(textarea, {
        value: "",
        scrollHeight: 20,
      });
      state.resizeComposerTextarea();
      expect(queuedFrameCallbacks).toHaveLength(1);

      const secondFrame = queuedFrameCallbacks.shift();
      if (!secondFrame) {
        throw new Error("Expected queued frame callback");
      }
      secondFrame(16);
      expect(styleState.height).toBe("44px");

      await harness.unmount();
    } finally {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    }
  });

  test("requests a bottom resync only when composer height changes while the transcript is near bottom", async () => {
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

    try {
      globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      }) as typeof requestAnimationFrame;
      globalThis.cancelAnimationFrame = ((_id: number) => undefined) as typeof cancelAnimationFrame;

      let syncBottomAfterComposerLayoutCallCount = 0;
      const syncBottomAfterComposerLayoutRef = {
        current: () => {
          syncBottomAfterComposerLayoutCallCount += 1;
        },
      } as { current: (() => void) | null };
      const harness = createSharedHookHarness(
        ({ activeSessionId }: { activeSessionId: string | null }) => {
          return useAgentChatLayout({
            activeSessionId,
            syncBottomAfterComposerLayoutRef,
          });
        },
        { activeSessionId: "session-1" },
      );

      await harness.mount();

      const state = harness.getLatest() as LayoutHookState;
      state.messagesContainerRef.current = {
        scrollHeight: 1000,
        scrollTop: 700,
        clientHeight: 300,
      } as HTMLDivElement;

      const styleState = {
        height: "44px",
        overflowY: "hidden" as const,
      };
      const textarea = {
        getBoundingClientRect: () => ({ height: 44 }),
        scrollHeight: 120,
        style: styleState,
        value: "line one\nline two",
      } as unknown as HTMLTextAreaElement;
      state.composerTextareaRef.current = textarea;

      state.resizeComposerTextarea();

      expect(styleState.height).toBe("120px");
      expect(syncBottomAfterComposerLayoutCallCount).toBe(1);

      state.messagesContainerRef.current = {
        scrollHeight: 1000,
        scrollTop: 700,
        clientHeight: 300,
      } as HTMLDivElement;
      Object.assign(textarea, {
        scrollHeight: 120,
        value: "line one\nline tw",
      });

      state.resizeComposerTextarea();

      expect(styleState.height).toBe("120px");
      expect(syncBottomAfterComposerLayoutCallCount).toBe(1);

      await harness.unmount();
    } finally {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    }
  });

  test("initializes textarea height when ref becomes available after first mount", async () => {
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

    try {
      globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
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
      state.resizeComposerTextarea();

      expect(styleState.height).toBe("44px");

      await harness.unmount();
    } finally {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    }
  });
});

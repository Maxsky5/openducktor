import { describe, expect, test } from "bun:test";
import { withAnimationFrameTestDriver } from "@/test-utils/animation-frame-test-driver";
import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import {
  COMPOSER_EDITOR_MAX_HEIGHT_PX,
  COMPOSER_EDITOR_MIN_HEIGHT_PX,
  computeComposerEditorLayout,
  resizeComposerEditorElement,
  resizeComposerTextareaElement,
  useAgentChatLayout,
} from "./use-agent-chat-layout";

type TextareaResizeTarget = Parameters<typeof resizeComposerTextareaElement>[0];
type EditorResizeTarget = Parameters<typeof resizeComposerEditorElement>[0];
type ResizeStyle = TextareaResizeTarget["style"];
type ResizeStyleState = {
  height: string;
  overflowY: "auto" | "hidden";
};

enableReactActEnvironment();

const createTextareaElement = ({
  height,
  scrollHeight,
  value,
}: {
  height: number;
  scrollHeight: number;
  value: string;
}): HTMLTextAreaElement => {
  const textarea = document.createElement("textarea");
  textarea.style.height = `${height}px`;
  textarea.style.overflowY = "hidden";
  textarea.value = value;
  textarea.getBoundingClientRect = () => new DOMRect(0, 0, 0, height);
  Object.defineProperty(textarea, "scrollHeight", {
    configurable: true,
    value: scrollHeight,
    writable: true,
  });
  return textarea;
};

const createMessagesContainer = (): HTMLDivElement => {
  const container = document.createElement("div");
  Object.defineProperties(container, {
    clientHeight: { configurable: true, value: 300, writable: true },
    scrollHeight: { configurable: true, value: 1_000, writable: true },
    scrollTop: { configurable: true, value: 700, writable: true },
  });
  return container;
};

describe("use-agent-chat-layout helpers", () => {
  test("clamps textarea layout to minimum height", () => {
    expect(computeComposerEditorLayout(10)).toEqual({
      heightPx: COMPOSER_EDITOR_MIN_HEIGHT_PX,
      overflowY: "hidden",
    });
  });

  test("clamps textarea layout to maximum height and enables overflow", () => {
    expect(computeComposerEditorLayout(COMPOSER_EDITOR_MAX_HEIGHT_PX + 120)).toEqual({
      heightPx: COMPOSER_EDITOR_MAX_HEIGHT_PX,
      overflowY: "auto",
    });
  });

  test("resizeComposerTextareaElement avoids transient collapse when the target height is unchanged", () => {
    const styleState = {
      height: "40px",
      overflowY: "hidden" as const,
    };
    const textarea: TextareaResizeTarget = {
      getBoundingClientRect: () => ({ height: 40 }),
      scrollHeight: 40,
      style: styleState,
      textContent: null,
      value: "draft",
    };

    resizeComposerTextareaElement(textarea);

    expect(styleState.height).toBe("44px");
    expect(styleState.overflowY).toBe("hidden");
  });

  test("resizeComposerTextareaElement keeps multiline height stable when the layout is unchanged", () => {
    const styleState: ResizeStyleState = {
      height: "120px",
      overflowY: "hidden",
    };
    const assignedHeights: string[] = [];
    const assignedOverflowValues: Array<"auto" | "hidden"> = [];
    const style: ResizeStyle = {
      get height() {
        return styleState.height;
      },
      set height(value: string) {
        assignedHeights.push(value);
        styleState.height = value;
      },
      get overflowY() {
        return styleState.overflowY;
      },
      set overflowY(value: string) {
        if (value !== "auto" && value !== "hidden") {
          throw new Error(`Unexpected overflow value: ${value}`);
        }
        assignedOverflowValues.push(value);
        styleState.overflowY = value;
      },
    };

    const textarea: TextareaResizeTarget = {
      getBoundingClientRect: () => ({ height: 120 }),
      style,
      textContent: null,
      value: "line one\nline two",
      get scrollHeight() {
        return 120;
      },
    };

    const result = resizeComposerTextareaElement(textarea);

    expect(result).toEqual({
      didHeightChange: false,
      overflowY: "hidden",
    });
    expect(assignedHeights).toEqual(["auto", "120px"]);
    expect(assignedOverflowValues).toEqual([]);
  });

  test("resizeComposerEditorElement detects native multiline growth from the last synced height", () => {
    const styleState: ResizeStyleState = {
      height: "",
      overflowY: "hidden",
    };
    const style: ResizeStyle = {
      get height() {
        return styleState.height;
      },
      set height(value: string) {
        styleState.height = value;
      },
      get overflowY() {
        return styleState.overflowY;
      },
      set overflowY(value: string) {
        if (value !== "auto" && value !== "hidden") {
          throw new Error(`Unexpected overflow value: ${value}`);
        }
        styleState.overflowY = value;
      },
    };

    const editor: EditorResizeTarget = {
      getBoundingClientRect: () => ({ height: 120 }),
      scrollHeight: 120,
      style,
      textContent: "line one\nline two",
    };

    const result = resizeComposerEditorElement(editor, undefined, COMPOSER_EDITOR_MIN_HEIGHT_PX);

    expect(result).toEqual({
      didHeightChange: true,
      overflowY: "hidden",
    });
    expect(styleState.height).toBe("120px");
  });

  test("resizeComposerTextareaElement shrinks when content height decreases", () => {
    const styleState: ResizeStyleState = {
      height: "120px",
      overflowY: "hidden",
    };
    const style: ResizeStyle = {
      get height() {
        return styleState.height;
      },
      set height(value: string) {
        styleState.height = value;
      },
      get overflowY() {
        return styleState.overflowY;
      },
      set overflowY(value: string) {
        if (value !== "auto" && value !== "hidden") {
          throw new Error(`Unexpected overflow value: ${value}`);
        }
        styleState.overflowY = value;
      },
    };

    const textarea: TextareaResizeTarget = {
      getBoundingClientRect: () => ({ height: 120 }),
      style,
      textContent: null,
      value: "short",
      get scrollHeight() {
        return styleState.height === "auto" ? COMPOSER_EDITOR_MIN_HEIGHT_PX : 120;
      },
    };

    const result = resizeComposerTextareaElement(textarea);

    expect(result).toEqual({
      didHeightChange: true,
      overflowY: "hidden",
    });
    expect(styleState.height).toBe(`${COMPOSER_EDITOR_MIN_HEIGHT_PX}px`);
  });

  test("resizeComposerTextareaElement preserves height when the editor already reports the target size", () => {
    const styleState: ResizeStyleState = {
      height: "120px",
      overflowY: "hidden",
    };
    const assignedHeights: string[] = [];
    const style = { height: styleState.height, overflowY: styleState.overflowY };

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
      scrollHeight: 120,
      textContent: null,
      value: "line one\nline two",
    };

    const result = resizeComposerTextareaElement(textarea);

    expect(result).toEqual({
      didHeightChange: false,
      overflowY: "hidden",
    });
    expect(assignedHeights).toEqual(["auto", "120px"]);
    expect(styleState.height).toBe("120px");
  });

  test("resizeComposerTextareaElement skips no-op writes for single-line drafts already at min height", () => {
    const styleState: ResizeStyleState = {
      height: "",
      overflowY: "hidden",
    };
    const assignedHeights: string[] = [];
    const style: ResizeStyle = {
      get height() {
        return styleState.height;
      },
      set height(value: string) {
        assignedHeights.push(value);
        styleState.height = value;
      },
      get overflowY() {
        return styleState.overflowY;
      },
      set overflowY(value: string) {
        if (value !== "auto" && value !== "hidden") {
          throw new Error(`Unexpected overflow value: ${value}`);
        }
        styleState.overflowY = value;
      },
    };

    const textarea: TextareaResizeTarget = {
      getBoundingClientRect: () => ({ height: COMPOSER_EDITOR_MIN_HEIGHT_PX }),
      style,
      textContent: null,
      value: "draft",
      get scrollHeight() {
        return COMPOSER_EDITOR_MIN_HEIGHT_PX;
      },
    };

    const result = resizeComposerTextareaElement(textarea);

    expect(result).toEqual({
      didHeightChange: false,
      overflowY: "hidden",
    });
    expect(assignedHeights).toEqual(["auto", ""]);
    expect(styleState.height).toBe("");
  });

  test("resizeComposerTextareaElement clamps empty drafts to minimum height", () => {
    const styleState: ResizeStyleState = {
      height: "220px",
      overflowY: "auto",
    };
    const textarea: TextareaResizeTarget = {
      getBoundingClientRect: () => ({ height: 220 }),
      scrollHeight: 220,
      style: styleState,
      textContent: null,
      value: "",
    };

    resizeComposerTextareaElement(textarea);

    expect(styleState.height).toBe("44px");
    expect(styleState.overflowY).toBe("hidden");
  });

  test("returns stable refs for the layout hook", async () => {
    const harness = createSharedHookHarness(
      ({ displayedSessionKey, input }: { displayedSessionKey: string | null; input: string }) => {
        return useAgentChatLayout({ displayedSessionKey, input });
      },
      { displayedSessionKey: "session-1", input: "" },
    );

    await harness.mount();

    const initialState = harness.getLatest();

    expect(initialState.messagesContainerRef.current).toBeNull();
    expect(initialState.composerFormRef.current).toBeNull();
    expect(initialState.composerTextareaRef.current).toBeNull();
    expect(initialState.resizeComposerTextarea).toBeInstanceOf(Function);

    await harness.update({ displayedSessionKey: "session-2", input: "draft" });

    const updatedState = harness.getLatest();
    expect(updatedState.messagesContainerRef).toBe(initialState.messagesContainerRef);

    await harness.unmount();
  });

  test("resizes only when controlled input value changes", async () => {
    await withAnimationFrameTestDriver(async (animationFrameDriver) => {
      const harness = createSharedHookHarness(
        ({ displayedSessionKey }: { displayedSessionKey: string | null }) => {
          return useAgentChatLayout({ displayedSessionKey });
        },
        { displayedSessionKey: "session-1" },
      );

      await harness.mount();

      const state = harness.getLatest();
      const textarea = createTextareaElement({ height: 44, scrollHeight: 120, value: "" });
      state.composerTextareaRef.current = textarea;

      await animationFrameDriver.flushFrames();

      textarea.value = "line one\nline two";
      state.resizeComposerTextarea();

      expect(animationFrameDriver.pendingFrameCount()).toBe(1);
      await animationFrameDriver.flushFrame();
      expect(textarea.style.height).toBe("120px");

      state.resizeComposerTextarea();
      expect(animationFrameDriver.pendingFrameCount()).toBe(1);
      await animationFrameDriver.flushFrame();
      expect(textarea.style.height).toBe("120px");

      Object.assign(textarea, {
        value: "",
        scrollHeight: 20,
      });
      state.resizeComposerTextarea();
      expect(animationFrameDriver.pendingFrameCount()).toBe(1);

      await animationFrameDriver.flushFrame();
      expect(textarea.style.height).toBe("44px");

      await harness.unmount();
    });
  });

  test("requests a bottom resync only when composer height changes while the transcript is near bottom", async () => {
    await withAnimationFrameTestDriver(async (animationFrameDriver) => {
      let syncBottomAfterComposerLayoutCallCount = 0;
      const syncBottomAfterComposerLayoutRef = {
        current: () => {
          syncBottomAfterComposerLayoutCallCount += 1;
        },
      } satisfies { current: (() => void) | null };
      const harness = createSharedHookHarness(
        ({ displayedSessionKey }: { displayedSessionKey: string | null }) => {
          return useAgentChatLayout({
            displayedSessionKey,
            syncBottomAfterComposerLayoutRef,
          });
        },
        { displayedSessionKey: "session-1" },
      );

      await harness.mount();

      const state = harness.getLatest();
      state.messagesContainerRef.current = createMessagesContainer();

      const textarea = createTextareaElement({
        height: 44,
        scrollHeight: 120,
        value: "line one\nline two",
      });
      state.composerTextareaRef.current = textarea;

      state.resizeComposerTextarea();
      await animationFrameDriver.flushFrame();

      expect(textarea.style.height).toBe("120px");
      expect(syncBottomAfterComposerLayoutCallCount).toBe(1);

      state.messagesContainerRef.current = createMessagesContainer();
      Object.assign(textarea, {
        scrollHeight: 120,
        value: "line one\nline tw",
      });

      state.resizeComposerTextarea();
      await animationFrameDriver.flushFrame();

      expect(textarea.style.height).toBe("120px");
      expect(syncBottomAfterComposerLayoutCallCount).toBe(1);

      await harness.unmount();
    });
  });

  test("initializes textarea height when ref becomes available after first mount", async () => {
    await withAnimationFrameTestDriver(async (animationFrameDriver) => {
      const harness = createSharedHookHarness(
        ({ displayedSessionKey, input }: { displayedSessionKey: string | null; input: string }) => {
          return useAgentChatLayout({ displayedSessionKey, input });
        },
        { displayedSessionKey: "session-1", input: "" },
      );

      await harness.mount();

      const state = harness.getLatest();
      const textarea = createTextareaElement({ height: 220, scrollHeight: 44, value: "" });

      state.composerTextareaRef.current = textarea;
      state.resizeComposerTextarea();
      await animationFrameDriver.flushFrame();

      expect(textarea.style.height).toBe("44px");

      await harness.unmount();
    });
  });
});

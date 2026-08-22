import { runtimeTypeName } from "@openducktor/contracts";
import { describe, expect, test } from "bun:test";
import { withAnimationFrameTestDriver } from "@/test-utils/animation-frame-test-driver";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { createFocusedFixture } from "@/test-utils/focused-fixture";
import {
  COMPOSER_EDITOR_MAX_HEIGHT_PX,
  COMPOSER_EDITOR_MIN_HEIGHT_PX,
  computeComposerEditorLayout,
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

// SAFETY: This test controls the fixture and supplies `typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean; }` used by this case.
(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

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
    // SAFETY: This test creates the DOM fixture that supplies `HTMLTextAreaElement` before this lookup.
    const textarea = {
      getBoundingClientRect: () => ({ height: 40 }),
      scrollHeight: 40,
      style: styleState,
      value: "draft",
    } as HTMLTextAreaElement;

    resizeComposerTextareaElement(textarea);

    expect(styleState.height).toBe("44px");
    expect(styleState.overflowY).toBe("hidden");
  });

  test("resizeComposerTextareaElement keeps multiline height stable when the layout is unchanged", () => {
    // SAFETY: This test controls the fixture and supplies `"auto" | "hidden"` used by this case.
    const styleState = {
      height: "120px",
      overflowY: "hidden" as "auto" | "hidden",
    };
    const assignedHeights: string[] = [];
    const assignedOverflowValues: Array<"auto" | "hidden"> = [];
    // SAFETY: This test controls the fixture and supplies `CSSStyleDeclaration` used by this case.
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

    // SAFETY: This test creates the DOM fixture that supplies `HTMLTextAreaElement` before this lookup.
    const textarea = {
      getBoundingClientRect: () => ({ height: 120 }),
      style,
      value: "line one\nline two",
      get scrollHeight() {
        return 120;
      },
    } as HTMLTextAreaElement;

    const result = resizeComposerTextareaElement(textarea);

    expect(result).toEqual({
      didHeightChange: false,
      overflowY: "hidden",
    });
    expect(assignedHeights).toEqual(["auto", "120px"]);
    expect(assignedOverflowValues).toEqual([]);
  });

  test("resizeComposerEditorElement detects native multiline growth from the last synced height", () => {
    // SAFETY: This test controls the fixture and supplies `"auto" | "hidden"` used by this case.
    const styleState = {
      height: "",
      overflowY: "hidden" as "auto" | "hidden",
    };
    // SAFETY: This test controls the fixture and supplies `CSSStyleDeclaration` used by this case.
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

    // SAFETY: This test creates the DOM fixture that supplies `HTMLDivElement` before this lookup.
    const editor = {
      getBoundingClientRect: () => ({ height: 120 }),
      scrollHeight: 120,
      style,
      textContent: "line one\nline two",
    } as HTMLDivElement;

    const result = resizeComposerEditorElement(editor, undefined, COMPOSER_EDITOR_MIN_HEIGHT_PX);

    expect(result).toEqual({
      didHeightChange: true,
      overflowY: "hidden",
    });
    expect(styleState.height).toBe("120px");
  });

  test("resizeComposerTextareaElement shrinks when content height decreases", () => {
    // SAFETY: This test controls the fixture and supplies `"auto" | "hidden"` used by this case.
    const styleState = {
      height: "120px",
      overflowY: "hidden" as "auto" | "hidden",
    };
    // SAFETY: This test controls the fixture and supplies `CSSStyleDeclaration` used by this case.
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

    // SAFETY: This test creates the DOM fixture that supplies `HTMLTextAreaElement` before this lookup.
    const textarea = {
      getBoundingClientRect: () => ({ height: 120 }),
      style,
      value: "short",
      get scrollHeight() {
        return styleState.height === "auto" ? COMPOSER_EDITOR_MIN_HEIGHT_PX : 120;
      },
    } as HTMLTextAreaElement;

    const result = resizeComposerTextareaElement(textarea);

    expect(result).toEqual({
      didHeightChange: true,
      overflowY: "hidden",
    });
    expect(styleState.height).toBe(`${COMPOSER_EDITOR_MIN_HEIGHT_PX}px`);
  });

  test("resizeComposerTextareaElement preserves height when the editor already reports the target size", () => {
    // SAFETY: This test controls the fixture and supplies `"auto" | "hidden"` used by this case.
    const styleState = {
      height: "120px",
      overflowY: "hidden" as "auto" | "hidden",
    };
    const assignedHeights: string[] = [];
    // SAFETY: This test controls the fixture and supplies `CSSStyleDeclaration` used by this case.
    const style = {} as CSSStyleDeclaration;
    // SAFETY: This test creates the DOM fixture that supplies `CSSStyleDeclaration` before this lookup.
    const measurementClone = createFocusedFixture<HTMLTextAreaElement>({
      style: {} as CSSStyleDeclaration,
      scrollHeight: COMPOSER_EDITOR_MIN_HEIGHT_PX,
      value: "",
      rows: 1,
      setAttribute: () => {},
      remove: () => {},
    });

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

    const textarea = createFocusedFixture<HTMLTextAreaElement>({
      cloneNode: () => measurementClone,
      getBoundingClientRect: () => createFocusedFixture<DOMRect>({ height: 120, width: 320 }),
      ownerDocument: createFocusedFixture<Document>({
        body: createFocusedFixture<HTMLElement>({
          appendChild: (node) => node,
        }),
        defaultView: createFocusedFixture<Window & typeof globalThis>({
          getComputedStyle: () =>
            createFocusedFixture<CSSStyleDeclaration>({
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
            }),
        }),
      }),
      style,
      rows: 1,
      scrollHeight: 120,
      value: "line one\nline two",
    });

    const result = resizeComposerTextareaElement(textarea);

    expect(result).toEqual({
      didHeightChange: false,
      overflowY: "hidden",
    });
    expect(assignedHeights).toEqual(["auto", "120px"]);
    expect(styleState.height).toBe("120px");
  });

  test("resizeComposerTextareaElement skips no-op writes for single-line drafts already at min height", () => {
    // SAFETY: This test controls the fixture and supplies `"auto" | "hidden"` used by this case.
    const styleState = {
      height: "",
      overflowY: "hidden" as "auto" | "hidden",
    };
    const assignedHeights: string[] = [];
    // SAFETY: This test controls the fixture and supplies `CSSStyleDeclaration` used by this case.
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

    // SAFETY: This test creates the DOM fixture that supplies `HTMLTextAreaElement` before this lookup.
    const textarea = {
      getBoundingClientRect: () => ({ height: COMPOSER_EDITOR_MIN_HEIGHT_PX }),
      style,
      value: "draft",
      get scrollHeight() {
        return COMPOSER_EDITOR_MIN_HEIGHT_PX;
      },
    } as HTMLTextAreaElement;

    const result = resizeComposerTextareaElement(textarea);

    expect(result).toEqual({
      didHeightChange: false,
      overflowY: "hidden",
    });
    expect(assignedHeights).toEqual(["auto", ""]);
    expect(styleState.height).toBe("");
  });

  test("resizeComposerTextareaElement clamps empty drafts to minimum height", () => {
    // SAFETY: This test controls the fixture and supplies `"auto" | "hidden"` used by this case.
    const styleState = {
      height: "220px",
      overflowY: "auto" as "auto" | "hidden",
    };
    // SAFETY: This test creates the DOM fixture that supplies `HTMLTextAreaElement` before this lookup.
    const textarea = {
      getBoundingClientRect: () => ({ height: 220 }),
      scrollHeight: 220,
      style: styleState,
      value: "",
    } as HTMLTextAreaElement;

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

    // SAFETY: This test controls the fixture and supplies `LayoutHookState` used by this case.
    const initialState = harness.getLatest() as LayoutHookState;

    expect(initialState.messagesContainerRef.current).toBeNull();
    expect(initialState.composerFormRef.current).toBeNull();
    expect(initialState.composerTextareaRef.current).toBeNull();
    expect(runtimeTypeName(initialState.resizeComposerTextarea)).toBe("function");

    await harness.update({ displayedSessionKey: "session-2", input: "draft" });

    // SAFETY: This test controls the fixture and supplies `LayoutHookState` used by this case.
    const updatedState = harness.getLatest() as LayoutHookState;
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

      // SAFETY: This test controls the fixture and supplies `LayoutHookState` used by this case.
      const state = harness.getLatest() as LayoutHookState;
      const styleState = {
        height: "44px",
        overflowY: "hidden" as const,
      };
      // SAFETY: This test creates the DOM fixture that supplies `HTMLTextAreaElement` before this lookup.
      const textarea = {
        getBoundingClientRect: () => ({ height: 44 }),
        scrollHeight: 120,
        style: styleState,
        value: "",
      } as HTMLTextAreaElement;
      state.composerTextareaRef.current = textarea;

      await animationFrameDriver.flushFrames();

      textarea.value = "line one\nline two";
      state.resizeComposerTextarea();

      expect(animationFrameDriver.pendingFrameCount()).toBe(1);
      await animationFrameDriver.flushFrame();
      expect(styleState.height).toBe("120px");

      state.resizeComposerTextarea();
      expect(animationFrameDriver.pendingFrameCount()).toBe(1);
      await animationFrameDriver.flushFrame();
      expect(styleState.height).toBe("120px");

      Object.assign(textarea, {
        value: "",
        scrollHeight: 20,
      });
      state.resizeComposerTextarea();
      expect(animationFrameDriver.pendingFrameCount()).toBe(1);

      await animationFrameDriver.flushFrame();
      expect(styleState.height).toBe("44px");

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

      // SAFETY: This test controls the fixture and supplies `LayoutHookState` used by this case.
      const state = harness.getLatest() as LayoutHookState;
      // SAFETY: This test creates the DOM fixture that supplies `HTMLDivElement` before this lookup.
      state.messagesContainerRef.current = {
        scrollHeight: 1000,
        scrollTop: 700,
        clientHeight: 300,
      } as HTMLDivElement;

      const styleState = {
        height: "44px",
        overflowY: "hidden" as const,
      };
      // SAFETY: This test creates the DOM fixture that supplies `HTMLTextAreaElement` before this lookup.
      const textarea = {
        getBoundingClientRect: () => ({ height: 44 }),
        scrollHeight: 120,
        style: styleState,
        value: "line one\nline two",
      } as HTMLTextAreaElement;
      state.composerTextareaRef.current = textarea;

      state.resizeComposerTextarea();
      await animationFrameDriver.flushFrame();

      expect(styleState.height).toBe("120px");
      expect(syncBottomAfterComposerLayoutCallCount).toBe(1);

      // SAFETY: This test creates the DOM fixture that supplies `HTMLDivElement` before this lookup.
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
      await animationFrameDriver.flushFrame();

      expect(styleState.height).toBe("120px");
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

      // SAFETY: This test controls the fixture and supplies `LayoutHookState` used by this case.
      const state = harness.getLatest() as LayoutHookState;
      const styleState = {
        height: "220px",
        overflowY: "hidden" as const,
      };
      // SAFETY: This test creates the DOM fixture that supplies `HTMLTextAreaElement` before this lookup.
      const textarea = {
        getBoundingClientRect: () => ({ height: 220 }),
        scrollHeight: 44,
        style: styleState,
        value: "",
      } as HTMLTextAreaElement;

      state.composerTextareaRef.current = textarea;
      state.resizeComposerTextarea();
      await animationFrameDriver.flushFrame();

      expect(styleState.height).toBe("44px");

      await harness.unmount();
    });
  });
});

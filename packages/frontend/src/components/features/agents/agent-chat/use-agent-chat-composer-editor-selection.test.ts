import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { RefObject } from "react";
import { act } from "react";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createFileReferenceSegment, createTextSegment } from "./agent-chat-composer-draft";
import {
  type ActiveTextSelection,
  deriveTextSelectionTargetAfterInput,
  getLastTextSelectionTarget,
  parseComposerDraftFromRoot,
  resolveTextSelectionTarget,
  useAgentChatComposerEditorSelection,
} from "./use-agent-chat-composer-editor-selection";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const buildDraft = (text: string, segmentId = "segment-1") => ({
  segments: [createTextSegment(text, segmentId)],
  attachments: [],
});

const appendTextSegment = (root: HTMLElement, segmentId: string, text: string): HTMLDivElement => {
  const element = document.createElement("div");
  element.dataset.textSegmentId = segmentId;
  element.textContent = text;
  root.append(element);
  return element;
};

const setCollapsedSelection = (node: Node, offset: number): void => {
  const selection = globalThis.getSelection?.();
  if (!selection) {
    throw new Error("Expected DOM selection support");
  }

  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
};

const createSelectionHarness = (editorRef: RefObject<HTMLDivElement | null>) => {
  return createHookHarness(
    ({ tick }: { tick: number }) => {
      void tick;
      return useAgentChatComposerEditorSelection({ editorRef });
    },
    { tick: 0 },
  );
};

describe("useAgentChatComposerEditorSelection helpers", () => {
  test("clamps remembered selections to the text segment bounds", () => {
    const draft = {
      segments: [createTextSegment("hello", "segment-1")],
      attachments: [],
    };

    expect(
      resolveTextSelectionTarget(draft, {
        segmentId: "segment-1",
        offset: 99,
      }),
    ).toEqual({
      segmentId: "segment-1",
      offset: 5,
    });
  });

  test("derives newline selection targets from the pending input state", () => {
    const draft = {
      segments: [createTextSegment("hello\nworld", "segment-1")],
      attachments: [],
    };

    expect(
      deriveTextSelectionTargetAfterInput(
        draft,
        {
          segmentId: "segment-1",
          offset: 5,
          inputType: "insertLineBreak",
          data: null,
        },
        null,
      ),
    ).toEqual({
      segmentId: "segment-1",
      offset: 6,
    });
  });

  test("falls back to the last text segment when remembered selection is unavailable", () => {
    const draft = {
      segments: [
        createFileReferenceSegment(
          {
            id: "file-1",
            path: "src/main.ts",
            name: "main.ts",
            kind: "code",
          },
          "file-segment",
        ),
        createTextSegment("tail", "segment-2"),
      ],
      attachments: [],
    };

    expect(deriveTextSelectionTargetAfterInput(draft, null, null)).toEqual(
      getLastTextSelectionTarget(draft),
    );
  });

  test("rebuilds a normalized draft from the editable DOM while preserving chip segments", () => {
    const root = document.createElement("div");
    const contentRoot = document.createElement("div");
    contentRoot.dataset.composerContentRoot = "true";
    root.append(contentRoot);

    const previousDraft = {
      segments: [
        createTextSegment("hello", "segment-1"),
        createFileReferenceSegment(
          {
            id: "file-1",
            path: "src/main.ts",
            name: "main.ts",
            kind: "code",
          },
          "file-segment",
        ),
        createTextSegment("world", "segment-2"),
      ],
      attachments: [],
    };

    const firstText = document.createElement("div");
    firstText.dataset.textSegmentId = "segment-1";
    firstText.textContent = "updated";
    contentRoot.append(firstText);

    const chip = document.createElement("span");
    chip.dataset.chipSegmentId = "file-segment";
    chip.dataset.segmentId = "file-segment";
    chip.textContent = "main.ts";
    contentRoot.append(chip);

    const trailingText = document.createElement("div");
    trailingText.dataset.textSegmentId = "segment-2";
    trailingText.textContent = "tail";
    contentRoot.append(trailingText);

    const nextDraft = parseComposerDraftFromRoot(root, previousDraft);

    expect(nextDraft.segments).toHaveLength(3);
    expect(nextDraft.segments[0]).toMatchObject({
      kind: "text",
      id: "segment-1",
      text: "updated",
    });
    expect(nextDraft.segments[1]).toBe(previousDraft.segments[1]);
    expect(nextDraft.segments[2]).toMatchObject({
      kind: "text",
      id: "segment-2",
      text: "tail",
    });
  });
});

describe("useAgentChatComposerEditorSelection", () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const animationFrameCallbacks = new Map<number, FrameRequestCallback>();
  let nextAnimationFrameId = 1;

  const flushAnimationFrames = async (): Promise<void> => {
    await act(async () => {
      while (animationFrameCallbacks.size > 0) {
        const queuedCallbacks = Array.from(animationFrameCallbacks.values());
        animationFrameCallbacks.clear();
        for (const callback of queuedCallbacks) {
          callback(16);
        }
        await Promise.resolve();
      }
    });
  };

  beforeEach(() => {
    document.body.replaceChildren();
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
    document.body.replaceChildren();
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  test("repairs root-collapsed selections from the remembered text target", async () => {
    const draft = buildDraft("hello");
    const root = document.createElement("div");
    root.contentEditable = "true";
    document.body.append(root);

    const textSegment = appendTextSegment(root, "segment-1", "hello");
    const editorRef = { current: root } as RefObject<HTMLDivElement | null>;
    const harness = createSelectionHarness(editorRef);
    await harness.mount();

    await harness.run((state) => {
      state.rememberSelectionTarget(draft, { segmentId: "segment-1", offset: 3 });
    });

    setCollapsedSelection(root, 0);

    let activeSelection: ActiveTextSelection | null = null;
    await harness.run((state) => {
      activeSelection = state.resolveActiveTextSelection(root, draft);
    });

    expect(activeSelection).not.toBeNull();
    if (!activeSelection) {
      throw new Error("Expected repaired active selection");
    }
    const repairedActiveSelection: ActiveTextSelection = activeSelection;

    expect(repairedActiveSelection).toEqual({
      segmentId: "segment-1",
      element: textSegment,
      text: "hello",
      caretOffset: 3,
    });
    expect(globalThis.getSelection?.()?.anchorNode).toBe(textSegment.firstChild);
    expect(globalThis.getSelection?.()?.anchorOffset).toBe(3);

    await harness.unmount();
  });

  test("retries pending focus once the target text segment is rendered", async () => {
    const draft = buildDraft("hello");
    const root = document.createElement("div");
    root.contentEditable = "true";
    document.body.append(root);

    const editorRef = { current: root } as RefObject<HTMLDivElement | null>;
    const harness = createSelectionHarness(editorRef);
    await harness.mount();

    let didFocus = true;
    await harness.run((state) => {
      didFocus = state.focusTextSegmentWithMemory("segment-1", 2, draft);
    });

    expect(didFocus).toBe(false);

    await harness.update({ tick: 1 });
    expect(animationFrameCallbacks.size).toBe(1);

    const textSegment = appendTextSegment(root, "segment-1", "hello");
    await flushAnimationFrames();

    expect(globalThis.getSelection?.()?.anchorNode).toBe(textSegment.firstChild);
    expect(globalThis.getSelection?.()?.anchorOffset).toBe(2);

    setCollapsedSelection(root, 0);

    let repairedSelection: ActiveTextSelection | null = null;
    await harness.run((state) => {
      repairedSelection = state.resolveActiveTextSelection(root, draft);
    });

    expect(repairedSelection).not.toBeNull();
    if (!repairedSelection) {
      throw new Error("Expected repaired selection after pending focus");
    }

    expect(repairedSelection).toMatchObject({
      segmentId: "segment-1",
      caretOffset: 2,
      text: "hello",
    });

    await harness.unmount();
  });
});

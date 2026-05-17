import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createFileReferenceSegment, createTextSegment } from "./agent-chat-composer-draft";
import { readComposerSelectionRange } from "./agent-chat-composer-selection-range";

const testFile = {
  id: "file-1",
  path: "src/main.ts",
  name: "main.ts",
  kind: "code" as const,
};

const buildDraftWithFileReference = () => ({
  segments: [
    createTextSegment("hello\n", "text-before"),
    createFileReferenceSegment(testFile, "file-segment"),
    createTextSegment("world", "text-after"),
  ],
  attachments: [],
});

const createComposerRoot = (): HTMLDivElement => {
  const root = document.createElement("div");
  root.contentEditable = "true";
  root.dataset.composerContentRoot = "true";
  document.body.append(root);
  return root;
};

const appendTextSegment = (root: HTMLElement, segmentId: string, text: string): HTMLSpanElement => {
  const element = document.createElement("span");
  element.dataset.segmentId = segmentId;
  element.dataset.textSegmentId = segmentId;
  element.textContent = text;
  root.append(element);
  return element;
};

const appendChipSegment = (
  root: HTMLElement,
  segmentId: string,
  text = "main.ts",
): HTMLSpanElement => {
  const element = document.createElement("span");
  element.dataset.segmentId = segmentId;
  element.dataset.chipSegmentId = segmentId;
  element.textContent = text;
  root.append(element);
  return element;
};

const getOnlyTextNode = (element: HTMLElement): Text => {
  const node = element.firstChild;
  if (!(node instanceof Text)) {
    throw new Error("Expected text segment to contain a text node");
  }
  return node;
};

const selectRange = (
  startContainer: Node,
  startOffset: number,
  endContainer: Node,
  endOffset: number,
): void => {
  const selection = globalThis.getSelection?.();
  if (!selection) {
    throw new Error("Expected DOM selection support");
  }

  const range = document.createRange();
  range.setStart(startContainer, startOffset);
  range.setEnd(endContainer, endOffset);
  selection.removeAllRanges();
  selection.addRange(range);
};

describe("readComposerSelectionRange", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  afterEach(() => {
    globalThis.getSelection?.()?.removeAllRanges();
    document.body.replaceChildren();
  });

  test("reads selected ranges inside one text segment", () => {
    const draft = {
      segments: [createTextSegment("hello world", "text-segment")],
      attachments: [],
    };
    const root = createComposerRoot();
    const textSegment = appendTextSegment(root, "text-segment", "hello world");

    selectRange(getOnlyTextNode(textSegment), 6, getOnlyTextNode(textSegment), 11);

    expect(readComposerSelectionRange(root, draft)).toEqual({
      start: {
        segmentId: "text-segment",
        offset: 6,
      },
      end: {
        segmentId: "text-segment",
        offset: 11,
      },
    });
  });

  test("reads selected ranges spanning a file reference chip", () => {
    const draft = buildDraftWithFileReference();
    const root = createComposerRoot();
    const textBefore = appendTextSegment(root, "text-before", "hello\n");
    appendChipSegment(root, "file-segment");
    const textAfter = appendTextSegment(root, "text-after", "world");

    selectRange(getOnlyTextNode(textBefore), 6, getOnlyTextNode(textAfter), 5);

    expect(readComposerSelectionRange(root, draft)).toEqual({
      start: {
        segmentId: "text-before",
        offset: 6,
      },
      end: {
        segmentId: "text-after",
        offset: 5,
      },
    });
  });

  test("reads content-root boundaries around file reference chips", () => {
    const draft = buildDraftWithFileReference();
    const root = createComposerRoot();
    appendTextSegment(root, "text-before", "hello\n");
    appendChipSegment(root, "file-segment");
    appendTextSegment(root, "text-after", "world");

    selectRange(root, 1, root, 2);

    expect(readComposerSelectionRange(root, draft)).toEqual({
      start: {
        segmentId: "text-before",
        offset: 6,
      },
      end: {
        segmentId: "text-after",
        offset: 0,
      },
    });
  });

  test("returns null for collapsed selections", () => {
    const draft = {
      segments: [createTextSegment("hello", "text-segment")],
      attachments: [],
    };
    const root = createComposerRoot();
    const textSegment = appendTextSegment(root, "text-segment", "hello");

    selectRange(getOnlyTextNode(textSegment), 3, getOnlyTextNode(textSegment), 3);

    expect(readComposerSelectionRange(root, draft)).toBeNull();
  });
});

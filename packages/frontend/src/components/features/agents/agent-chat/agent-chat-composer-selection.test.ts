import { afterEach, describe, expect, test } from "bun:test";
import * as selectionModule from "./agent-chat-composer-selection";

const createSelectionHost = (): HTMLElement => {
  const root = document.createElement("div");
  root.setAttribute("contenteditable", "true");
  const element = document.createElement("span");
  root.append(element);
  document.body.append(root);
  return element;
};

afterEach(() => {
  document.body.replaceChildren();
  const selection = globalThis.getSelection?.();
  selection?.removeAllRanges();
});

describe("agent-chat-composer-selection", () => {
  test("finds the nearest text segment element inside the composer root", () => {
    const root = document.createElement("div");
    const outside = document.createElement("span");
    outside.dataset.textSegmentId = "outside";
    const textSegment = document.createElement("span");
    textSegment.dataset.textSegmentId = "segment-1";
    const nested = document.createElement("strong");
    textSegment.append(nested);
    root.append(textSegment);
    document.body.append(root, outside);

    expect(selectionModule.getClosestTextSegmentElement(nested, root)).toBe(textSegment);
    expect(selectionModule.getClosestTextSegmentElement(outside, root)).toBeNull();
  });

  test("places the caret after the trailing sentinel for newline-terminated text", () => {
    const element = createSelectionHost();
    element.textContent = "hello\n";

    selectionModule.setCaretOffsetWithinElement(element, 6);

    const selection = globalThis.getSelection?.();
    expect(selection?.rangeCount).toBe(1);

    const range = selection?.getRangeAt(0);
    const textNode = element.firstChild;
    expect(textNode).toBeInstanceOf(Text);
    if (!(textNode instanceof Text)) {
      throw new Error("Expected composer text node");
    }

    expect((textNode.textContent ?? "").length).toBeGreaterThan(6);
    expect(range?.endContainer).toBe(textNode);
    expect(range?.endOffset).toBe((textNode.textContent ?? "").length);
    expect(selectionModule.getCaretOffsetWithinElement(element)).toBe(6);
  });

  test("preserves the target caret range when focusing the composer mutates selection", () => {
    const element = createSelectionHost();
    element.textContent = "hello\n";
    const root = element.parentElement;
    if (!root) {
      throw new Error("Expected contenteditable root");
    }

    root.focus = () => {
      const selection = globalThis.getSelection?.();
      if (!selection) {
        return;
      }

      const range = document.createRange();
      range.setStart(root, 0);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    };

    selectionModule.setCaretOffsetWithinElement(element, 6);

    const selection = globalThis.getSelection?.();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const textNode = element.firstChild;
    expect(textNode).toBeInstanceOf(Text);
    if (!(textNode instanceof Text)) {
      throw new Error("Expected normalized text node");
    }
    expect(range?.endContainer).toBe(textNode);
    expect(range?.endOffset).toBe((textNode.textContent ?? "").length);
  });

  test("keeps the caret attached when focusing triggers re-entrant selection repair", () => {
    const element = createSelectionHost();
    element.textContent = "hello";
    const root = element.parentElement;
    if (!root) {
      throw new Error("Expected contenteditable root");
    }

    let isRepairingSelection = false;
    root.focus = () => {
      if (isRepairingSelection) {
        return;
      }
      isRepairingSelection = true;
      selectionModule.setCaretOffsetWithinElement(element, 0);
    };

    selectionModule.setCaretOffsetWithinElement(element, 5);

    const selection = globalThis.getSelection?.();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const currentTextNode = element.firstChild;
    expect(currentTextNode).toBeInstanceOf(Text);
    if (!(currentTextNode instanceof Text)) {
      throw new Error("Expected composer text node");
    }
    expect(range?.endContainer).toBe(currentTextNode);
    expect(element.contains(range?.endContainer ?? null)).toBe(true);
    expect(range?.endOffset).toBe(5);
  });

  test("places the caret on empty text segments next to chips without adding sentinel text", () => {
    const root = document.createElement("div");
    root.setAttribute("contenteditable", "true");
    const beforeChip = document.createElement("span");
    beforeChip.dataset.textSegmentId = "before";
    const chip = document.createElement("span");
    chip.dataset.chipSegmentId = "file";
    chip.setAttribute("contenteditable", "false");
    const afterChip = document.createElement("span");
    afterChip.dataset.textSegmentId = "after";
    root.append(beforeChip, chip, afterChip);
    document.body.append(root);

    selectionModule.setCaretOffsetWithinElement(beforeChip, 0);

    let selection = globalThis.getSelection?.();
    let range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    expect(beforeChip.textContent).toBe("");
    expect(beforeChip.childNodes).toHaveLength(0);
    expect(range?.endContainer).toBe(beforeChip);
    expect(range?.endOffset).toBe(0);

    selectionModule.setCaretOffsetWithinElement(afterChip, 0);

    selection = globalThis.getSelection?.();
    range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    expect(afterChip.textContent).toBe("");
    expect(afterChip.childNodes).toHaveLength(0);
    expect(range?.endContainer).toBe(afterChip);
    expect(range?.endOffset).toBe(0);
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import {
  getCaretOffsetWithinElement,
  setCaretOffsetWithinElement,
} from "@/components/features/agents/agent-chat/agent-chat-composer-selection";

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
  test("places the caret after the trailing sentinel for newline-terminated text", () => {
    const element = createSelectionHost();
    element.textContent = "hello\n";

    setCaretOffsetWithinElement(element, 6);

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
    expect(getCaretOffsetWithinElement(element)).toBe(6);
  });
});

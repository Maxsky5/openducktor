import { afterEach, beforeAll, describe, expect, test } from "bun:test";

type SelectionModule = typeof import("./agent-chat-composer-selection");

let selectionModule: SelectionModule;

beforeAll(async () => {
  selectionModule = (await import(
    new URL("./agent-chat-composer-selection.ts", import.meta.url).href
  )) as SelectionModule;
});

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
});

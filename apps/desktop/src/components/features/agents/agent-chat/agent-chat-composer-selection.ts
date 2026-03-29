export const EMPTY_TEXT_SEGMENT_SENTINEL = "\u200B";

export const readEditableTextContent = (element: HTMLElement): string => {
  return (element.textContent ?? "").split(EMPTY_TEXT_SEGMENT_SENTINEL).join("");
};

export const getCaretOffsetWithinElement = (element: HTMLElement): number | null => {
  const selection =
    element.ownerDocument.defaultView?.getSelection() ?? globalThis.getSelection?.();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (!element.contains(range.endContainer)) {
    return null;
  }

  const measurementRange = range.cloneRange();
  measurementRange.selectNodeContents(element);
  measurementRange.setEnd(range.endContainer, range.endOffset);
  return measurementRange.toString().split(EMPTY_TEXT_SEGMENT_SENTINEL).join("").length;
};

export const setCaretOffsetWithinElement = (element: HTMLElement, logicalOffset: number): void => {
  const ownerDocument = element.ownerDocument;
  const selection = ownerDocument.defaultView?.getSelection() ?? globalThis.getSelection?.();
  if (!selection) {
    return;
  }

  const textNode =
    element.firstChild instanceof Text
      ? element.firstChild
      : ownerDocument.createTextNode(EMPTY_TEXT_SEGMENT_SENTINEL);
  if (!element.firstChild) {
    element.appendChild(textNode);
  }

  const textContent = textNode.textContent ?? "";
  const domOffset =
    textContent === EMPTY_TEXT_SEGMENT_SENTINEL
      ? 1
      : Math.max(0, Math.min(logicalOffset, textContent.length));
  const range = ownerDocument.createRange();
  range.setStart(textNode, domOffset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  element.focus();
};

export const insertTextAtCaretWithinElement = (
  element: HTMLElement,
  text: string,
  fallbackLogicalOffset: number,
): number | null => {
  const ownerDocument = element.ownerDocument;
  const selection = ownerDocument.defaultView?.getSelection() ?? globalThis.getSelection?.();
  if (!selection) {
    return null;
  }

  const normalizedElementText = (element.textContent ?? "")
    .split(EMPTY_TEXT_SEGMENT_SENTINEL)
    .join("");
  if (normalizedElementText.length === 0) {
    element.textContent = "";
  }

  if (
    selection.rangeCount === 0 ||
    !element.contains(selection.anchorNode) ||
    !element.contains(selection.focusNode)
  ) {
    setCaretOffsetWithinElement(element, fallbackLogicalOffset);
  }

  if (selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();
  const insertedNode = ownerDocument.createTextNode(text);
  range.insertNode(insertedNode);

  const nextRange = ownerDocument.createRange();
  nextRange.setStart(insertedNode, insertedNode.textContent?.length ?? text.length);
  nextRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(nextRange);
  element.focus();

  return getCaretOffsetWithinElement(element);
};

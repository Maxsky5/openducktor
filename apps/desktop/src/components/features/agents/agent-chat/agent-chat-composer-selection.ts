export const EMPTY_TEXT_SEGMENT_SENTINEL = "\u200B";

export const readEditableTextContent = (element: HTMLElement): string => {
  return (element.textContent ?? "").split(EMPTY_TEXT_SEGMENT_SENTINEL).join("");
};

export const renderEditableTextContent = (text: string): string => {
  if (text.length === 0) {
    return EMPTY_TEXT_SEGMENT_SENTINEL;
  }

  return text.endsWith("\n") ? `${text}${EMPTY_TEXT_SEGMENT_SENTINEL}` : text;
};

const normalizeEditableTextNode = (element: HTMLElement): Text => {
  const ownerDocument = element.ownerDocument;
  const normalizedText = readEditableTextContent(element);
  const textNode = ownerDocument.createTextNode(renderEditableTextContent(normalizedText));
  element.replaceChildren(textNode);
  return textNode;
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

  const textNode = normalizeEditableTextNode(element);

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
  const focusTarget = element.closest<HTMLElement>('[contenteditable="true"]') ?? element;
  focusTarget.focus();
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

  const textNode = normalizeEditableTextNode(element);
  if (textNode.textContent === EMPTY_TEXT_SEGMENT_SENTINEL) {
    textNode.textContent = "";
  }

  if (
    selection.rangeCount === 0 ||
    !element.contains(selection.anchorNode) ||
    !element.contains(selection.focusNode)
  ) {
    const clampedFallbackOffset = Math.max(
      0,
      Math.min(fallbackLogicalOffset, textNode.textContent?.length ?? 0),
    );
    const fallbackRange = ownerDocument.createRange();
    fallbackRange.setStart(textNode, clampedFallbackOffset);
    fallbackRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(fallbackRange);
    const focusTarget = element.closest<HTMLElement>('[contenteditable="true"]') ?? element;
    focusTarget.focus();
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
  const focusTarget = element.closest<HTMLElement>('[contenteditable="true"]') ?? element;
  focusTarget.focus();

  return getCaretOffsetWithinElement(element);
};

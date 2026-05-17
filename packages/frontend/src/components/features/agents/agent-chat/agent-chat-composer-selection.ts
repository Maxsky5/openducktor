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

const focusEditableTarget = (element: HTMLElement): void => {
  const focusTarget = element.closest<HTMLElement>('[contenteditable="true"]') ?? element;
  focusTarget.focus();
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

export const getTextOffsetWithinElement = (
  element: HTMLElement,
  container: Node,
  offset: number,
): number | null => {
  if (!element.contains(container)) {
    return null;
  }

  const measurementRange = element.ownerDocument.createRange();
  measurementRange.selectNodeContents(element);
  measurementRange.setEnd(container, offset);
  return measurementRange.toString().split(EMPTY_TEXT_SEGMENT_SENTINEL).join("").length;
};

export const getClosestTextSegmentElement = (
  node: Node | null,
  root: HTMLElement,
): HTMLElement | null => {
  const element = node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  const textSegment = element?.closest<HTMLElement>("[data-text-segment-id]") ?? null;
  if (!textSegment || !root.contains(textSegment)) {
    return null;
  }
  return textSegment;
};

export const setCaretOffsetWithinElement = (element: HTMLElement, logicalOffset: number): void => {
  const ownerDocument = element.ownerDocument;
  const selection = ownerDocument.defaultView?.getSelection() ?? globalThis.getSelection?.();
  if (!selection) {
    return;
  }

  const textNode = normalizeEditableTextNode(element);

  const textContent = textNode.textContent ?? "";
  const logicalText = readEditableTextContent(element);
  const boundedLogicalOffset = Math.max(0, Math.min(logicalOffset, logicalText.length));
  const shouldPlaceCaretAfterTrailingSentinel =
    textContent.endsWith(EMPTY_TEXT_SEGMENT_SENTINEL) &&
    logicalText.endsWith("\n") &&
    boundedLogicalOffset === logicalText.length;
  let domOffset = boundedLogicalOffset;
  if (textContent === EMPTY_TEXT_SEGMENT_SENTINEL) {
    domOffset = 1;
  } else if (shouldPlaceCaretAfterTrailingSentinel) {
    domOffset = textContent.length;
  }
  focusEditableTarget(element);
  const range = ownerDocument.createRange();
  range.setStart(textNode, domOffset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
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
    focusEditableTarget(element);
    const clampedFallbackOffset = Math.max(
      0,
      Math.min(fallbackLogicalOffset, textNode.textContent?.length ?? 0),
    );
    const fallbackRange = ownerDocument.createRange();
    fallbackRange.setStart(textNode, clampedFallbackOffset);
    fallbackRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(fallbackRange);
  }

  if (selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();
  const insertedNode = ownerDocument.createTextNode(text);
  range.insertNode(insertedNode);

  focusEditableTarget(element);
  const nextRange = ownerDocument.createRange();
  nextRange.setStart(insertedNode, insertedNode.textContent?.length ?? text.length);
  nextRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(nextRange);

  return getCaretOffsetWithinElement(element);
};

export const getComposerContentRoot = (root: HTMLElement): HTMLElement | null => {
  if (root.hasAttribute("data-composer-content-root")) {
    return root;
  }

  return root.querySelector<HTMLElement>("[data-composer-content-root]");
};

const createCollapsedRangeAtComposerEnd = (root: HTMLElement): Range | null => {
  const contentRoot = getComposerContentRoot(root);
  if (!contentRoot) {
    return null;
  }

  const range = root.ownerDocument.createRange();
  range.selectNodeContents(contentRoot);
  range.collapse(false);
  return range;
};

export const replaceComposerSelectionWithText = (root: HTMLDivElement, text: string): boolean => {
  const contentRoot = getComposerContentRoot(root);
  const selection = root.ownerDocument.defaultView?.getSelection() ?? globalThis.getSelection?.();
  if (!contentRoot || !selection) {
    return false;
  }

  const selectionRange = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const rangeInsideComposer =
    selectionRange &&
    (selectionRange.commonAncestorContainer === contentRoot ||
      contentRoot.contains(selectionRange.commonAncestorContainer));
  const range = rangeInsideComposer ? selectionRange : createCollapsedRangeAtComposerEnd(root);
  if (!range) {
    return false;
  }

  if (!rangeInsideComposer) {
    selection.removeAllRanges();
    selection.addRange(range);
  }

  range.deleteContents();

  if (text.length === 0) {
    root.focus();
    const collapsedRange = root.ownerDocument.createRange();
    collapsedRange.setStart(range.startContainer, range.startOffset);
    collapsedRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(collapsedRange);
    return true;
  }

  const textNode = root.ownerDocument.createTextNode(text);
  range.insertNode(textNode);

  root.focus();
  const collapsedRange = root.ownerDocument.createRange();
  collapsedRange.setStart(textNode, text.length);
  collapsedRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(collapsedRange);
  return true;
};

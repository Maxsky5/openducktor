import type { AgentChatComposerDraft } from "./agent-chat-composer-draft";
import {
  getClosestTextSegmentElement,
  getComposerContentRoot,
  getTextOffsetWithinElement,
} from "./agent-chat-composer-selection";

export type TextSelectionTarget = {
  segmentId: string;
  offset: number;
};

export type ActiveTextSelectionRange = {
  start: TextSelectionTarget;
  end: TextSelectionTarget;
};

const getClosestSegmentElement = (node: Node | null, root: HTMLElement): HTMLElement | null => {
  const element = node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  const segmentElement = element?.closest<HTMLElement>("[data-segment-id]") ?? null;
  if (!segmentElement || !root.contains(segmentElement)) {
    return null;
  }
  return segmentElement;
};

const getTextTargetBeforeSegment = (
  draft: AgentChatComposerDraft,
  segmentId: string,
): TextSelectionTarget | null => {
  const segmentIndex = draft.segments.findIndex((segment) => segment.id === segmentId);
  if (segmentIndex < 0) {
    return null;
  }

  for (let index = segmentIndex; index >= 0; index -= 1) {
    const segment = draft.segments[index];
    if (segment?.kind === "text") {
      return {
        segmentId: segment.id,
        offset: index === segmentIndex ? 0 : segment.text.length,
      };
    }
  }
  return null;
};

const getTextTargetAfterSegment = (
  draft: AgentChatComposerDraft,
  segmentId: string,
): TextSelectionTarget | null => {
  const segmentIndex = draft.segments.findIndex((segment) => segment.id === segmentId);
  if (segmentIndex < 0) {
    return null;
  }

  for (let index = segmentIndex; index < draft.segments.length; index += 1) {
    const segment = draft.segments[index];
    if (segment?.kind === "text") {
      return {
        segmentId: segment.id,
        offset: index === segmentIndex ? segment.text.length : 0,
      };
    }
  }
  return null;
};

const resolveTextSelectionBoundaryFromSegmentElement = (
  draft: AgentChatComposerDraft,
  segmentElement: HTMLElement,
  side: "before" | "after",
): TextSelectionTarget | null => {
  const segmentId = segmentElement.dataset.segmentId ?? segmentElement.dataset.textSegmentId ?? "";
  if (segmentId.length === 0) {
    return null;
  }

  return side === "before"
    ? getTextTargetBeforeSegment(draft, segmentId)
    : getTextTargetAfterSegment(draft, segmentId);
};

const resolveTextSelectionBoundaryFromRootOffset = (
  draft: AgentChatComposerDraft,
  contentRoot: HTMLElement,
  offset: number,
  side: "start" | "end",
): TextSelectionTarget | null => {
  const childNodes = Array.from(contentRoot.childNodes);
  const childIndex = side === "start" ? offset : offset - 1;
  const child = childNodes[childIndex] ?? null;
  if (child instanceof HTMLElement) {
    return resolveTextSelectionBoundaryFromSegmentElement(
      draft,
      child,
      side === "start" ? "before" : "after",
    );
  }

  const fallbackChild = childNodes[side === "start" ? offset - 1 : offset] ?? null;
  if (fallbackChild instanceof HTMLElement) {
    return resolveTextSelectionBoundaryFromSegmentElement(
      draft,
      fallbackChild,
      side === "start" ? "after" : "before",
    );
  }

  return null;
};

const readTextSelectionBoundary = (
  root: HTMLElement,
  draft: AgentChatComposerDraft,
  container: Node,
  offset: number,
  side: "start" | "end",
): TextSelectionTarget | null => {
  const textSegment = getClosestTextSegmentElement(container, root);
  if (textSegment) {
    const textOffset = getTextOffsetWithinElement(textSegment, container, offset);
    if (textOffset === null) {
      return null;
    }

    return {
      segmentId: textSegment.dataset.textSegmentId ?? textSegment.dataset.segmentId ?? "",
      offset: textOffset,
    };
  }

  const contentRoot = getComposerContentRoot(root);
  if (contentRoot && container === contentRoot) {
    return resolveTextSelectionBoundaryFromRootOffset(draft, contentRoot, offset, side);
  }

  const segmentElement = getClosestSegmentElement(container, root);
  if (!segmentElement) {
    return null;
  }

  return resolveTextSelectionBoundaryFromSegmentElement(
    draft,
    segmentElement,
    side === "start" ? "before" : "after",
  );
};

export const readComposerSelectionRange = (
  root: HTMLElement,
  draft: AgentChatComposerDraft,
): ActiveTextSelectionRange | null => {
  const selection = root.ownerDocument.defaultView?.getSelection() ?? globalThis.getSelection?.();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const start = readTextSelectionBoundary(
    root,
    draft,
    range.startContainer,
    range.startOffset,
    "start",
  );
  const end = readTextSelectionBoundary(root, draft, range.endContainer, range.endOffset, "end");
  if (!start || !end) {
    return null;
  }

  if (start.segmentId === end.segmentId && start.offset === end.offset) {
    return null;
  }

  return { start, end };
};

import type { RefObject } from "react";
import { useCallback, useLayoutEffect, useRef } from "react";
import {
  type AgentChatComposerDraft,
  type AgentChatComposerDraftEditResult,
  createTextSegment,
  normalizeComposerDraft,
} from "./agent-chat-composer-draft";
import {
  getCaretOffsetWithinElement,
  getComposerContentRoot,
  readEditableTextContent,
  setCaretOffsetWithinElement,
} from "./agent-chat-composer-selection";

export type ActiveTextSelection = {
  segmentId: string;
  element: HTMLElement;
  text: string;
  caretOffset: number | null;
};

export type TextSelectionTarget = {
  segmentId: string;
  offset: number;
};

export type PendingInputState = TextSelectionTarget & {
  inputType: string | null;
  data: string | null;
};

const findTextSegment = (
  draft: AgentChatComposerDraft,
  segmentId: string,
): Extract<AgentChatComposerDraft["segments"][number], { kind: "text" }> | null => {
  for (const segment of draft.segments) {
    if (segment.kind === "text" && segment.id === segmentId) {
      return segment;
    }
  }

  return null;
};

const clampTextSelectionOffset = (text: string, offset: number): number => {
  return Math.max(0, Math.min(offset, text.length));
};

export const resolveSelectionTargetFromActiveSelection = (
  draft: AgentChatComposerDraft,
  activeSelection: ActiveTextSelection | null,
): TextSelectionTarget | null => {
  if (!activeSelection) {
    return null;
  }

  return resolveTextSelectionTarget(draft, {
    segmentId: activeSelection.segmentId,
    offset: activeSelection.caretOffset ?? activeSelection.text.length,
  });
};

export const resolveTextSelectionTarget = (
  draft: AgentChatComposerDraft,
  selectionTarget: TextSelectionTarget | null,
): TextSelectionTarget | null => {
  if (!selectionTarget || selectionTarget.segmentId.length === 0) {
    return null;
  }

  const segment = findTextSegment(draft, selectionTarget.segmentId);
  if (!segment) {
    return null;
  }

  return {
    segmentId: segment.id,
    offset: clampTextSelectionOffset(segment.text, selectionTarget.offset),
  };
};

export const getLastTextSelectionTarget = (
  draft: AgentChatComposerDraft,
): TextSelectionTarget | null => {
  for (let index = draft.segments.length - 1; index >= 0; index -= 1) {
    const segment = draft.segments[index];
    if (segment?.kind !== "text") {
      continue;
    }

    return {
      segmentId: segment.id,
      offset: segment.text.length,
    };
  }

  return null;
};

export const deriveTextSelectionTargetAfterInput = (
  draft: AgentChatComposerDraft,
  pendingInputState: PendingInputState | null,
  rememberedSelection: TextSelectionTarget | null,
): TextSelectionTarget | null => {
  const rememberedTarget = resolveTextSelectionTarget(
    draft,
    pendingInputState ?? rememberedSelection,
  );
  if (!rememberedTarget) {
    return getLastTextSelectionTarget(draft);
  }

  if (!pendingInputState) {
    return rememberedTarget;
  }

  const segment = findTextSegment(draft, rememberedTarget.segmentId);
  if (!segment) {
    return getLastTextSelectionTarget(draft);
  }

  const { inputType, data } = pendingInputState;
  if (inputType === "insertLineBreak" || inputType === "insertParagraph") {
    return {
      segmentId: segment.id,
      offset: clampTextSelectionOffset(segment.text, rememberedTarget.offset + 1),
    };
  }

  if (inputType?.startsWith("insert")) {
    const offset =
      typeof data === "string" ? rememberedTarget.offset + data.length : segment.text.length;
    return {
      segmentId: segment.id,
      offset: clampTextSelectionOffset(segment.text, offset),
    };
  }

  if (inputType?.includes("Backward")) {
    return {
      segmentId: segment.id,
      offset: clampTextSelectionOffset(segment.text, rememberedTarget.offset - 1),
    };
  }

  if (inputType?.startsWith("delete")) {
    return {
      segmentId: segment.id,
      offset: clampTextSelectionOffset(segment.text, rememberedTarget.offset),
    };
  }

  return rememberedTarget;
};

const getClosestTextSegmentElement = (node: Node | null, root: HTMLElement): HTMLElement | null => {
  const element = node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  const textSegment = element?.closest<HTMLElement>("[data-text-segment-id]") ?? null;
  if (!textSegment || !root.contains(textSegment)) {
    return null;
  }
  return textSegment;
};

export const readActiveTextSelection = (
  root: HTMLElement,
  eventTarget?: EventTarget | null,
): ActiveTextSelection | null => {
  const selection = root.ownerDocument.defaultView?.getSelection() ?? globalThis.getSelection?.();
  if (selection && selection.rangeCount > 0 && selection.isCollapsed) {
    const textSegment = getClosestTextSegmentElement(selection.anchorNode, root);
    if (textSegment) {
      return {
        segmentId: textSegment.dataset.textSegmentId ?? textSegment.dataset.segmentId ?? "",
        element: textSegment,
        text: readEditableTextContent(textSegment),
        caretOffset: getCaretOffsetWithinElement(textSegment),
      };
    }
  }

  if (eventTarget instanceof Node) {
    const textSegment = getClosestTextSegmentElement(eventTarget, root);
    if (textSegment) {
      return {
        segmentId: textSegment.dataset.textSegmentId ?? textSegment.dataset.segmentId ?? "",
        element: textSegment,
        text: readEditableTextContent(textSegment),
        caretOffset: getCaretOffsetWithinElement(textSegment),
      };
    }
  }

  return null;
};

export const parseComposerDraftFromRoot = (
  root: HTMLElement,
  previousDraft: AgentChatComposerDraft,
): AgentChatComposerDraft => {
  const contentRoot = getComposerContentRoot(root);
  if (!contentRoot) {
    return previousDraft;
  }

  const previousSegments = new Map(previousDraft.segments.map((segment) => [segment.id, segment]));
  const nextSegments: AgentChatComposerDraft["segments"] = [];

  for (const node of Array.from(contentRoot.childNodes)) {
    if (node instanceof HTMLElement && node.dataset.chipSegmentId) {
      const segmentId = node.dataset.segmentId;
      const previousSegment = segmentId ? previousSegments.get(segmentId) : undefined;
      if (previousSegment && previousSegment.kind !== "text") {
        nextSegments.push(previousSegment);
      }
      continue;
    }

    if (node instanceof HTMLElement && node.dataset.textSegmentId) {
      nextSegments.push(
        createTextSegment(readEditableTextContent(node), node.dataset.textSegmentId),
      );
      continue;
    }

    if (node instanceof Text) {
      if (node.textContent && node.textContent.length > 0) {
        nextSegments.push(createTextSegment(node.textContent));
      }
      continue;
    }

    if (node instanceof HTMLElement) {
      const text = readEditableTextContent(node);
      if (text.length > 0) {
        nextSegments.push(createTextSegment(text));
      }
    }
  }

  return normalizeComposerDraft({
    segments: nextSegments.length > 0 ? nextSegments : [createTextSegment("")],
    attachments: previousDraft.attachments ?? [],
  });
};

type UseAgentChatComposerEditorSelectionArgs = {
  editorRef: RefObject<HTMLDivElement | null>;
};

export type UseAgentChatComposerEditorSelectionResult = {
  rememberSelectionTarget: (
    sourceDraft: AgentChatComposerDraft,
    selectionTarget: TextSelectionTarget | null,
  ) => void;
  getRememberedSelectionTarget: () => TextSelectionTarget | null;
  setPendingInputState: (pendingInputState: PendingInputState | null) => void;
  getPendingInputState: () => PendingInputState | null;
  clearPendingInputState: () => void;
  focusTextSegment: (segmentId: string, offset: number) => boolean;
  setPendingFocusTarget: (focusTarget: AgentChatComposerDraftEditResult["focusTarget"]) => void;
  resolveActiveTextSelection: (
    root: HTMLDivElement,
    sourceDraft: AgentChatComposerDraft,
    eventTarget?: EventTarget | null,
  ) => ActiveTextSelection | null;
  resolveSelectionTargetForLineBreak: (
    root: HTMLDivElement,
    sourceDraft: AgentChatComposerDraft,
    activeSelection: ActiveTextSelection | null,
  ) => TextSelectionTarget | null;
  focusTextSegmentWithMemory: (
    segmentId: string,
    offset: number,
    sourceDraft: AgentChatComposerDraft,
  ) => boolean;
  focusLastTextSegment: (sourceDraft: AgentChatComposerDraft) => void;
};

const usePendingFocus = (editorRef: RefObject<HTMLDivElement | null>) => {
  const pendingFocusRef = useRef<AgentChatComposerDraftEditResult["focusTarget"]>(null);

  const applyFocusTarget = useCallback(
    (focusTarget: NonNullable<AgentChatComposerDraftEditResult["focusTarget"]>): boolean => {
      const root = editorRef.current;
      const target = root?.querySelector<HTMLElement>(
        `[data-text-segment-id="${CSS.escape(focusTarget.segmentId)}"]`,
      );
      if (!target) {
        return false;
      }

      setCaretOffsetWithinElement(target, focusTarget.offset);
      return true;
    },
    [editorRef],
  );

  useLayoutEffect(() => {
    const pendingFocus = pendingFocusRef.current;
    if (!pendingFocus) {
      return;
    }

    if (applyFocusTarget(pendingFocus)) {
      pendingFocusRef.current = null;
    }

    const requestAnimationFrameFn = globalThis.requestAnimationFrame;
    if (typeof requestAnimationFrameFn !== "function") {
      return;
    }

    const rafId = requestAnimationFrameFn(() => {
      const nextPendingFocus = pendingFocusRef.current ?? pendingFocus;
      if (applyFocusTarget(nextPendingFocus)) {
        pendingFocusRef.current = null;
      }
    });

    return () => {
      const cancelAnimationFrameFn = globalThis.cancelAnimationFrame;
      if (typeof cancelAnimationFrameFn === "function") {
        cancelAnimationFrameFn(rafId);
      }
    };
  });

  return {
    focusTextSegment: (segmentId: string, offset: number): boolean => {
      const root = editorRef.current;
      const target = root?.querySelector<HTMLElement>(
        `[data-text-segment-id="${CSS.escape(segmentId)}"]`,
      );
      if (!target) {
        return false;
      }
      setCaretOffsetWithinElement(target, offset);
      return true;
    },
    setPendingFocusTarget: (focusTarget: AgentChatComposerDraftEditResult["focusTarget"]) => {
      pendingFocusRef.current = focusTarget;
    },
  };
};

export const useAgentChatComposerEditorSelection = ({
  editorRef,
}: UseAgentChatComposerEditorSelectionArgs): UseAgentChatComposerEditorSelectionResult => {
  const rememberedSelectionRef = useRef<TextSelectionTarget | null>(null);
  const pendingInputStateRef = useRef<PendingInputState | null>(null);
  const { focusTextSegment, setPendingFocusTarget } = usePendingFocus(editorRef);

  const rememberSelectionTarget = useCallback(
    (sourceDraft: AgentChatComposerDraft, selectionTarget: TextSelectionTarget | null) => {
      rememberedSelectionRef.current = resolveTextSelectionTarget(sourceDraft, selectionTarget);
    },
    [],
  );

  const getRememberedSelectionTarget = useCallback(() => {
    return rememberedSelectionRef.current;
  }, []);

  const setPendingInputState = useCallback((pendingInputState: PendingInputState | null) => {
    pendingInputStateRef.current = pendingInputState;
  }, []);

  const getPendingInputState = useCallback(() => {
    return pendingInputStateRef.current;
  }, []);

  const clearPendingInputState = useCallback(() => {
    pendingInputStateRef.current = null;
  }, []);

  const getFallbackSelectionTarget = useCallback((sourceDraft: AgentChatComposerDraft) => {
    return (
      resolveTextSelectionTarget(sourceDraft, rememberedSelectionRef.current) ??
      getLastTextSelectionTarget(sourceDraft)
    );
  }, []);

  const repairCollapsedSelection = useCallback(
    (root: HTMLDivElement, sourceDraft: AgentChatComposerDraft): ActiveTextSelection | null => {
      const selection =
        root.ownerDocument.defaultView?.getSelection() ?? globalThis.getSelection?.();
      if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
        return null;
      }

      const fallbackTarget = getFallbackSelectionTarget(sourceDraft);
      if (!fallbackTarget) {
        return null;
      }

      const didFocus = focusTextSegment(fallbackTarget.segmentId, fallbackTarget.offset);
      if (!didFocus) {
        setPendingFocusTarget(fallbackTarget);
        return null;
      }

      rememberSelectionTarget(sourceDraft, fallbackTarget);
      const repairedElement = root.querySelector<HTMLElement>(
        `[data-text-segment-id="${CSS.escape(fallbackTarget.segmentId)}"]`,
      );
      if (!repairedElement) {
        return null;
      }

      return {
        segmentId: fallbackTarget.segmentId,
        element: repairedElement,
        text: readEditableTextContent(repairedElement),
        caretOffset: fallbackTarget.offset,
      };
    },
    [focusTextSegment, getFallbackSelectionTarget, rememberSelectionTarget, setPendingFocusTarget],
  );

  const resolveActiveTextSelection = useCallback(
    (
      root: HTMLDivElement,
      sourceDraft: AgentChatComposerDraft,
      eventTarget?: EventTarget | null,
    ) => {
      return (
        readActiveTextSelection(root, eventTarget) ?? repairCollapsedSelection(root, sourceDraft)
      );
    },
    [repairCollapsedSelection],
  );

  const resolveSelectionTargetForLineBreak = useCallback(
    (
      root: HTMLDivElement,
      sourceDraft: AgentChatComposerDraft,
      activeSelection: ActiveTextSelection | null,
    ): TextSelectionTarget | null => {
      const resolvedActiveSelection =
        activeSelection ?? resolveActiveTextSelection(root, sourceDraft);
      return (
        resolveSelectionTargetFromActiveSelection(sourceDraft, resolvedActiveSelection) ??
        getFallbackSelectionTarget(sourceDraft)
      );
    },
    [getFallbackSelectionTarget, resolveActiveTextSelection],
  );

  const focusTextSegmentWithMemory = useCallback(
    (segmentId: string, offset: number, sourceDraft: AgentChatComposerDraft) => {
      const selectionTarget = resolveTextSelectionTarget(sourceDraft, { segmentId, offset });
      if (!selectionTarget) {
        return false;
      }

      rememberSelectionTarget(sourceDraft, selectionTarget);
      const didFocus = focusTextSegment(selectionTarget.segmentId, selectionTarget.offset);
      if (!didFocus) {
        setPendingFocusTarget(selectionTarget);
      }
      return didFocus;
    },
    [focusTextSegment, rememberSelectionTarget, setPendingFocusTarget],
  );

  const focusLastTextSegment = useCallback(
    (sourceDraft: AgentChatComposerDraft) => {
      for (let index = sourceDraft.segments.length - 1; index >= 0; index -= 1) {
        const segment = sourceDraft.segments[index];
        if (!segment || segment.kind !== "text") {
          continue;
        }
        focusTextSegmentWithMemory(segment.id, segment.text.length, sourceDraft);
        return;
      }
    },
    [focusTextSegmentWithMemory],
  );

  return {
    rememberSelectionTarget,
    getRememberedSelectionTarget,
    setPendingInputState,
    getPendingInputState,
    clearPendingInputState,
    focusTextSegment,
    setPendingFocusTarget,
    resolveActiveTextSelection,
    resolveSelectionTargetForLineBreak,
    focusTextSegmentWithMemory,
    focusLastTextSegment,
  };
};

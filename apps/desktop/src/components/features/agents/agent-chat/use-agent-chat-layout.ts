import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export const CHAT_AUTOSCROLL_THRESHOLD_PX = 48;
export const COMPOSER_TEXTAREA_MIN_HEIGHT_PX = 44;
export const COMPOSER_TEXTAREA_MAX_HEIGHT_PX = 220;
export const CHAT_PROGRAMMATIC_AUTOSCROLL_DATASET = "odtAutoscrolling";
export const CHAT_PROGRAMMATIC_AUTOSCROLL_TOLERANCE_PX = 1;

type ScrollableElement = Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">;

export const isNearBottom = (element: ScrollableElement): boolean => {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <= CHAT_AUTOSCROLL_THRESHOLD_PX
  );
};

export const computeComposerTextareaLayout = (
  scrollHeight: number,
): {
  heightPx: number;
  overflowY: "auto" | "hidden";
} => {
  const heightPx = Math.min(
    COMPOSER_TEXTAREA_MAX_HEIGHT_PX,
    Math.max(COMPOSER_TEXTAREA_MIN_HEIGHT_PX, scrollHeight),
  );
  return {
    heightPx,
    overflowY: scrollHeight > COMPOSER_TEXTAREA_MAX_HEIGHT_PX ? "auto" : "hidden",
  };
};

const readComposerTextareaHeight = (textarea: HTMLTextAreaElement): number => {
  const inlineHeight = Number.parseFloat(textarea.style.height);
  if (Number.isFinite(inlineHeight) && inlineHeight > 0) {
    return inlineHeight;
  }
  return textarea.getBoundingClientRect().height;
};

export const resizeComposerTextareaElement = (
  textarea: HTMLTextAreaElement,
): {
  didHeightChange: boolean;
  overflowY: "auto" | "hidden";
} => {
  const currentHeight = readComposerTextareaHeight(textarea);
  textarea.style.height = "auto";
  const layout = computeComposerTextareaLayout(textarea.scrollHeight);
  const didHeightChange = Math.abs(currentHeight - layout.heightPx) > 0.5;
  textarea.style.height = `${layout.heightPx}px`;
  if (textarea.style.overflowY !== layout.overflowY) {
    textarea.style.overflowY = layout.overflowY;
  }
  return {
    didHeightChange,
    overflowY: layout.overflowY,
  };
};

export const computeTodoPanelBottomOffset = (_composerFormHeight: number): number => {
  return 12;
};

export const scrollMessagesContainerToBottom = (
  container: Pick<
    HTMLDivElement,
    "dataset" | "scrollHeight" | "clientHeight" | "scrollTop" | "scrollTo"
  > | null,
): void => {
  if (!container) {
    return;
  }

  const nextTop = Math.max(0, container.scrollHeight - container.clientHeight);
  container.dataset[CHAT_PROGRAMMATIC_AUTOSCROLL_DATASET] = String(nextTop);
  container.scrollTo({
    top: nextTop,
    behavior: "auto",
  });
};

const adjustMessagesContainerScrollBy = (
  container: Pick<
    HTMLDivElement,
    "dataset" | "scrollHeight" | "clientHeight" | "scrollTop" | "scrollTo"
  > | null,
  deltaPx: number,
): void => {
  if (!container || !Number.isFinite(deltaPx) || deltaPx === 0) {
    return;
  }

  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const nextTop = Math.min(Math.max(container.scrollTop + deltaPx, 0), maxScrollTop);
  container.dataset[CHAT_PROGRAMMATIC_AUTOSCROLL_DATASET] = String(nextTop);
  container.scrollTo({
    top: nextTop,
    behavior: "auto",
  });
};

type UseAgentChatLayoutInput = {
  input: string;
  activeSessionId: string | null;
};

type UseAgentChatLayoutResult = {
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  composerFormRef: RefObject<HTMLFormElement | null>;
  composerTextareaRef: RefObject<HTMLTextAreaElement | null>;
  isPinnedToBottom: boolean;
  setIsPinnedToBottom: Dispatch<SetStateAction<boolean>>;
  todoPanelBottomOffset: number;
  resizeComposerTextarea: () => void;
};

export const useAgentChatLayout = ({
  input,
  activeSessionId,
}: UseAgentChatLayoutInput): UseAgentChatLayoutResult => {
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const composerFormRef = useRef<HTMLFormElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const previousSessionIdRef = useRef<string | null>(activeSessionId);
  const previousComposerFormHeightRef = useRef<number | null>(null);
  const shouldRepinAfterComposerResizeRef = useRef(false);
  const composerRepinRafRef = useRef<number | null>(null);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const [composerFormHeight, setComposerFormHeight] = useState(0);

  const resizeComposerTextarea = useCallback((): void => {
    const textarea = composerTextareaRef.current;
    if (!textarea) {
      return;
    }
    const previousTextareaHeight = readComposerTextareaHeight(textarea);
    shouldRepinAfterComposerResizeRef.current = isPinnedToBottom;
    const resizeResult = resizeComposerTextareaElement(textarea);
    const nextTextareaHeight = readComposerTextareaHeight(textarea);
    if (
      isPinnedToBottom &&
      (Math.abs(nextTextareaHeight - previousTextareaHeight) > 0.5 ||
        resizeResult.overflowY === "auto") &&
      typeof window !== "undefined"
    ) {
      if (composerRepinRafRef.current !== null) {
        window.cancelAnimationFrame(composerRepinRafRef.current);
      }
      composerRepinRafRef.current = window.requestAnimationFrame(() => {
        composerRepinRafRef.current = null;
        scrollMessagesContainerToBottom(messagesContainerRef.current);
      });
    }
  }, [isPinnedToBottom]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Input string is an explicit resize trigger.
  useLayoutEffect(() => {
    resizeComposerTextarea();
  }, [input, resizeComposerTextarea]);

  useEffect(() => {
    const form = composerFormRef.current;
    if (!form) {
      setComposerFormHeight(0);
      return;
    }

    const measure = () => {
      setComposerFormHeight(form.offsetHeight);
    };

    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(form);
    return () => {
      observer.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    const previousComposerFormHeight = previousComposerFormHeightRef.current;
    previousComposerFormHeightRef.current = composerFormHeight;
    if (previousComposerFormHeight === null || previousComposerFormHeight === composerFormHeight) {
      return;
    }

    const shouldRepinAfterComposerResize = shouldRepinAfterComposerResizeRef.current;
    shouldRepinAfterComposerResizeRef.current = false;
    if (!shouldRepinAfterComposerResize || typeof window === "undefined") {
      return;
    }

    if (composerRepinRafRef.current !== null) {
      window.cancelAnimationFrame(composerRepinRafRef.current);
      composerRepinRafRef.current = null;
    }

    const composerHeightDelta = composerFormHeight - previousComposerFormHeight;
    adjustMessagesContainerScrollBy(messagesContainerRef.current, composerHeightDelta);
  }, [composerFormHeight]);

  useEffect(() => {
    if (previousSessionIdRef.current === activeSessionId) {
      return;
    }
    previousSessionIdRef.current = activeSessionId;
    shouldRepinAfterComposerResizeRef.current = false;
    if (composerRepinRafRef.current !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(composerRepinRafRef.current);
      composerRepinRafRef.current = null;
    }
    setIsPinnedToBottom(true);
  }, [activeSessionId]);

  useEffect(() => {
    return () => {
      if (composerRepinRafRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(composerRepinRafRef.current);
      }
    };
  }, []);

  return {
    messagesContainerRef,
    composerFormRef,
    composerTextareaRef,
    isPinnedToBottom,
    setIsPinnedToBottom,
    todoPanelBottomOffset: computeTodoPanelBottomOffset(composerFormHeight),
    resizeComposerTextarea,
  };
};

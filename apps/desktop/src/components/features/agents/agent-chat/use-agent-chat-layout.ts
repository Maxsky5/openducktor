import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

export const CHAT_AUTOSCROLL_THRESHOLD_PX = 48;
export const COMPOSER_TEXTAREA_MIN_HEIGHT_PX = 40;
export const COMPOSER_TEXTAREA_MAX_HEIGHT_PX = 220;

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

export const computeTodoPanelBottomOffset = (_composerFormHeight: number): number => {
  return 12;
};

type UseAgentChatLayoutInput = {
  input: string;
  scrollTrigger: string;
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
  scrollTrigger,
  activeSessionId,
}: UseAgentChatLayoutInput): UseAgentChatLayoutResult => {
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const composerFormRef = useRef<HTMLFormElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const [composerFormHeight, setComposerFormHeight] = useState(0);

  const resizeComposerTextarea = useCallback((): void => {
    const textarea = composerTextareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "0px";
    const layout = computeComposerTextareaLayout(textarea.scrollHeight);
    textarea.style.height = `${layout.heightPx}px`;
    textarea.style.overflowY = layout.overflowY;
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Input string is an explicit resize trigger.
  useEffect(() => {
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: Composer height is an explicit autoscroll trigger.
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container || !isPinnedToBottom) {
      return;
    }
    container.scrollTo({
      top: container.scrollHeight,
      behavior: "auto",
    });
  }, [composerFormHeight, isPinnedToBottom]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Scroll trigger is a parent-owned version key.
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container || !isPinnedToBottom) {
      return;
    }
    container.scrollTo({
      top: container.scrollHeight,
      behavior: "auto",
    });
  }, [isPinnedToBottom, scrollTrigger]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Session identity reset should repin to bottom.
  useEffect(() => {
    setIsPinnedToBottom(true);

    const scrollToBottom = (): void => {
      const container = messagesContainerRef.current;
      if (!container) {
        return;
      }
      container.scrollTo({
        top: container.scrollHeight,
        behavior: "auto",
      });
    };

    scrollToBottom();

    if (typeof window === "undefined") {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      scrollToBottom();
    });
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [activeSessionId]);

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

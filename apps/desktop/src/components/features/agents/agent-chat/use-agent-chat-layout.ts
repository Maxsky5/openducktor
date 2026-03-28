import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

export const COMPOSER_TEXTAREA_MIN_HEIGHT_PX = 44;
export const COMPOSER_TEXTAREA_MAX_HEIGHT_PX = 220;

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
  const isEmptyDraft = textarea.value.length === 0;
  if (isEmptyDraft) {
    const nextHeight = COMPOSER_TEXTAREA_MIN_HEIGHT_PX;
    const didHeightChange = Math.abs(currentHeight - nextHeight) > 0.5;
    if (didHeightChange) {
      textarea.style.height = `${nextHeight}px`;
    }
    if (textarea.style.overflowY !== "hidden") {
      textarea.style.overflowY = "hidden";
    }
    return {
      didHeightChange,
      overflowY: "hidden",
    };
  }

  const layout = computeComposerTextareaLayout(textarea.scrollHeight);
  const didHeightChange = Math.abs(currentHeight - layout.heightPx) > 0.5;
  if (didHeightChange) {
    textarea.style.height = `${layout.heightPx}px`;
  }
  if (textarea.style.overflowY !== layout.overflowY) {
    textarea.style.overflowY = layout.overflowY;
  }
  return {
    didHeightChange,
    overflowY: layout.overflowY,
  };
};

type UseAgentChatLayoutInput = {
  input: string;
  activeSessionId: string | null;
};

type UseAgentChatLayoutResult = {
  messagesContainerRef: React.RefObject<HTMLDivElement | null>;
  composerFormRef: React.RefObject<HTMLFormElement | null>;
  composerTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  resizeComposerTextarea: () => void;
};

export const useAgentChatLayout = ({
  input,
  activeSessionId,
}: UseAgentChatLayoutInput): UseAgentChatLayoutResult => {
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const composerFormRef = useRef<HTMLFormElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const resizeFrameIdRef = useRef<number | null>(null);
  const previousInputRef = useRef(input);
  const didInitializeTextareaForSessionRef = useRef(false);

  const flushComposerTextareaResize = useCallback((): void => {
    const textarea = composerTextareaRef.current;
    if (!textarea) {
      return;
    }

    resizeComposerTextareaElement(textarea);
  }, []);

  const resizeComposerTextarea = useCallback((): void => {
    const requestAnimationFrameFn = globalThis.requestAnimationFrame;
    if (typeof requestAnimationFrameFn !== "function") {
      flushComposerTextareaResize();
      return;
    }

    if (resizeFrameIdRef.current !== null) {
      return;
    }

    resizeFrameIdRef.current = requestAnimationFrameFn(() => {
      resizeFrameIdRef.current = null;
      flushComposerTextareaResize();
    });
  }, [flushComposerTextareaResize]);

  useLayoutEffect(() => {
    didInitializeTextareaForSessionRef.current = false;
    const hasActiveSession = activeSessionId !== null;
    if (hasActiveSession && resizeFrameIdRef.current !== null) {
      const cancelAnimationFrameFn = globalThis.cancelAnimationFrame;
      if (typeof cancelAnimationFrameFn === "function") {
        cancelAnimationFrameFn(resizeFrameIdRef.current);
      }
      resizeFrameIdRef.current = null;
    }

    flushComposerTextareaResize();
    resizeComposerTextarea();
  }, [activeSessionId, flushComposerTextareaResize, resizeComposerTextarea]);

  useLayoutEffect(() => {
    if (didInitializeTextareaForSessionRef.current) {
      return;
    }
    if (!composerTextareaRef.current) {
      return;
    }

    didInitializeTextareaForSessionRef.current = true;
    flushComposerTextareaResize();
    resizeComposerTextarea();
  });

  useEffect(() => {
    if (previousInputRef.current === input) {
      return;
    }
    previousInputRef.current = input;
    resizeComposerTextarea();
  }, [input, resizeComposerTextarea]);

  useEffect(() => {
    return () => {
      if (resizeFrameIdRef.current === null) {
        return;
      }
      const cancelAnimationFrameFn = globalThis.cancelAnimationFrame;
      if (typeof cancelAnimationFrameFn === "function") {
        cancelAnimationFrameFn(resizeFrameIdRef.current);
      }
      resizeFrameIdRef.current = null;
    };
  }, []);

  return {
    messagesContainerRef,
    composerFormRef,
    composerTextareaRef,
    resizeComposerTextarea,
  };
};

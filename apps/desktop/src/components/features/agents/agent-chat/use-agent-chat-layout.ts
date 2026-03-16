import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

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

type UseAgentChatLayoutInput = {
  input: string;
  activeSessionId: string | null;
};

type UseAgentChatLayoutResult = {
  messagesContainerRef: React.RefObject<HTMLDivElement | null>;
  composerFormRef: React.RefObject<HTMLFormElement | null>;
  composerTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  todoPanelBottomOffset: number;
  resizeComposerTextarea: () => void;
};

export const useAgentChatLayout = ({
  input,
  activeSessionId: _activeSessionId,
}: UseAgentChatLayoutInput): UseAgentChatLayoutResult => {
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const composerFormRef = useRef<HTMLFormElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [composerFormHeight, setComposerFormHeight] = useState(0);

  const resizeComposerTextarea = useCallback((): void => {
    const textarea = composerTextareaRef.current;
    if (!textarea) {
      return;
    }

    resizeComposerTextareaElement(textarea);
  }, []);

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

  return {
    messagesContainerRef,
    composerFormRef,
    composerTextareaRef,
    todoPanelBottomOffset: computeTodoPanelBottomOffset(composerFormHeight),
    resizeComposerTextarea,
  };
};

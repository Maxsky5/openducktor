import type { MutableRefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { CHAT_SCROLL_EDGE_THRESHOLD_PX } from "./agent-chat-window-shared";

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

const CLONE_MEASUREMENT_STYLE_PROPERTIES = [
  "boxSizing",
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "textIndent",
  "textTransform",
  "whiteSpace",
  "wordBreak",
  "wordSpacing",
  "overflowWrap",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
] as const satisfies ReadonlyArray<keyof CSSStyleDeclaration>;

const measureComposerTextareaScrollHeight = (textarea: HTMLTextAreaElement): number => {
  const ownerDocument = textarea.ownerDocument;
  const body = ownerDocument?.body;
  if (!ownerDocument || !body || typeof textarea.cloneNode !== "function") {
    return textarea.scrollHeight;
  }

  const clone = textarea.cloneNode(false) as HTMLTextAreaElement;
  const getComputedStyleFn =
    ownerDocument.defaultView?.getComputedStyle ?? globalThis.getComputedStyle;
  if (typeof getComputedStyleFn === "function") {
    const computedStyle = getComputedStyleFn(textarea);
    for (const property of CLONE_MEASUREMENT_STYLE_PROPERTIES) {
      clone.style[property] = computedStyle[property];
    }
  }

  clone.value = textarea.value;
  clone.rows = textarea.rows;
  clone.setAttribute("aria-hidden", "true");
  clone.setAttribute("tabindex", "-1");

  const width = textarea.getBoundingClientRect().width;
  clone.style.position = "absolute";
  clone.style.top = "0";
  clone.style.left = "-9999px";
  clone.style.height = "0px";
  clone.style.minHeight = "0px";
  clone.style.maxHeight = "none";
  clone.style.overflowY = "hidden";
  clone.style.visibility = "hidden";
  clone.style.pointerEvents = "none";
  clone.style.zIndex = "-1";
  if (width > 0) {
    clone.style.width = `${width}px`;
  }

  body.appendChild(clone);
  const measuredScrollHeight = clone.scrollHeight;
  clone.remove();
  return measuredScrollHeight;
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

  const layout = computeComposerTextareaLayout(measureComposerTextareaScrollHeight(textarea));

  const didHeightChange = Math.abs(currentHeight - layout.heightPx) > 0.5;
  const nextInlineHeight = `${layout.heightPx}px`;
  if (didHeightChange) {
    textarea.style.height = nextInlineHeight;
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
  syncBottomAfterComposerLayoutRef?: MutableRefObject<(() => void) | null>;
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
  syncBottomAfterComposerLayoutRef,
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

    const container = messagesContainerRef.current;
    const wasNearBottom =
      container !== null
        ? container.scrollHeight - container.scrollTop - container.clientHeight <=
          CHAT_SCROLL_EDGE_THRESHOLD_PX
        : false;
    const { didHeightChange } = resizeComposerTextareaElement(textarea);
    if (wasNearBottom && didHeightChange) {
      syncBottomAfterComposerLayoutRef?.current?.();
    }
  }, [syncBottomAfterComposerLayoutRef]);

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

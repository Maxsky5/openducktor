import type { MutableRefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { CHAT_SCROLL_EDGE_THRESHOLD_PX } from "./agent-chat-window-shared";

export const COMPOSER_EDITOR_MIN_HEIGHT_PX = 44;
export const COMPOSER_EDITOR_MAX_HEIGHT_PX = 220;
export const COMPOSER_TEXTAREA_MIN_HEIGHT_PX = COMPOSER_EDITOR_MIN_HEIGHT_PX;
export const COMPOSER_TEXTAREA_MAX_HEIGHT_PX = COMPOSER_EDITOR_MAX_HEIGHT_PX;

const readInlineHeightPx = (styleHeight: string): number | null => {
  const inlineHeight = Number.parseFloat(styleHeight);
  if (Number.isFinite(inlineHeight) && inlineHeight > 0) {
    return inlineHeight;
  }
  return null;
};

export const computeComposerEditorLayout = (
  scrollHeight: number,
): {
  heightPx: number;
  overflowY: "auto" | "hidden";
} => {
  const heightPx = Math.min(
    COMPOSER_EDITOR_MAX_HEIGHT_PX,
    Math.max(COMPOSER_EDITOR_MIN_HEIGHT_PX, scrollHeight),
  );
  return {
    heightPx,
    overflowY: scrollHeight > COMPOSER_EDITOR_MAX_HEIGHT_PX ? "auto" : "hidden",
  };
};

export const computeComposerTextareaLayout = computeComposerEditorLayout;

const readComposerEditorHeight = (editor: HTMLDivElement, previousHeightPx?: number): number => {
  const inlineHeight = readInlineHeightPx(editor.style.height);
  if (inlineHeight !== null) {
    return inlineHeight;
  }
  if (
    typeof previousHeightPx === "number" &&
    Number.isFinite(previousHeightPx) &&
    previousHeightPx > 0
  ) {
    return previousHeightPx;
  }
  return editor.getBoundingClientRect().height;
};

export const resizeComposerEditorElement = (
  editor: HTMLDivElement,
  serializedDraftText?: string,
  previousHeightPx?: number,
): {
  didHeightChange: boolean;
  overflowY: "auto" | "hidden";
} => {
  const resolvedSerializedDraftText = serializedDraftText ?? editor.textContent ?? "";
  const currentHeight = readComposerEditorHeight(editor, previousHeightPx);
  if (resolvedSerializedDraftText.length === 0) {
    const nextHeight = COMPOSER_EDITOR_MIN_HEIGHT_PX;
    const didHeightChange = Math.abs(currentHeight - nextHeight) > 0.5;
    if (didHeightChange) {
      editor.style.height = `${nextHeight}px`;
    }
    if (editor.style.overflowY !== "hidden") {
      editor.style.overflowY = "hidden";
    }
    return {
      didHeightChange,
      overflowY: "hidden",
    };
  }

  const previousInlineHeight = editor.style.height;
  editor.style.height = "auto";
  const layout = computeComposerEditorLayout(editor.scrollHeight);
  editor.style.height = previousInlineHeight;
  const didHeightChange = Math.abs(currentHeight - layout.heightPx) > 0.5;
  if (didHeightChange) {
    editor.style.height = `${layout.heightPx}px`;
  }
  if (editor.style.overflowY !== layout.overflowY) {
    editor.style.overflowY = layout.overflowY;
  }

  return {
    didHeightChange,
    overflowY: layout.overflowY,
  };
};

export const resizeComposerTextareaElement = (
  editor: HTMLDivElement | HTMLTextAreaElement,
  serializedDraftText?: string,
  previousHeightPx?: number,
): {
  didHeightChange: boolean;
  overflowY: "auto" | "hidden";
} =>
  resizeComposerEditorElement(
    editor as HTMLDivElement,
    serializedDraftText ??
      (editor as unknown as { value?: string }).value ??
      editor.textContent ??
      "",
    previousHeightPx,
  );

type UseAgentChatLayoutInput = {
  input?: string;
  activeSessionId: string | null;
  syncBottomAfterComposerLayoutRef?: MutableRefObject<(() => void) | null>;
};

type UseAgentChatLayoutResult = {
  messagesContainerRef: React.RefObject<HTMLDivElement | null>;
  composerFormRef: React.RefObject<HTMLFormElement | null>;
  composerEditorRef: React.RefObject<HTMLDivElement | null>;
  resizeComposerEditor: () => void;
  composerTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  resizeComposerTextarea: () => void;
};

export const useAgentChatLayout = ({
  input: _input,
  activeSessionId,
  syncBottomAfterComposerLayoutRef,
}: UseAgentChatLayoutInput): UseAgentChatLayoutResult => {
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const composerFormRef = useRef<HTMLFormElement | null>(null);
  const composerEditorRef = useRef<HTMLDivElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const resizeFrameIdRef = useRef<number | null>(null);
  const resizeTextareaFrameIdRef = useRef<number | null>(null);
  const didInitializeComposerForSessionRef = useRef(false);
  const composerEditorHeightRef = useRef(COMPOSER_EDITOR_MIN_HEIGHT_PX);
  const composerTextareaHeightRef = useRef(COMPOSER_TEXTAREA_MIN_HEIGHT_PX);

  const flushComposerEditorResize = useCallback((): void => {
    const editor = composerEditorRef.current;
    if (!editor) {
      return;
    }

    const container = messagesContainerRef.current;
    const wasNearBottom =
      container !== null
        ? container.scrollHeight - container.scrollTop - container.clientHeight <=
          CHAT_SCROLL_EDGE_THRESHOLD_PX
        : false;
    const { didHeightChange } = resizeComposerEditorElement(
      editor,
      undefined,
      composerEditorHeightRef.current,
    );
    composerEditorHeightRef.current =
      readInlineHeightPx(editor.style.height) ??
      ((editor.textContent ?? "").length === 0
        ? COMPOSER_EDITOR_MIN_HEIGHT_PX
        : composerEditorHeightRef.current);
    if (wasNearBottom && didHeightChange) {
      syncBottomAfterComposerLayoutRef?.current?.();
    }
  }, [syncBottomAfterComposerLayoutRef]);

  const resizeComposerEditor = useCallback((): void => {
    const requestAnimationFrameFn = globalThis.requestAnimationFrame;
    if (typeof requestAnimationFrameFn !== "function") {
      flushComposerEditorResize();
      return;
    }

    if (resizeFrameIdRef.current !== null) {
      return;
    }

    resizeFrameIdRef.current = requestAnimationFrameFn(() => {
      resizeFrameIdRef.current = null;
      flushComposerEditorResize();
    });
  }, [flushComposerEditorResize]);

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
    const { didHeightChange } = resizeComposerTextareaElement(
      textarea,
      undefined,
      composerTextareaHeightRef.current,
    );
    composerTextareaHeightRef.current =
      readInlineHeightPx(textarea.style.height) ??
      (textarea.value.length === 0
        ? COMPOSER_TEXTAREA_MIN_HEIGHT_PX
        : composerTextareaHeightRef.current);
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

    if (resizeTextareaFrameIdRef.current !== null) {
      return;
    }

    resizeTextareaFrameIdRef.current = requestAnimationFrameFn(() => {
      resizeTextareaFrameIdRef.current = null;
      flushComposerTextareaResize();
    });
  }, [flushComposerTextareaResize]);

  useLayoutEffect(() => {
    didInitializeComposerForSessionRef.current = false;
    composerEditorHeightRef.current = COMPOSER_EDITOR_MIN_HEIGHT_PX;
    composerTextareaHeightRef.current = COMPOSER_TEXTAREA_MIN_HEIGHT_PX;
    const hasActiveSession = activeSessionId !== null;
    if (hasActiveSession && resizeFrameIdRef.current !== null) {
      const cancelAnimationFrameFn = globalThis.cancelAnimationFrame;
      if (typeof cancelAnimationFrameFn === "function") {
        cancelAnimationFrameFn(resizeFrameIdRef.current);
      }
      resizeFrameIdRef.current = null;
    }

    flushComposerEditorResize();
    resizeComposerEditor();
  }, [activeSessionId, flushComposerEditorResize, resizeComposerEditor]);

  useLayoutEffect(() => {
    if (didInitializeComposerForSessionRef.current) {
      return;
    }
    if (!composerEditorRef.current) {
      return;
    }

    didInitializeComposerForSessionRef.current = true;
    flushComposerEditorResize();
    resizeComposerEditor();
  });

  useEffect(() => {
    return () => {
      const cancelAnimationFrameFn = globalThis.cancelAnimationFrame;
      if (resizeFrameIdRef.current !== null && typeof cancelAnimationFrameFn === "function") {
        cancelAnimationFrameFn(resizeFrameIdRef.current);
      }
      resizeFrameIdRef.current = null;
      if (
        resizeTextareaFrameIdRef.current !== null &&
        typeof cancelAnimationFrameFn === "function"
      ) {
        cancelAnimationFrameFn(resizeTextareaFrameIdRef.current);
      }
      resizeTextareaFrameIdRef.current = null;
    };
  }, []);

  return {
    messagesContainerRef,
    composerFormRef,
    composerEditorRef,
    resizeComposerEditor,
    composerTextareaRef,
    resizeComposerTextarea,
  };
};

import type { MutableRefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { CHAT_SCROLL_EDGE_THRESHOLD_PX } from "./agent-chat-window-shared";

export const COMPOSER_EDITOR_MIN_HEIGHT_PX = 44;
export const COMPOSER_EDITOR_MAX_HEIGHT_PX = 220;
export const COMPOSER_TEXTAREA_MIN_HEIGHT_PX = COMPOSER_EDITOR_MIN_HEIGHT_PX;
export const COMPOSER_TEXTAREA_MAX_HEIGHT_PX = COMPOSER_EDITOR_MAX_HEIGHT_PX;

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

const readComposerEditorHeight = (editor: HTMLDivElement): number => {
  const inlineHeight = Number.parseFloat(editor.style.height);
  if (Number.isFinite(inlineHeight) && inlineHeight > 0) {
    return inlineHeight;
  }
  return editor.getBoundingClientRect().height;
};

export const resizeComposerEditorElement = (
  editor: HTMLDivElement,
  serializedDraftText: string,
): {
  didHeightChange: boolean;
  overflowY: "auto" | "hidden";
} => {
  const currentHeight = readComposerEditorHeight(editor);
  if (serializedDraftText.length === 0) {
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

  const layout = computeComposerEditorLayout(editor.scrollHeight);
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
  );

type UseAgentChatLayoutInput = {
  serializedDraftText?: string;
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
  serializedDraftText,
  input,
  activeSessionId,
  syncBottomAfterComposerLayoutRef,
}: UseAgentChatLayoutInput): UseAgentChatLayoutResult => {
  const resolvedSerializedDraftText = serializedDraftText ?? input ?? "";
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const composerFormRef = useRef<HTMLFormElement | null>(null);
  const composerEditorRef = useRef<HTMLDivElement | null>(null);
  const resizeFrameIdRef = useRef<number | null>(null);
  const previousDraftTextRef = useRef(resolvedSerializedDraftText);
  const didInitializeComposerForSessionRef = useRef(false);

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
    const { didHeightChange } = resizeComposerEditorElement(editor, resolvedSerializedDraftText);
    if (wasNearBottom && didHeightChange) {
      syncBottomAfterComposerLayoutRef?.current?.();
    }
  }, [resolvedSerializedDraftText, syncBottomAfterComposerLayoutRef]);

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

  useLayoutEffect(() => {
    didInitializeComposerForSessionRef.current = false;
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
    if (previousDraftTextRef.current === resolvedSerializedDraftText) {
      return;
    }
    previousDraftTextRef.current = resolvedSerializedDraftText;
    resizeComposerEditor();
  }, [resolvedSerializedDraftText, resizeComposerEditor]);

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
    composerEditorRef,
    resizeComposerEditor,
    composerTextareaRef:
      composerEditorRef as unknown as React.RefObject<HTMLTextAreaElement | null>,
    resizeComposerTextarea: resizeComposerEditor,
  };
};

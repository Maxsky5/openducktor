import type { RefObject } from "react";
import { useEffect, useRef } from "react";

type UseAgentChatResizeSyncInput = {
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  messagesContentRef: RefObject<HTMLDivElement | null>;
  syncBottomIfPinned: () => void;
};

export function useAgentChatResizeSync({
  messagesContainerRef,
  messagesContentRef,
  syncBottomIfPinned,
}: UseAgentChatResizeSyncInput): void {
  const contentResizeFrameRef = useRef<number | null>(null);
  const observedContentHeightRef = useRef<number | null>(null);
  const containerResizeFrameRef = useRef<number | null>(null);
  const observedContainerHeightRef = useRef<number | null>(null);

  useEffect(() => {
    const container = messagesContainerRef.current;
    const content = messagesContentRef.current;
    if (!container || !content) {
      observedContentHeightRef.current = null;
      return;
    }

    observedContentHeightRef.current = content.scrollHeight;
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const syncAfterResize = () => {
      contentResizeFrameRef.current = null;
      const nextContent = messagesContentRef.current;
      if (!nextContent) {
        return;
      }

      const previousHeight = observedContentHeightRef.current;
      const nextHeight = nextContent.scrollHeight;
      observedContentHeightRef.current = nextHeight;
      if (previousHeight === null || previousHeight === nextHeight) {
        return;
      }

      syncBottomIfPinned();
    };

    const scheduleResizeSync = () => {
      if (contentResizeFrameRef.current !== null) {
        return;
      }

      contentResizeFrameRef.current = globalThis.requestAnimationFrame(syncAfterResize);
    };

    const observer = new ResizeObserver(() => {
      scheduleResizeSync();
    });
    observer.observe(content);

    return () => {
      observer.disconnect();
      if (contentResizeFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(contentResizeFrameRef.current);
        contentResizeFrameRef.current = null;
      }
    };
  }, [messagesContainerRef, messagesContentRef, syncBottomIfPinned]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      observedContainerHeightRef.current = null;
      return;
    }

    observedContainerHeightRef.current = container.clientHeight;
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const syncAfterResize = () => {
      containerResizeFrameRef.current = null;
      const nextContainer = messagesContainerRef.current;
      if (!nextContainer) {
        return;
      }

      const previousHeight = observedContainerHeightRef.current;
      const nextHeight = nextContainer.clientHeight;
      observedContainerHeightRef.current = nextHeight;
      if (previousHeight === null || previousHeight === nextHeight) {
        return;
      }

      syncBottomIfPinned();
    };

    const scheduleResizeSync = () => {
      if (containerResizeFrameRef.current !== null) {
        return;
      }

      containerResizeFrameRef.current = globalThis.requestAnimationFrame(syncAfterResize);
    };

    const observer = new ResizeObserver(() => {
      scheduleResizeSync();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      if (containerResizeFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(containerResizeFrameRef.current);
        containerResizeFrameRef.current = null;
      }
    };
  }, [messagesContainerRef, syncBottomIfPinned]);
}

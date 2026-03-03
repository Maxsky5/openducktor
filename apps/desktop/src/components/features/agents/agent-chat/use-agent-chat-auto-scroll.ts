import type { RefObject } from "react";
import { useEffect, useRef } from "react";
import type { AgentChatVirtualizer } from "./use-agent-chat-virtualization";

type UseAgentChatAutoScrollInput = {
  activeSessionId: string | null;
  isPinnedToBottom: boolean;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  shouldVirtualize: boolean;
  virtualRowsCount: number;
  virtualizer: AgentChatVirtualizer;
};

export function useAgentChatAutoScroll({
  activeSessionId,
  isPinnedToBottom,
  messagesContainerRef,
  shouldVirtualize,
  virtualRowsCount,
  virtualizer,
}: UseAgentChatAutoScrollInput): void {
  const previousVirtualizedSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeSessionId || !shouldVirtualize || virtualRowsCount === 0) {
      previousVirtualizedSessionIdRef.current = activeSessionId;
      return;
    }

    const sessionChanged = previousVirtualizedSessionIdRef.current !== activeSessionId;
    previousVirtualizedSessionIdRef.current = activeSessionId;

    if (!sessionChanged && !isPinnedToBottom) {
      return;
    }

    const lastRowIndex = virtualRowsCount - 1;
    const scrollToBottom = (): void => {
      if (sessionChanged) {
        virtualizer.measure();
      }
      virtualizer.scrollToIndex(lastRowIndex, { align: "end" });

      const container = messagesContainerRef.current;
      if (!container) {
        return;
      }

      container.scrollTo({ top: container.scrollHeight, behavior: "auto" });
    };

    if (typeof window === "undefined") {
      scrollToBottom();
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      scrollToBottom();
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [
    activeSessionId,
    isPinnedToBottom,
    messagesContainerRef,
    shouldVirtualize,
    virtualRowsCount,
    virtualizer,
  ]);
}

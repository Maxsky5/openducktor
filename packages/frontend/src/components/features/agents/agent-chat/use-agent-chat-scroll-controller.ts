import type { RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from "react";
import { REVEAL_ELEMENT_EVENT } from "@/lib/reveal-element";
import { CHAT_SCROLL_EDGE_THRESHOLD_PX } from "./agent-chat-window-shared";

type UseAgentChatScrollControllerInput = {
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  messagesContentRef: RefObject<HTMLDivElement | null>;
  pinnedRef: RefObject<boolean>;
  // Only the latest row window contains the transcript end, so only it can stay pinned.
  canPin: boolean;
};

type UseAgentChatScrollControllerResult = {
  isNearBottom: boolean;
  isNearTop: boolean;
  pin: () => void;
  unpin: () => void;
  syncScrollPosition: () => void;
};

type EdgeState = { nearBottom: boolean; nearTop: boolean };

const SCROLL_UP_KEYS = new Set(["ArrowUp", "PageUp", "Home"]);

const isScrollUpKey = (event: KeyboardEvent): boolean =>
  SCROLL_UP_KEYS.has(event.key) || (event.key === " " && event.shiftKey);

const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.matches("input, textarea, select"));

const canScroll = (container: HTMLElement): boolean =>
  container.scrollHeight - container.clientHeight > 1;

const distanceFromBottom = (container: HTMLElement): number =>
  container.scrollHeight - container.clientHeight - container.scrollTop;

const isAtBottom = (container: HTMLElement): boolean =>
  !canScroll(container) || distanceFromBottom(container) < CHAT_SCROLL_EDGE_THRESHOLD_PX;

// An inner scroll container, such as a diff viewer, takes an upward scroll until it reaches its top.
const hasInnerScrollAbove = (target: EventTarget | null, container: HTMLElement): boolean => {
  for (
    let element = target instanceof Element ? target : null;
    element && element !== container;
    element = element.parentElement
  ) {
    if (element.scrollTop > 0) {
      return true;
    }
  }
  return false;
};

/**
 * Keeps a pinned transcript at its bottom edge.
 *
 * - Only user input unpins: an upward wheel, a scroll-up key, an upward pointer or touch drag,
 *   or keyboard focus that scrolls up to an element. A request to reveal an element also unpins.
 * - The user pins again by scrolling down to the bottom edge, or the caller pins explicitly.
 *   A transcript that stops overflowing pins again, because no scroll can reach its bottom edge.
 * - While pinned, every size change of the viewport or the content scrolls back to the bottom.
 *   Any other scroll that leaves the bottom, such as a browser scroll restoration, is reverted.
 */
export function useAgentChatScrollController({
  messagesContainerRef,
  messagesContentRef,
  pinnedRef,
  canPin,
}: UseAgentChatScrollControllerInput): UseAgentChatScrollControllerResult {
  const canPinRef = useRef(canPin);
  const isPointerPressedRef = useRef(false);
  const lastPointerDownTargetRef = useRef<EventTarget | null>(null);
  const lastScrollTopRef = useRef(0);
  const edgesRef = useRef<EdgeState>({ nearBottom: true, nearTop: true });
  const [edges, dispatchEdges] = useReducer(
    (_current: EdgeState, next: EdgeState) => next,
    edgesRef.current,
  );

  // The caller runs its scroll effects after this one, so they use the committed row window.
  useLayoutEffect(() => {
    canPinRef.current = canPin;
  }, [canPin]);

  const refreshEdges = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    const nearBottom = isAtBottom(container);
    const nearTop = container.scrollTop <= CHAT_SCROLL_EDGE_THRESHOLD_PX;
    if (edgesRef.current.nearBottom === nearBottom && edgesRef.current.nearTop === nearTop) {
      return;
    }

    edgesRef.current = { nearBottom, nearTop };
    dispatchEdges(edgesRef.current);
  }, [messagesContainerRef]);

  const setPinned = useCallback(
    (pinned: boolean) => {
      pinnedRef.current = pinned;
      const container = messagesContainerRef.current;
      if (container) {
        // Scroll anchoring keeps the reading position, which only an unpinned transcript needs.
        container.style.overflowAnchor = pinned ? "none" : "auto";
      }
    },
    [messagesContainerRef, pinnedRef],
  );

  const syncScrollPosition = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    if (canPinRef.current) {
      if (!pinnedRef.current && !canScroll(container)) {
        setPinned(true);
      }
      if (pinnedRef.current && distanceFromBottom(container) > 1) {
        container.scrollTop = container.scrollHeight;
      }
    }
    lastScrollTopRef.current = container.scrollTop;
    refreshEdges();
  }, [messagesContainerRef, pinnedRef, refreshEdges, setPinned]);

  const pin = useCallback(() => {
    setPinned(true);
    syncScrollPosition();
  }, [setPinned, syncScrollPosition]);

  const unpin = useCallback(() => {
    setPinned(false);
  }, [setPinned]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    const content = messagesContentRef.current;
    if (!container || !content) {
      return;
    }

    const ownerDocument = container.ownerDocument;

    // A clamp after the content gets smaller also moves the position up, but it stays at the bottom.
    const hasMovedUpFromBottom = () =>
      container.scrollTop < lastScrollTopRef.current && distanceFromBottom(container) > 1;

    const unpinForUserScroll = (scrollTarget: EventTarget | null) => {
      if (
        pinnedRef.current &&
        canScroll(container) &&
        !hasInnerScrollAbove(scrollTarget, container)
      ) {
        setPinned(false);
      }
    };

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0 && Math.abs(event.deltaY) >= Math.abs(event.deltaX)) {
        unpinForUserScroll(event.target);
      }
    };

    // The document gets the key after the app handlers, so a key that a component handled is skipped.
    // With no focused element, the browser scrolls the scroll container that the user clicked last.
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isScrollUpKey(event) || isEditableTarget(event.target)) {
        return;
      }
      if (event.target instanceof Node && container.contains(event.target)) {
        unpinForUserScroll(event.target);
      } else if (event.target === ownerDocument.body && lastPointerDownTargetRef.current !== null) {
        unpinForUserScroll(lastPointerDownTargetRef.current);
      }
    };

    // Keyboard focus scrolls the focused element into view before the focusin event,
    // and the scroll event for that move comes later.
    const handleFocusIn = () => {
      if (!isPointerPressedRef.current && hasMovedUpFromBottom()) {
        unpinForUserScroll(null);
      }
    };

    const handleRevealElement = () => {
      setPinned(false);
    };

    // Touch input uses touch events, because a touch pan cancels its pointer before it scrolls.
    const handlePointerDown = (event: PointerEvent) => {
      lastPointerDownTargetRef.current = event.target;
      if (event.pointerType !== "touch") {
        isPointerPressedRef.current = true;
      }
    };

    const handleDocumentPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !container.contains(event.target)) {
        lastPointerDownTargetRef.current = null;
      }
    };

    const handleDocumentPointerEnd = (event: PointerEvent) => {
      if (event.pointerType !== "touch") {
        isPointerPressedRef.current = false;
      }
    };

    const handleTouchStart = () => {
      isPointerPressedRef.current = true;
    };

    const handleDocumentTouchEnd = () => {
      isPointerPressedRef.current = false;
    };

    const handleScroll = () => {
      const hasDraggedUp = isPointerPressedRef.current && hasMovedUpFromBottom();
      const isMovingUp = container.scrollTop < lastScrollTopRef.current;
      lastScrollTopRef.current = container.scrollTop;

      if (pinnedRef.current) {
        if (hasDraggedUp) {
          setPinned(false);
          refreshEdges();
          return;
        }
        syncScrollPosition();
        return;
      }

      if (!isMovingUp && isAtBottom(container) && canPinRef.current) {
        pin();
        return;
      }
      refreshEdges();
    };

    setPinned(pinnedRef.current);
    syncScrollPosition();

    container.addEventListener("wheel", handleWheel, { passive: true });
    container.addEventListener("focusin", handleFocusIn);
    container.addEventListener(REVEAL_ELEMENT_EVENT, handleRevealElement);
    container.addEventListener("pointerdown", handlePointerDown, { passive: true });
    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("scroll", handleScroll, { passive: true });
    ownerDocument.addEventListener("keydown", handleDocumentKeyDown);
    ownerDocument.addEventListener("pointerdown", handleDocumentPointerDown, {
      capture: true,
      passive: true,
    });
    ownerDocument.addEventListener("pointerup", handleDocumentPointerEnd, { passive: true });
    ownerDocument.addEventListener("pointercancel", handleDocumentPointerEnd, { passive: true });
    ownerDocument.addEventListener("touchend", handleDocumentTouchEnd, { passive: true });
    ownerDocument.addEventListener("touchcancel", handleDocumentTouchEnd, { passive: true });

    // The viewport shrinks without a scroll event when a panel such as the terminal opens.
    const resizeObserver = new ResizeObserver(syncScrollPosition);
    resizeObserver.observe(container);
    resizeObserver.observe(content);

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("focusin", handleFocusIn);
      container.removeEventListener(REVEAL_ELEMENT_EVENT, handleRevealElement);
      container.removeEventListener("pointerdown", handlePointerDown);
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("scroll", handleScroll);
      ownerDocument.removeEventListener("keydown", handleDocumentKeyDown);
      ownerDocument.removeEventListener("pointerdown", handleDocumentPointerDown, {
        capture: true,
      });
      ownerDocument.removeEventListener("pointerup", handleDocumentPointerEnd);
      ownerDocument.removeEventListener("pointercancel", handleDocumentPointerEnd);
      ownerDocument.removeEventListener("touchend", handleDocumentTouchEnd);
      ownerDocument.removeEventListener("touchcancel", handleDocumentTouchEnd);
    };
  }, [
    messagesContainerRef,
    messagesContentRef,
    pin,
    pinnedRef,
    refreshEdges,
    setPinned,
    syncScrollPosition,
  ]);

  return {
    isNearBottom: edges.nearBottom,
    isNearTop: edges.nearTop,
    pin,
    unpin,
    syncScrollPosition,
  };
}

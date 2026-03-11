import type { RefCallback } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

export const AGENT_CHAT_ROW_MOTION_DURATION_MS = 1_000;
const AGENT_CHAT_ROW_MOTION_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const AGENT_CHAT_ROW_ENTRY_OFFSET_PX = 32;

type UseAgentChatRowMotionInput = {
  activeSessionId: string | null;
  rowKeys: string[];
};

type UseAgentChatRowMotionResult = {
  registerRowElement: (rowKey: string) => RefCallback<HTMLDivElement>;
};

export function useAgentChatRowMotion({
  activeSessionId,
  rowKeys,
}: UseAgentChatRowMotionInput): UseAgentChatRowMotionResult {
  const rowElementByKeyRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const refCallbackByKeyRef = useRef<Map<string, RefCallback<HTMLDivElement>>>(new Map());
  const seenRowKeysBySessionRef = useRef<Record<string, Set<string>>>({});
  const animationByRowKeyRef = useRef<Map<string, Animation>>(new Map());

  useEffect(() => {
    return () => {
      for (const animation of animationByRowKeyRef.current.values()) {
        animation.cancel();
      }
      animationByRowKeyRef.current.clear();
      rowElementByKeyRef.current.clear();
      refCallbackByKeyRef.current.clear();
    };
  }, []);

  const finishAnimation = useCallback((rowKey: string, element: HTMLDivElement): void => {
    element.style.willChange = "";
    const activeAnimation = animationByRowKeyRef.current.get(rowKey);
    if (activeAnimation) {
      animationByRowKeyRef.current.delete(rowKey);
    }
  }, []);

  const playAnimation = useCallback(
    (rowKey: string, element: HTMLDivElement, keyframes: Keyframe[]): void => {
      if (typeof element.animate !== "function") {
        return;
      }

      const existingAnimation = animationByRowKeyRef.current.get(rowKey);
      if (existingAnimation) {
        existingAnimation.cancel();
      }

      element.style.willChange = "transform, opacity";
      const animation = element.animate(keyframes, {
        duration: AGENT_CHAT_ROW_MOTION_DURATION_MS,
        easing: AGENT_CHAT_ROW_MOTION_EASING,
        fill: "both",
      });
      animationByRowKeyRef.current.set(rowKey, animation);
      animation.addEventListener("finish", () => finishAnimation(rowKey, element), {
        once: true,
      });
      animation.addEventListener("cancel", () => finishAnimation(rowKey, element), {
        once: true,
      });
    },
    [finishAnimation],
  );

  const registerRowElement = useCallback((rowKey: string): RefCallback<HTMLDivElement> => {
    const cached = refCallbackByKeyRef.current.get(rowKey);
    if (cached) {
      return cached;
    }

    const callback: RefCallback<HTMLDivElement> = (element) => {
      if (!element) {
        rowElementByKeyRef.current.delete(rowKey);
        return;
      }

      rowElementByKeyRef.current.set(rowKey, element);
    };

    refCallbackByKeyRef.current.set(rowKey, callback);
    return callback;
  }, []);

  useLayoutEffect(() => {
    if (!activeSessionId || typeof window === "undefined") {
      return;
    }

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const seenRowKeys = seenRowKeysBySessionRef.current[activeSessionId];
    if (!seenRowKeys) {
      seenRowKeysBySessionRef.current[activeSessionId] = new Set(rowKeys);
      return;
    }

    const activeRowKeySet = new Set(rowKeys);
    for (const rowKey of animationByRowKeyRef.current.keys()) {
      if (!activeRowKeySet.has(rowKey)) {
        const animation = animationByRowKeyRef.current.get(rowKey);
        if (animation) {
          animation.cancel();
        }
      }
    }

    for (const rowKey of rowKeys) {
      if (seenRowKeys.has(rowKey)) {
        continue;
      }

      const element = rowElementByKeyRef.current.get(rowKey);
      if (!element) {
        continue;
      }

      seenRowKeys.add(rowKey);
      if (reduceMotion) {
        continue;
      }

      playAnimation(rowKey, element, [
        {
          opacity: 0,
          transform: `translate3d(0, ${AGENT_CHAT_ROW_ENTRY_OFFSET_PX}px, 0)`,
        },
        { opacity: 1, transform: "translate3d(0, 0, 0)" },
      ]);
    }
  }, [activeSessionId, playAnimation, rowKeys]);

  return {
    registerRowElement,
  };
}

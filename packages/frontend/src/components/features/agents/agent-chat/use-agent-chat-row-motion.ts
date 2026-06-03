import type { RefCallback } from "react";
import { useCallback, useRef } from "react";

type UseAgentChatRowMotionInput = {
  activeExternalSessionId: string | null;
  rowKeys: string[];
  windowStart: number;
};

type UseAgentChatRowMotionResult = {
  registerRowElement: (rowKey: string) => RefCallback<HTMLDivElement>;
};

export function useAgentChatRowMotion({
  activeExternalSessionId: _activeExternalSessionId,
  rowKeys: _rowKeys,
  windowStart: _windowStart,
}: UseAgentChatRowMotionInput): UseAgentChatRowMotionResult {
  const refCallbackByKeyRef = useRef<Map<string, RefCallback<HTMLDivElement>> | null>(null);
  if (refCallbackByKeyRef.current === null) {
    refCallbackByKeyRef.current = new Map<string, RefCallback<HTMLDivElement>>();
  }
  const refCallbackByKey = refCallbackByKeyRef.current;

  const registerRowElement = useCallback(
    (rowKey: string): RefCallback<HTMLDivElement> => {
      const cached = refCallbackByKey.get(rowKey);
      if (cached) {
        return cached;
      }

      const callback: RefCallback<HTMLDivElement> = (element) => {
        if (!element) {
          return;
        }
      };

      refCallbackByKey.set(rowKey, callback);
      return callback;
    },
    [refCallbackByKey],
  );

  return {
    registerRowElement,
  };
}

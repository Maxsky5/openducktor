import type { RefCallback } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentChatWindowRow } from "./agent-chat-thread-windowing";

const DEFAULT_MESSAGE_HEIGHT_PX = 96;
const DEFAULT_TURN_DURATION_HEIGHT_PX = 28;

type UseAgentChatWindowVirtualizerInput = {
  rows: AgentChatWindowRow[];
  windowStart: number;
  windowEnd: number;
};

type UseAgentChatWindowVirtualizerResult = {
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  renderedContentHeight: number;
  registerMeasuredRowElement: (rowKey: string) => RefCallback<HTMLDivElement>;
};

export function useAgentChatWindowVirtualizer({
  rows,
  windowStart,
  windowEnd,
}: UseAgentChatWindowVirtualizerInput): UseAgentChatWindowVirtualizerResult {
  const [measurementVersion, setMeasurementVersion] = useState(0);
  const heightByRowKeyRef = useRef<Map<string, number>>(new Map());
  const elementByRowKeyRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const rowKeyByElementRef = useRef<WeakMap<HTMLDivElement, string>>(new WeakMap());
  const refCallbackByKeyRef = useRef<Map<string, RefCallback<HTMLDivElement>>>(new Map());
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const updateMeasuredHeight = useCallback((rowKey: string, element: HTMLDivElement): void => {
    if (typeof element.getBoundingClientRect !== "function") {
      return;
    }

    const nextHeight = Math.round(element.getBoundingClientRect().height);
    if (nextHeight <= 0) {
      return;
    }

    const previousHeight = heightByRowKeyRef.current.get(rowKey);
    if (previousHeight === nextHeight) {
      return;
    }

    heightByRowKeyRef.current.set(rowKey, nextHeight);
    setMeasurementVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const element = entry.target as HTMLDivElement;
        const rowKey = rowKeyByElementRef.current.get(element);
        if (!rowKey) {
          continue;
        }

        updateMeasuredHeight(rowKey, element);
      }
    });
    resizeObserverRef.current = observer;

    for (const [rowKey, element] of elementByRowKeyRef.current) {
      rowKeyByElementRef.current.set(element, rowKey);
      observer.observe(element);
      updateMeasuredHeight(rowKey, element);
    }

    return () => {
      observer.disconnect();
      resizeObserverRef.current = null;
    };
  }, [updateMeasuredHeight]);

  const registerMeasuredRowElement = useCallback(
    (rowKey: string): RefCallback<HTMLDivElement> => {
      const cached = refCallbackByKeyRef.current.get(rowKey);
      if (cached) {
        return cached;
      }

      const callback: RefCallback<HTMLDivElement> = (element) => {
        const previousElement = elementByRowKeyRef.current.get(rowKey);
        if (previousElement && previousElement !== element) {
          resizeObserverRef.current?.unobserve(previousElement);
          rowKeyByElementRef.current.delete(previousElement);
          elementByRowKeyRef.current.delete(rowKey);
        }

        if (!element) {
          return;
        }

        elementByRowKeyRef.current.set(rowKey, element);
        rowKeyByElementRef.current.set(element, rowKey);
        updateMeasuredHeight(rowKey, element);
        resizeObserverRef.current?.observe(element);
      };

      refCallbackByKeyRef.current.set(rowKey, callback);
      return callback;
    },
    [updateMeasuredHeight],
  );

  const estimatedHeights = useMemo(() => {
    void measurementVersion;
    let measuredMessageHeightTotal = 0;
    let measuredMessageCount = 0;
    let measuredTurnDurationHeightTotal = 0;
    let measuredTurnDurationCount = 0;

    for (const row of rows) {
      const measuredHeight = heightByRowKeyRef.current.get(row.key);
      if (typeof measuredHeight !== "number") {
        continue;
      }

      if (row.kind === "message") {
        measuredMessageHeightTotal += measuredHeight;
        measuredMessageCount += 1;
        continue;
      }

      measuredTurnDurationHeightTotal += measuredHeight;
      measuredTurnDurationCount += 1;
    }

    return {
      message:
        measuredMessageCount > 0
          ? measuredMessageHeightTotal / measuredMessageCount
          : DEFAULT_MESSAGE_HEIGHT_PX,
      turn_duration:
        measuredTurnDurationCount > 0
          ? measuredTurnDurationHeightTotal / measuredTurnDurationCount
          : DEFAULT_TURN_DURATION_HEIGHT_PX,
    };
  }, [measurementVersion, rows]);

  const resolveRowHeight = useCallback(
    (row: AgentChatWindowRow): number => {
      const measuredHeight = heightByRowKeyRef.current.get(row.key);
      if (typeof measuredHeight === "number") {
        return measuredHeight;
      }

      return row.kind === "message" ? estimatedHeights.message : estimatedHeights.turn_duration;
    },
    [estimatedHeights.message, estimatedHeights.turn_duration],
  );

  const { topSpacerHeight, bottomSpacerHeight, renderedContentHeight } = useMemo(() => {
    let nextTopSpacerHeight = 0;
    let nextBottomSpacerHeight = 0;
    let nextRenderedContentHeight = 0;

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      if (!row) {
        continue;
      }

      const rowHeight = resolveRowHeight(row);
      if (rowIndex < windowStart) {
        nextTopSpacerHeight += rowHeight;
        continue;
      }

      if (rowIndex > windowEnd) {
        nextBottomSpacerHeight += rowHeight;
        continue;
      }

      nextRenderedContentHeight += rowHeight;
    }

    return {
      topSpacerHeight: nextTopSpacerHeight,
      bottomSpacerHeight: nextBottomSpacerHeight,
      renderedContentHeight: nextRenderedContentHeight,
    };
  }, [resolveRowHeight, rows, windowEnd, windowStart]);

  return {
    topSpacerHeight,
    bottomSpacerHeight,
    renderedContentHeight,
    registerMeasuredRowElement,
  };
}

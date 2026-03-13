import { useVirtualizer, type VirtualItem, type Virtualizer } from "@tanstack/react-virtual";
import type { RefCallback, RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";
import { hasMarkdownSyntaxHint } from "./agent-chat-markdown-hints";
import {
  AGENT_CHAT_VIRTUAL_OVERSCAN_ITEMS,
  AGENT_CHAT_VIRTUALIZATION_MIN_ROW_COUNT,
  type AgentChatVirtualRow,
  buildAgentChatVirtualRows,
  buildAgentChatVirtualRowsSignature,
  resolveAgentChatVirtualRowSize,
} from "./agent-chat-thread-virtualization";

type UseAgentChatVirtualizationInput = {
  session: AgentSessionState | null;
  showThinkingMessages: boolean;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
};

export type AgentChatVirtualizer = Virtualizer<HTMLDivElement, Element>;

type AgentChatVirtualRowsToRenderEntry = {
  row: AgentChatVirtualRow;
  virtualItem: VirtualItem;
};

type RetainedVirtualWindowState = {
  rowModelSignature: string | null;
  virtualItems: VirtualItem[];
};

type UseAgentChatVirtualizationResult = {
  activeSessionId: string | null;
  canRenderVirtualRows: boolean;
  hasRenderableSessionRows: boolean;
  hasSessionHistory: boolean;
  isPreparingVirtualization: boolean;
  registerStaticMeasurementRowElement: (rowKey: string) => RefCallback<HTMLDivElement>;
  shouldVirtualize: boolean;
  virtualRows: AgentChatVirtualRow[];
  virtualRowsToRender: AgentChatVirtualRowsToRenderEntry[];
  virtualizer: AgentChatVirtualizer;
};

type UseAgentChatVirtualRowsResult = {
  activeSessionId: string | null;
  shouldVirtualize: boolean;
  virtualRows: AgentChatVirtualRow[];
  virtualRowsSignature: string | null;
};

type UseAgentChatVirtualRowsInput = {
  session: AgentSessionState | null;
  showThinkingMessages: boolean;
};

type UseVirtualRowMeasurementsInput = {
  virtualRows: AgentChatVirtualRow[];
};

type UseVirtualRowMeasurementsResult = {
  estimateRowSize: (index: number) => number;
  measureStaticRowElement: (rowKey: string, element: Element) => void;
  measureVirtualRowElement: (element: Element) => number;
  resetMeasuredRowMeasurements: () => void;
  resolveRowKey: (index: number) => string | number;
};

type MeasurementBucketStats = {
  count: number;
  maxSize: number;
  movingAverageSize: number;
};

type VirtualRowMetadata = {
  index: number;
  row: AgentChatVirtualRow;
};

type VirtualizationPreparationPhase = "idle" | "static" | "revealing" | "ready";

const CHAT_VIRTUALIZATION_STABLE_TOTAL_SIZE_DELTA_PX = 1;
const CHAT_VIRTUALIZATION_STABLE_TOTAL_SIZE_FRAMES = 2;
const CHAT_VIRTUALIZATION_MAX_REVEAL_FRAMES = 24;

export function useAgentChatVirtualization({
  session,
  showThinkingMessages,
  messagesContainerRef,
}: UseAgentChatVirtualizationInput): UseAgentChatVirtualizationResult {
  const { activeSessionId, shouldVirtualize, virtualRows, virtualRowsSignature } =
    useAgentChatVirtualRows({ session, showThinkingMessages });
  const {
    estimateRowSize,
    measureStaticRowElement,
    measureVirtualRowElement,
    resetMeasuredRowMeasurements,
    resolveRowKey,
  } = useVirtualRowMeasurements({
    virtualRows,
  });
  const [staticMeasurementRowCount, setStaticMeasurementRowCount] = useState(0);
  const [virtualizationPreparationPhase, setVirtualizationPreparationPhase] =
    useState<VirtualizationPreparationPhase>("idle");
  const measurementSignature = useMemo(() => {
    if (!shouldVirtualize) {
      return "";
    }
    return [
      activeSessionId ?? "none",
      showThinkingMessages ? "thinking:on" : "thinking:off",
      ...virtualRows.map((row) => row.key),
    ].join("\u001f");
  }, [activeSessionId, shouldVirtualize, showThinkingMessages, virtualRows]);
  const staticRowElementByKeyRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const staticMeasurementRefByKeyRef = useRef<Map<string, RefCallback<HTMLDivElement>>>(new Map());
  const prepareMeasurementsRafRef = useRef<number | null>(null);
  const revealVirtualizationRafRef = useRef<number | null>(null);
  const revealStableFrameCountRef = useRef(0);
  const revealLastTotalSizeRef = useRef<number | null>(null);
  const resolveScrollElement = useCallback((): HTMLDivElement | null => {
    return messagesContainerRef.current;
  }, [messagesContainerRef]);

  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? virtualRows.length : 0,
    getScrollElement: resolveScrollElement,
    estimateSize: estimateRowSize,
    measureElement: measureVirtualRowElement,
    getItemKey: resolveRowKey,
    overscan: AGENT_CHAT_VIRTUAL_OVERSCAN_ITEMS,
  });

  const virtualRowsToRender = useVirtualRowsToRender({
    activeSessionId,
    shouldVirtualize,
    virtualRows,
    virtualRowsSignature,
    virtualItems: virtualizer.getVirtualItems(),
  });
  const canRenderVirtualRows = shouldVirtualize && virtualizationPreparationPhase === "ready";
  const hasRenderableSessionRows = virtualRows.length > 0;
  const hasSessionHistory = session !== null && session.messages.length > 0;
  const isPreparingVirtualization =
    shouldVirtualize && !canRenderVirtualRows && typeof window !== "undefined";

  useEffect(() => {
    staticMeasurementRefByKeyRef.current.clear();
    staticRowElementByKeyRef.current.clear();
    resetMeasuredRowMeasurements();
    setStaticMeasurementRowCount(0);
    if (prepareMeasurementsRafRef.current !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(prepareMeasurementsRafRef.current);
      prepareMeasurementsRafRef.current = null;
    }
    if (revealVirtualizationRafRef.current !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(revealVirtualizationRafRef.current);
      revealVirtualizationRafRef.current = null;
    }
    revealStableFrameCountRef.current = 0;
    revealLastTotalSizeRef.current = null;

    if (!shouldVirtualize || measurementSignature.length === 0) {
      setVirtualizationPreparationPhase("idle");
      return;
    }

    setVirtualizationPreparationPhase("static");
  }, [measurementSignature, resetMeasuredRowMeasurements, shouldVirtualize]);

  useEffect(() => {
    if (
      !shouldVirtualize ||
      virtualizationPreparationPhase !== "revealing" ||
      typeof window === "undefined"
    ) {
      return;
    }

    const finishRevealWhenStable = (remainingFrames: number): void => {
      virtualizer.measure();
      const totalSize = virtualizer.getTotalSize();
      const previousTotalSize = revealLastTotalSizeRef.current;
      const isStable =
        previousTotalSize !== null &&
        Math.abs(previousTotalSize - totalSize) <= CHAT_VIRTUALIZATION_STABLE_TOTAL_SIZE_DELTA_PX;
      revealLastTotalSizeRef.current = totalSize;
      revealStableFrameCountRef.current = isStable ? revealStableFrameCountRef.current + 1 : 0;

      if (
        revealStableFrameCountRef.current >= CHAT_VIRTUALIZATION_STABLE_TOTAL_SIZE_FRAMES ||
        remainingFrames <= 0
      ) {
        revealVirtualizationRafRef.current = null;
        revealStableFrameCountRef.current = 0;
        revealLastTotalSizeRef.current = null;
        setVirtualizationPreparationPhase("ready");
        return;
      }

      revealVirtualizationRafRef.current = window.requestAnimationFrame(() => {
        finishRevealWhenStable(remainingFrames - 1);
      });
    };

    revealVirtualizationRafRef.current = window.requestAnimationFrame(() => {
      finishRevealWhenStable(CHAT_VIRTUALIZATION_MAX_REVEAL_FRAMES);
    });

    return () => {
      if (revealVirtualizationRafRef.current !== null) {
        window.cancelAnimationFrame(revealVirtualizationRafRef.current);
        revealVirtualizationRafRef.current = null;
      }
      revealStableFrameCountRef.current = 0;
      revealLastTotalSizeRef.current = null;
    };
  }, [shouldVirtualize, virtualizationPreparationPhase, virtualizer]);

  useEffect(() => {
    if (
      !shouldVirtualize ||
      virtualizationPreparationPhase !== "static" ||
      virtualRows.length === 0 ||
      typeof window === "undefined"
    ) {
      return;
    }

    const staticRowElements = staticRowElementByKeyRef.current;
    if (
      staticMeasurementRowCount < virtualRows.length ||
      staticRowElements.size < virtualRows.length
    ) {
      return;
    }

    const firstRafId = window.requestAnimationFrame(() => {
      prepareMeasurementsRafRef.current = window.requestAnimationFrame(() => {
        prepareMeasurementsRafRef.current = null;
        for (const row of virtualRows) {
          const element = staticRowElements.get(row.key);
          if (!element) {
            return;
          }
          measureStaticRowElement(row.key, element);
        }
        virtualizer.measure();
        setVirtualizationPreparationPhase("revealing");
      });
    });
    prepareMeasurementsRafRef.current = firstRafId;

    return () => {
      if (prepareMeasurementsRafRef.current !== null) {
        window.cancelAnimationFrame(prepareMeasurementsRafRef.current);
        prepareMeasurementsRafRef.current = null;
      }
    };
  }, [
    measureStaticRowElement,
    shouldVirtualize,
    staticMeasurementRowCount,
    virtualizationPreparationPhase,
    virtualRows,
    virtualizer,
  ]);

  const registerStaticMeasurementRowElement = useCallback(
    (rowKey: string): RefCallback<HTMLDivElement> => {
      const cached = staticMeasurementRefByKeyRef.current.get(rowKey);
      if (cached) {
        return cached;
      }

      const callback: RefCallback<HTMLDivElement> = (element) => {
        if (!shouldVirtualize) {
          if (staticRowElementByKeyRef.current.delete(rowKey)) {
            setStaticMeasurementRowCount(staticRowElementByKeyRef.current.size);
          }
          return;
        }

        if (!element) {
          if (staticRowElementByKeyRef.current.delete(rowKey)) {
            setStaticMeasurementRowCount(staticRowElementByKeyRef.current.size);
          }
          return;
        }

        const previousElement = staticRowElementByKeyRef.current.get(rowKey);
        if (previousElement === element) {
          return;
        }

        staticRowElementByKeyRef.current.set(rowKey, element);
        setStaticMeasurementRowCount(staticRowElementByKeyRef.current.size);
      };

      staticMeasurementRefByKeyRef.current.set(rowKey, callback);
      return callback;
    },
    [shouldVirtualize],
  );

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container || !shouldVirtualize || typeof ResizeObserver === "undefined") {
      return;
    }

    let previousWidth = container.getBoundingClientRect().width;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const nextWidth = entry?.contentRect.width ?? container.getBoundingClientRect().width;
      if (!Number.isFinite(nextWidth) || Math.abs(nextWidth - previousWidth) <= 0.5) {
        return;
      }

      previousWidth = nextWidth;
      resetMeasuredRowMeasurements();
      staticMeasurementRefByKeyRef.current.clear();
      staticRowElementByKeyRef.current.clear();
      setStaticMeasurementRowCount(0);
      setVirtualizationPreparationPhase("static");
      virtualizer.measure();
    });

    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, [messagesContainerRef, resetMeasuredRowMeasurements, shouldVirtualize, virtualizer]);

  return {
    activeSessionId,
    canRenderVirtualRows,
    hasRenderableSessionRows,
    hasSessionHistory,
    isPreparingVirtualization,
    registerStaticMeasurementRowElement,
    shouldVirtualize,
    virtualRows,
    virtualRowsToRender,
    virtualizer,
  };
}

function useAgentChatVirtualRows({
  session,
  showThinkingMessages,
}: UseAgentChatVirtualRowsInput): UseAgentChatVirtualRowsResult {
  const messageIdentityTokenByMessageRef = useRef<WeakMap<AgentChatMessage, number>>(new WeakMap());
  const nextMessageIdentityTokenRef = useRef(1);
  const virtualRowsCacheRef = useRef<{ signature: string | null; rows: AgentChatVirtualRow[] }>({
    signature: null,
    rows: [],
  });
  const resolveMessageIdentityToken = useCallback((message: AgentChatMessage): number => {
    const cached = messageIdentityTokenByMessageRef.current.get(message);
    if (typeof cached === "number") {
      return cached;
    }

    const nextToken = nextMessageIdentityTokenRef.current;
    nextMessageIdentityTokenRef.current += 1;
    messageIdentityTokenByMessageRef.current.set(message, nextToken);
    return nextToken;
  }, []);
  const virtualRowsSignature = session
    ? buildAgentChatVirtualRowsSignature(session, showThinkingMessages, resolveMessageIdentityToken)
    : null;
  const virtualRows = useMemo(() => {
    const cached = virtualRowsCacheRef.current;
    if (cached.signature === virtualRowsSignature) {
      return cached.rows;
    }

    const nextRows = session ? buildAgentChatVirtualRows(session, { showThinkingMessages }) : [];
    virtualRowsCacheRef.current = {
      signature: virtualRowsSignature,
      rows: nextRows,
    };
    return nextRows;
  }, [session, showThinkingMessages, virtualRowsSignature]);
  const shouldVirtualize =
    virtualRows.length >= AGENT_CHAT_VIRTUALIZATION_MIN_ROW_COUNT &&
    session !== null &&
    isStableTranscriptSessionStatus(session.status);
  const activeSessionId = session?.sessionId ?? null;

  return {
    activeSessionId,
    shouldVirtualize,
    virtualRows,
    virtualRowsSignature,
  };
}

const isStableTranscriptSessionStatus = (status: AgentSessionState["status"]): boolean => {
  return status === "idle" || status === "error" || status === "stopped";
};

function useVirtualRowMeasurements({
  virtualRows,
}: UseVirtualRowMeasurementsInput): UseVirtualRowMeasurementsResult {
  const virtualRowsRef = useRef(virtualRows);
  virtualRowsRef.current = virtualRows;
  const rowMetadataByKeyRef = useRef<Map<string, VirtualRowMetadata>>(new Map());
  const previousVirtualRowsRef = useRef<AgentChatVirtualRow[] | null>(null);
  if (previousVirtualRowsRef.current !== virtualRows) {
    rowMetadataByKeyRef.current = new Map(
      virtualRows.map((row, index) => [row.key, { index, row }] as const),
    );
    previousVirtualRowsRef.current = virtualRows;
  }
  const measuredRowSizeByKeyRef = useRef<Record<string, number>>({});
  const measuredBucketStatsByKeyRef = useRef<Record<string, MeasurementBucketStats>>({});
  const resolveMeasuredRowSize = useCallback((rowKey: string, rowHeight: number): number => {
    const rowMetadata = rowMetadataByKeyRef.current.get(rowKey);
    if (!rowMetadata) {
      return Math.max(0, rowHeight);
    }
    return resolveAgentChatVirtualRowSize({
      index: rowMetadata.index,
      rowCount: virtualRowsRef.current.length,
      rowHeight,
    });
  }, []);

  const updateMeasuredRowSize = useCallback((rowKey: string, measuredSize: number): void => {
    if (!(measuredSize > 0)) {
      return;
    }

    const previousSize = measuredRowSizeByKeyRef.current[rowKey];
    if (typeof previousSize !== "number") {
      measuredRowSizeByKeyRef.current[rowKey] = measuredSize;
    } else if (Math.abs(previousSize - measuredSize) > 0.5) {
      measuredRowSizeByKeyRef.current[rowKey] = measuredSize;
    }

    const row = rowMetadataByKeyRef.current.get(rowKey)?.row;
    const measurementBucketKey = row ? resolveMeasurementBucketKey(row) : null;
    if (!measurementBucketKey) {
      return;
    }

    const previousStats = measuredBucketStatsByKeyRef.current[measurementBucketKey];
    if (!previousStats) {
      measuredBucketStatsByKeyRef.current[measurementBucketKey] = {
        count: 1,
        maxSize: measuredSize,
        movingAverageSize: measuredSize,
      };
      return;
    }

    const nextCount = previousStats.count + 1;
    const nextMovingAverageSize =
      previousStats.movingAverageSize +
      (measuredSize - previousStats.movingAverageSize) / nextCount;
    measuredBucketStatsByKeyRef.current[measurementBucketKey] = {
      count: nextCount,
      maxSize: Math.max(previousStats.maxSize, measuredSize),
      movingAverageSize: nextMovingAverageSize,
    };
  }, []);

  const estimateRowSize = useCallback((index: number): number => {
    const rows = virtualRowsRef.current;
    const row = rows[index];
    if (!row) {
      return 0;
    }
    const measuredSize = measuredRowSizeByKeyRef.current[row.key];
    if (typeof measuredSize === "number" && measuredSize > 0) {
      return measuredSize;
    }

    const staticEstimate = resolveAgentChatVirtualRowSize({
      index,
      rowCount: rows.length,
      rowHeight: estimateVirtualRowHeight(row),
    });
    const measurementBucketKey = resolveMeasurementBucketKey(row);
    const bucketStats =
      measurementBucketKey !== null
        ? measuredBucketStatsByKeyRef.current[measurementBucketKey]
        : null;
    const learnedEstimate =
      bucketStats && bucketStats.count > 0
        ? Math.max(bucketStats.movingAverageSize, bucketStats.maxSize * 0.82)
        : 0;

    return Math.max(staticEstimate, learnedEstimate);
  }, []);

  const measureStaticRowElement = useCallback(
    (rowKey: string, element: Element): void => {
      updateMeasuredRowSize(
        rowKey,
        resolveMeasuredRowSize(rowKey, element.getBoundingClientRect().height),
      );
    },
    [resolveMeasuredRowSize, updateMeasuredRowSize],
  );

  const measureVirtualRowElement = useCallback(
    (element: Element): number => {
      const measuredHeight = element.getBoundingClientRect().height;
      let rowKey = element.getAttribute("data-row-key");

      if (!rowKey) {
        const indexValue = Number.parseInt(element.getAttribute("data-index") ?? "", 10);
        const row =
          Number.isFinite(indexValue) && indexValue >= 0
            ? virtualRowsRef.current[indexValue]
            : undefined;
        rowKey = row?.key ?? null;
      }

      const measuredSize =
        rowKey && measuredHeight > 0
          ? resolveMeasuredRowSize(rowKey, measuredHeight)
          : Math.max(0, measuredHeight);

      if (rowKey && measuredSize > 0) {
        updateMeasuredRowSize(rowKey, measuredSize);
      }
      return measuredSize;
    },
    [resolveMeasuredRowSize, updateMeasuredRowSize],
  );

  const resolveRowKey = useCallback((index: number): string | number => {
    return virtualRowsRef.current[index]?.key ?? index;
  }, []);

  const resetMeasuredRowMeasurements = useCallback((): void => {
    measuredRowSizeByKeyRef.current = {};
    measuredBucketStatsByKeyRef.current = {};
  }, []);

  return {
    estimateRowSize,
    measureStaticRowElement,
    measureVirtualRowElement,
    resetMeasuredRowMeasurements,
    resolveRowKey,
  };
}

const estimateVirtualRowHeight = (row: AgentChatVirtualRow): number => {
  switch (row.kind) {
    case "turn_duration":
      return 28;
    case "message":
      return estimateMessageRowHeight(row.message);
  }
};

export const estimateMessageRowHeight = (message: AgentChatMessage): number => {
  const assistantMeta = message.meta?.kind === "assistant" ? message.meta : null;
  switch (message.role) {
    case "user":
      return estimateTextBlockHeight(message.content, {
        lineHeightPx: 28,
        minHeightPx: 64,
        charsPerLine: 78,
        baseChromePx: 28,
        markdownBonusPx: 24,
      });
    case "assistant":
      return estimateTextBlockHeight(message.content, {
        lineHeightPx: 28,
        minHeightPx: assistantMeta?.isFinal === true ? 84 : 72,
        charsPerLine: 76,
        baseChromePx: assistantMeta?.isFinal === true ? 36 : 20,
        markdownBonusPx: assistantMeta?.isFinal === true ? 36 : 28,
      });
    case "thinking":
      return estimateTextBlockHeight(message.content, {
        lineHeightPx: 24,
        minHeightPx: 56,
        charsPerLine: 74,
        baseChromePx: 24,
        markdownBonusPx: 28,
      });
    case "tool":
    case "system":
      return estimateTextBlockHeight(message.content, {
        lineHeightPx: 24,
        minHeightPx: 44,
        charsPerLine: 82,
        baseChromePx: 20,
        markdownBonusPx: 24,
      });
  }
};

const estimateTextBlockHeight = (
  text: string,
  options: {
    baseChromePx: number;
    lineHeightPx: number;
    markdownBonusPx: number;
    minHeightPx: number;
    charsPerLine: number;
  },
): number => {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return options.minHeightPx;
  }

  const containsMarkdown = hasMarkdownSyntaxHint(normalized);
  const blankLineCount = Math.max(0, normalized.split(/\n\s*\n/).length - 1);
  const structuredLineCount = normalized
    .split("\n")
    .filter((line) => /^\s*(?:#{1,6}\s+|>\s+|[-*+]\s+|\d+\.\s+|\|)/.test(line)).length;
  const codeFenceCount = normalized.match(/```|~~~/g)?.length ?? 0;
  const charsPerLine = containsMarkdown
    ? Math.max(44, options.charsPerLine - 8)
    : options.charsPerLine;
  const lineCount = normalized.split("\n").reduce((total, line) => {
    const wrappedLineCount = Math.max(1, Math.ceil(line.length / charsPerLine));
    return total + wrappedLineCount;
  }, 0);

  const structuralBonusPx = containsMarkdown
    ? options.markdownBonusPx +
      blankLineCount * 10 +
      Math.min(8, structuredLineCount) * 8 +
      Math.min(4, codeFenceCount) * 18
    : 0;

  return Math.max(
    options.minHeightPx,
    options.baseChromePx + lineCount * options.lineHeightPx + structuralBonusPx,
  );
};

const resolveMeasurementBucketKey = (row: AgentChatVirtualRow): string | null => {
  if (row.kind === "turn_duration") {
    return "turn_duration";
  }

  const { message } = row;
  if (message.role === "assistant") {
    const assistantMeta = message.meta?.kind === "assistant" ? message.meta : null;
    return assistantMeta?.isFinal === true
      ? hasMarkdownSyntaxHint(message.content)
        ? "assistant:final:markdown"
        : "assistant:final:text"
      : hasMarkdownSyntaxHint(message.content)
        ? "assistant:streaming:markdown"
        : "assistant:streaming:text";
  }

  if (message.role === "user") {
    return "user";
  }

  if (message.role === "thinking") {
    return "thinking";
  }

  if (message.role === "tool") {
    return "tool";
  }

  if (message.role === "system") {
    return "system";
  }

  return null;
};

function useVirtualRowsToRender({
  activeSessionId,
  shouldVirtualize,
  virtualRows,
  virtualRowsSignature,
  virtualItems,
}: {
  activeSessionId: string | null;
  shouldVirtualize: boolean;
  virtualRows: AgentChatVirtualRow[];
  virtualRowsSignature: string | null;
  virtualItems: VirtualItem[];
}): AgentChatVirtualRowsToRenderEntry[] {
  const lastNonEmptyWindowRef = useRef<RetainedVirtualWindowState>({
    rowModelSignature: null,
    virtualItems: [],
  });

  return useMemo(() => {
    const { nextWindowState, resolvedVirtualItems } = resolveRetainedVirtualWindow({
      activeSessionId,
      previousWindowState: lastNonEmptyWindowRef.current,
      rowCount: virtualRows.length,
      rowModelSignature: virtualRowsSignature,
      shouldVirtualize,
      virtualItems,
    });
    lastNonEmptyWindowRef.current = nextWindowState;

    return resolvedVirtualItems
      .map((virtualItem) => {
        const row = virtualRows[virtualItem.index];
        if (!row) {
          return null;
        }
        return { row, virtualItem };
      })
      .filter((entry): entry is AgentChatVirtualRowsToRenderEntry => entry !== null);
  }, [activeSessionId, shouldVirtualize, virtualItems, virtualRows, virtualRowsSignature]);
}

export function resolveRetainedVirtualWindow({
  activeSessionId,
  previousWindowState,
  rowCount,
  rowModelSignature,
  shouldVirtualize,
  virtualItems,
}: {
  activeSessionId: string | null;
  previousWindowState: RetainedVirtualWindowState;
  rowCount: number;
  rowModelSignature: string | null;
  shouldVirtualize: boolean;
  virtualItems: VirtualItem[];
}): {
  nextWindowState: RetainedVirtualWindowState;
  resolvedVirtualItems: VirtualItem[];
} {
  if (!shouldVirtualize || !activeSessionId) {
    return {
      nextWindowState: {
        rowModelSignature: null,
        virtualItems: [],
      },
      resolvedVirtualItems: [],
    };
  }

  const resolvedVirtualItems = virtualItems.filter((virtualItem) => {
    return virtualItem.index >= 0 && virtualItem.index < rowCount;
  });

  if (resolvedVirtualItems.length > 0) {
    return {
      nextWindowState: {
        rowModelSignature,
        virtualItems: resolvedVirtualItems,
      },
      resolvedVirtualItems,
    };
  }

  if (previousWindowState.rowModelSignature !== rowModelSignature) {
    return {
      nextWindowState: {
        rowModelSignature,
        virtualItems: [],
      },
      resolvedVirtualItems: [],
    };
  }

  const retainedVirtualItems = previousWindowState.virtualItems.filter((virtualItem) => {
    return virtualItem.index >= 0 && virtualItem.index < rowCount;
  });
  return {
    nextWindowState: {
      rowModelSignature,
      virtualItems: retainedVirtualItems,
    },
    resolvedVirtualItems: retainedVirtualItems,
  };
}
